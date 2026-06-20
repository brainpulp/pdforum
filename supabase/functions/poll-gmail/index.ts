// poll-gmail — Supabase Edge Function (Deno).
//
// Invoked on a cron. Polls the single subscribed Gmail inbox (read-only),
// parses + threads new messages, and upserts them into Postgres. All the
// interesting logic lives in ../_shared and is unit-tested; this file is just
// the I/O wiring (Gmail OAuth, Supabase service-role writes) and is verified
// against a real project at deploy time.
//
// Required secrets (supabase secrets set ...):
//   GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (provided to functions by default)

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchAccessToken, GmailClient } from "../_shared/gmail.ts";
import {
  runPoll,
  type NewMessage,
  type PersistPayload,
  type PollStore,
} from "../_shared/poll.ts";
import type { ThreadingInput } from "../_shared/threading.ts";

function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

/** Supabase-backed PollStore for a single list subscription. */
class SupabasePollStore implements PollStore {
  constructor(
    private db: SupabaseClient,
    private subscriptionId: string,
  ) {}

  async getCursor(): Promise<string | null> {
    const { data, error } = await this.db
      .from("sync_state")
      .select("gmail_history_id")
      .eq("id", 1)
      .maybeSingle();
    if (error) throw error;
    return data?.gmail_history_id ?? null;
  }

  async setCursor(historyId: string, polledAt: string): Promise<void> {
    const { error } = await this.db.from("sync_state").upsert({
      id: 1,
      subscription_id: this.subscriptionId,
      gmail_history_id: historyId,
      last_polled_at: polledAt,
    });
    if (error) throw error;
  }

  async getKnownMessageIds(): Promise<Set<string>> {
    const { data, error } = await this.db
      .from("messages")
      .select("rfc_message_id")
      .eq("subscription_id", this.subscriptionId);
    if (error) throw error;
    return new Set((data ?? []).map((r) => r.rfc_message_id as string));
  }

  async getThreadingInputs(): Promise<ThreadingInput[]> {
    const { data, error } = await this.db
      .from("messages")
      .select("rfc_message_id, in_reply_to, references, subject, sent_at")
      .eq("subscription_id", this.subscriptionId);
    if (error) throw error;
    return (data ?? []).map((r) => ({
      rfcMessageId: r.rfc_message_id as string,
      inReplyTo: (r.in_reply_to as string | null) ?? null,
      references: (r.references as string[] | null) ?? [],
      subject: (r.subject as string | null) ?? "",
      sentAt: (r.sent_at as string | null) ?? null,
    }));
  }

  async persist(payload: PersistPayload): Promise<void> {
    // 1. Upsert touched threads, keyed by (subscription_id, thread_key).
    if (payload.threads.length > 0) {
      const threadRows = payload.threads.map((t) => ({
        subscription_id: this.subscriptionId,
        thread_key: t.threadKey,
        subject: t.subject,
        last_message_at: t.lastMessageAt,
        message_count: t.messageCount,
      }));
      const { error } = await this.db
        .from("threads")
        .upsert(threadRows, { onConflict: "subscription_id,thread_key" });
      if (error) throw error;
    }

    if (payload.messages.length === 0) return;

    // 2. Resolve thread uuids for the keys we just upserted.
    const keys = [...new Set(payload.messages.map((m) => m.threadKey))];
    const { data: threadRows, error: threadErr } = await this.db
      .from("threads")
      .select("id, thread_key")
      .eq("subscription_id", this.subscriptionId)
      .in("thread_key", keys);
    if (threadErr) throw threadErr;
    const threadIdByKey = new Map(
      (threadRows ?? []).map((r) => [r.thread_key as string, r.id as string]),
    );

    // 3. Upsert messages (idempotent on rfc_message_id).
    const messageRows = payload.messages.map((m: NewMessage) => ({
      subscription_id: this.subscriptionId,
      rfc_message_id: m.rfcMessageId,
      in_reply_to: m.inReplyTo,
      references: m.references,
      thread_id: threadIdByKey.get(m.threadKey) ?? null,
      from_name: m.fromName,
      from_email: m.fromEmail,
      to_raw: m.toRaw,
      subject: m.subject,
      body_text: m.bodyText,
      body_html: m.bodyHtml,
      sent_at: m.sentAt,
      gmail_id: m.gmailId,
      gmail_thread_id: m.gmailThreadId,
      direction: "inbound",
    }));
    const { error } = await this.db
      .from("messages")
      .upsert(messageRows, { onConflict: "rfc_message_id" });
    if (error) throw error;
  }
}

async function handle(): Promise<Response> {
  const db = createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );

  // Phase 1 mirrors a single list: use the first configured subscription.
  const { data: sub, error: subErr } = await db
    .from("list_subscriptions")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (subErr) throw subErr;
  if (!sub) {
    throw new Error(
      "No row in list_subscriptions — seed the mirrored list first.",
    );
  }

  const accessToken = await fetchAccessToken({
    clientId: requireEnv("GMAIL_CLIENT_ID"),
    clientSecret: requireEnv("GMAIL_CLIENT_SECRET"),
    refreshToken: requireEnv("GMAIL_REFRESH_TOKEN"),
  });
  const gmail = new GmailClient(accessToken);
  const store = new SupabasePollStore(db, sub.id as string);

  const result = await runPoll(gmail, store);
  return new Response(JSON.stringify(result), {
    headers: { "content-type": "application/json" },
  });
}

Deno.serve(async () => {
  try {
    return await handle();
  } catch (err) {
    console.error("poll-gmail failed:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
});
