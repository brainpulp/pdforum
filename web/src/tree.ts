// Render a thread's messages as a depth-annotated, chronological tree.
//
// Reuses the same tested threading logic as ingestion (@shared/threading) to
// resolve each message's display parent, then performs a stable depth-first
// walk from the roots so replies render indented under what they replied to.

import { buildThreads } from "@shared/threading.ts";
import type { MessageRecord } from "./repo/types.ts";

export interface TreeNode {
  message: MessageRecord;
  depth: number;
}

function sentKey(s: string | null): number {
  if (!s) return Number.POSITIVE_INFINITY;
  const t = Date.parse(s);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

export function buildMessageTree(messages: MessageRecord[]): TreeNode[] {
  const { messages: threaded } = buildThreads(
    messages.map((m) => ({
      rfcMessageId: m.rfcMessageId,
      inReplyTo: m.inReplyTo,
      references: m.references,
      subject: m.subject,
      sentAt: m.sentAt,
    })),
  );
  const parentOf = new Map(threaded.map((t) => [t.rfcMessageId, t.parentId]));
  const byId = new Map(messages.map((m) => [m.rfcMessageId, m]));

  // Children grouped by parent rfc id (null = roots), each sorted chronologically.
  const childrenOf = new Map<string | null, MessageRecord[]>();
  for (const m of messages) {
    const parent = parentOf.get(m.rfcMessageId) ?? null;
    const key = parent && byId.has(parent) ? parent : null;
    const arr = childrenOf.get(key);
    if (arr) arr.push(m);
    else childrenOf.set(key, [m]);
  }
  for (const arr of childrenOf.values()) {
    arr.sort((a, b) => sentKey(a.sentAt) - sentKey(b.sentAt));
  }

  const out: TreeNode[] = [];
  const visit = (msg: MessageRecord, depth: number) => {
    out.push({ message: msg, depth });
    for (const child of childrenOf.get(msg.rfcMessageId) ?? []) {
      visit(child, depth + 1);
    }
  };
  for (const root of childrenOf.get(null) ?? []) visit(root, 0);
  return out;
}
