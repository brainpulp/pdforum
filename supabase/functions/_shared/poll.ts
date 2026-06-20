// Orchestration for one poll cycle: Gmail → parse → thread → persist.
//
// Written against narrow interfaces (GmailSource / PollStore) so the control
// flow is unit-testable with in-memory fakes — no Gmail, no Postgres. The Deno
// entrypoint (poll-gmail/index.ts) wires the real GmailClient and a Supabase
// store into these interfaces.

import { parseRawEmail } from "./mime.ts";
import { buildThreads, type Thread, type ThreadingInput } from "./threading.ts";

export interface GmailSource {
  listAllMessageIds(): Promise<string[]>;
  listHistory(
    startHistoryId: string,
  ): Promise<{ messageIds: string[]; historyId: string }>;
  getProfileHistoryId(): Promise<string>;
  getRawMessage(
    id: string,
  ): Promise<{ raw: string; gmailThreadId: string | null }>;
}

/** A new message ready to be inserted, with its computed thread assignment. */
export interface NewMessage {
  rfcMessageId: string;
  inReplyTo: string | null;
  references: string[];
  fromName: string | null;
  fromEmail: string | null;
  toRaw: string | null;
  subject: string;
  bodyText: string | null;
  bodyHtml: string | null;
  sentAt: string | null;
  gmailId: string;
  gmailThreadId: string | null;
  threadKey: string;
  parentId: string | null;
}

export interface PersistPayload {
  messages: NewMessage[];
  threads: Thread[];
}

export interface PollStore {
  /** Stored Gmail historyId cursor, or null on first run. */
  getCursor(): Promise<string | null>;
  setCursor(historyId: string, polledAt: string): Promise<void>;
  /** rfc_message_id values already stored (for idempotency). */
  getKnownMessageIds(): Promise<Set<string>>;
  /** Threading fields of already-stored messages (context for re-threading). */
  getThreadingInputs(): Promise<ThreadingInput[]>;
  persist(payload: PersistPayload): Promise<void>;
}

export interface PollResult {
  fetched: number;
  inserted: number;
  threadCount: number;
  historyId: string;
}

/** Run a single poll cycle. Returns a summary; throws on hard failures. */
export async function runPoll(
  gmail: GmailSource,
  store: PollStore,
  now: () => string = () => new Date().toISOString(),
): Promise<PollResult> {
  const cursor = await store.getCursor();

  // Decide which Gmail message ids to consider, and the next cursor.
  let gmailIds: string[];
  let nextHistoryId: string;
  if (cursor === null) {
    gmailIds = await gmail.listAllMessageIds();
    nextHistoryId = await gmail.getProfileHistoryId();
  } else {
    const history = await gmail.listHistory(cursor);
    gmailIds = history.messageIds;
    nextHistoryId = history.historyId;
  }

  const known = await store.getKnownMessageIds();

  // Fetch + parse anything we haven't stored yet (dedup by RFC Message-ID).
  const parsed: Omit<NewMessage, "threadKey" | "parentId">[] = [];
  let fetched = 0;
  for (const gid of gmailIds) {
    const raw = await gmail.getRawMessage(gid);
    fetched++;
    const pm = await parseRawEmail(raw.raw);
    if (!pm.rfcMessageId) continue; // can't thread or dedupe without an id
    if (known.has(pm.rfcMessageId)) continue;
    known.add(pm.rfcMessageId);
    parsed.push({
      rfcMessageId: pm.rfcMessageId,
      inReplyTo: pm.inReplyTo,
      references: pm.references,
      fromName: pm.fromName,
      fromEmail: pm.fromEmail,
      toRaw: pm.toRaw,
      subject: pm.subject,
      bodyText: pm.bodyText,
      bodyHtml: pm.bodyHtml,
      sentAt: pm.sentAt,
      gmailId: gid,
      gmailThreadId: raw.gmailThreadId,
    });
  }

  // Re-thread the full corpus (existing + new) so late-arriving parents and
  // newly linked messages reconcile correctly.
  const existing = await store.getThreadingInputs();
  const allInputs: ThreadingInput[] = [
    ...existing,
    ...parsed.map((p) => ({
      rfcMessageId: p.rfcMessageId,
      inReplyTo: p.inReplyTo,
      references: p.references,
      subject: p.subject,
      sentAt: p.sentAt,
    })),
  ];
  const { messages: threaded, threads } = buildThreads(allInputs);
  const assignment = new Map(threaded.map((t) => [t.rfcMessageId, t]));

  const messages: NewMessage[] = parsed.map((p) => {
    const a = assignment.get(p.rfcMessageId)!;
    return { ...p, threadKey: a.threadKey, parentId: a.parentId };
  });

  // Only emit threads that actually contain at least one newly inserted message
  // (their metadata may have shifted); existing-only threads are unchanged.
  const touchedKeys = new Set(messages.map((m) => m.threadKey));
  const touchedThreads = threads.filter((t) => touchedKeys.has(t.threadKey));

  await store.persist({ messages, threads: touchedThreads });
  await store.setCursor(nextHistoryId, now());

  return {
    fetched,
    inserted: messages.length,
    threadCount: touchedThreads.length,
    historyId: nextHistoryId,
  };
}
