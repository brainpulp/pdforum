// In-memory mock repository with a seeded conversation, so rendering and
// threading can be verified in a browser before a live Supabase project exists.

import type { MessageRecord, Repo, ThreadDetail, ThreadSummary } from "./types.ts";

const THREAD_A_MESSAGES: MessageRecord[] = [
  {
    id: "a1",
    rfcMessageId: "a1@list",
    inReplyTo: null,
    references: [],
    fromName: "Ada Lovelace",
    fromEmail: "ada@example.org",
    subject: "Proposal: weekly reading group",
    bodyText:
      "Hi all,\n\nWould anyone be interested in a weekly reading group on " +
      "analytical engines? I'm thinking Thursdays.\n\n— Ada",
    bodyHtml: null,
    sentAt: "2026-06-15T09:00:00.000Z",
  },
  {
    id: "a2",
    rfcMessageId: "a2@list",
    inReplyTo: "a1@list",
    references: ["a1@list"],
    fromName: "Alan Turing",
    fromEmail: "alan@example.org",
    subject: "Re: Proposal: weekly reading group",
    bodyText: "Thursdays work for me. Count me in.\n\nAlan",
    bodyHtml: null,
    sentAt: "2026-06-15T10:30:00.000Z",
  },
  {
    id: "a3",
    rfcMessageId: "a3@list",
    inReplyTo: "a1@list",
    references: ["a1@list"],
    fromName: "Grace Hopper",
    fromEmail: "grace@example.org",
    subject: "Re: Proposal: weekly reading group",
    bodyText: "Love this idea. Could we do Wednesdays instead?\n\nGrace",
    bodyHtml: null,
    sentAt: "2026-06-15T11:15:00.000Z",
  },
  {
    id: "a4",
    rfcMessageId: "a4@list",
    inReplyTo: "a3@list",
    references: ["a1@list", "a3@list"],
    fromName: "Ada Lovelace",
    fromEmail: "ada@example.org",
    subject: "Re: Proposal: weekly reading group",
    bodyText: "Wednesdays are fine by me. Let's say 5pm.\n\n— Ada",
    bodyHtml: null,
    sentAt: "2026-06-15T12:00:00.000Z",
  },
];

const THREAD_B_MESSAGES: MessageRecord[] = [
  {
    id: "b1",
    rfcMessageId: "b1@list",
    inReplyTo: null,
    references: [],
    fromName: "Katherine Johnson",
    fromEmail: "katherine@example.org",
    subject: "Notes from last meeting",
    bodyText: "Attaching my notes below. Let me know if I missed anything.",
    bodyHtml: null,
    sentAt: "2026-06-18T14:00:00.000Z",
  },
  {
    id: "b2",
    rfcMessageId: "b2@list",
    inReplyTo: "b1@list",
    references: ["b1@list"],
    fromName: "Katherine Johnson",
    fromEmail: "katherine@example.org",
    subject: "Re: Notes from last meeting",
    bodyText: "Correction: the next session is on the 25th, not the 24th.",
    bodyHtml: null,
    sentAt: "2026-06-18T14:20:00.000Z",
  },
];

const THREADS: { summary: ThreadSummary; messages: MessageRecord[] }[] = [
  {
    summary: {
      id: "thread-b",
      subject: "Notes from last meeting",
      lastMessageAt: "2026-06-18T14:20:00.000Z",
      messageCount: THREAD_B_MESSAGES.length,
      participantCount: 1,
    },
    messages: THREAD_B_MESSAGES,
  },
  {
    summary: {
      id: "thread-a",
      subject: "Proposal: weekly reading group",
      lastMessageAt: "2026-06-15T12:00:00.000Z",
      messageCount: THREAD_A_MESSAGES.length,
      participantCount: 3,
    },
    messages: THREAD_A_MESSAGES,
  },
];

export class MockRepo implements Repo {
  async listThreads(): Promise<ThreadSummary[]> {
    return THREADS.map((t) => t.summary).sort((a, b) =>
      (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""),
    );
  }

  async getThread(threadId: string): Promise<ThreadDetail | null> {
    const found = THREADS.find((t) => t.summary.id === threadId);
    return found ? { thread: found.summary, messages: found.messages } : null;
  }
}
