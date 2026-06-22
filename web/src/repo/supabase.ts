// Supabase-backed repository. Reads are mediated by RLS (member-only), so the
// browser only ever uses the anon key. Shapes are mapped to the UI's types.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MessageRecord, Repo, ThreadDetail, ThreadSummary } from "./types.ts";

interface ThreadRow {
  id: string;
  subject: string | null;
  last_message_at: string | null;
  message_count: number;
}

interface MessageRow {
  id: string;
  rfc_message_id: string;
  in_reply_to: string | null;
  references: string[] | null;
  from_name: string | null;
  from_email: string | null;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  sent_at: string | null;
}

function toMessage(r: MessageRow): MessageRecord {
  return {
    id: r.id,
    rfcMessageId: r.rfc_message_id,
    inReplyTo: r.in_reply_to,
    references: r.references ?? [],
    fromName: r.from_name,
    fromEmail: r.from_email,
    subject: r.subject ?? "",
    bodyText: r.body_text,
    bodyHtml: r.body_html,
    sentAt: r.sent_at,
  };
}

export class SupabaseRepo implements Repo {
  constructor(private db: SupabaseClient) {}

  async listThreads(): Promise<ThreadSummary[]> {
    const { data, error } = await this.db
      .from("threads")
      .select("id, subject, last_message_at, message_count")
      .order("last_message_at", { ascending: false });
    if (error) throw error;
    return (data as ThreadRow[]).map((t) => ({
      id: t.id,
      subject: t.subject ?? "(no subject)",
      lastMessageAt: t.last_message_at,
      messageCount: t.message_count,
      // Participant count isn't denormalized; left at 0 until needed.
      participantCount: 0,
    }));
  }

  async getThread(threadId: string): Promise<ThreadDetail | null> {
    const { data: threadRows, error: threadErr } = await this.db
      .from("threads")
      .select("id, subject, last_message_at, message_count")
      .eq("id", threadId)
      .limit(1);
    if (threadErr) throw threadErr;
    const t = (threadRows as ThreadRow[])[0];
    if (!t) return null;

    const { data: msgRows, error: msgErr } = await this.db
      .from("messages")
      .select(
        "id, rfc_message_id, in_reply_to, references, from_name, from_email, subject, body_text, body_html, sent_at",
      )
      .eq("thread_id", threadId)
      .order("sent_at", { ascending: true });
    if (msgErr) throw msgErr;

    const messages = (msgRows as MessageRow[]).map(toMessage);
    return {
      thread: {
        id: t.id,
        subject: t.subject ?? "(no subject)",
        lastMessageAt: t.last_message_at,
        messageCount: t.message_count,
        participantCount: new Set(messages.map((m) => m.fromEmail)).size,
      },
      messages,
    };
  }
}
