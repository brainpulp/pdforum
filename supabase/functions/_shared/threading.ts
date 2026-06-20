// Pure, side-effect-free conversation threading (JWZ-simplified).
//
// Given a set of parsed messages, group them into conversations using only
// email threading headers (Message-ID / In-Reply-To / References) and compute,
// for each message, its nearest *present* ancestor (display parent).
//
// Design notes (see docs/spec.md §7):
//   * Connectivity is computed with union-find over the universe of ALL
//     message-ids seen — including ids that are only *referenced* but not yet
//     ingested ("empty containers"). This makes threading independent of
//     arrival order and lets replies to a not-yet-seen root group together.
//   * Subject-based merging is deliberately NOT performed: header linkage is
//     authoritative, avoiding over-merging unrelated same-subject mail.
//
// Portable TypeScript — runs under both Deno (Edge Function) and Node (tests).

import { normalizeSubject } from "./headers.ts";

export interface ThreadingInput {
  rfcMessageId: string;
  inReplyTo: string | null;
  references: string[];
  subject: string;
  sentAt: string | null;
}

export interface ThreadedMessage {
  rfcMessageId: string;
  /** Deterministic key for the message's conversation. */
  threadKey: string;
  /** Nearest ancestor that is itself a present message, or null. */
  parentId: string | null;
  isRoot: boolean;
}

export interface Thread {
  threadKey: string;
  /** Earliest present root message, or null if the root hasn't been seen. */
  rootMessageId: string | null;
  subject: string;
  /** Present message ids, ordered by sent time then id. */
  messageIds: string[];
  lastMessageAt: string | null;
  messageCount: number;
}

export interface ThreadingResult {
  messages: ThreadedMessage[];
  threads: Thread[];
}

/** Minimal disjoint-set (union-find) with path compression. */
class UnionFind {
  private parent = new Map<string, string>();

  add(x: string): void {
    if (!this.parent.has(x)) this.parent.set(x, x);
  }

  find(x: string): string {
    this.add(x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    // Path compression.
    let cur = x;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }

  ids(): string[] {
    return [...this.parent.keys()];
  }
}

/** Numeric sort key for a (possibly missing) sent timestamp; missing sorts last. */
function sentKey(s: string | null): number {
  if (!s) return Number.POSITIVE_INFINITY;
  const t = Date.parse(s);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

/** Stable comparator: by sent time ascending, then by id ascending. */
function bySentThenId(
  a: { sentAt: string | null; id: string },
  b: { sentAt: string | null; id: string },
): number {
  const d = sentKey(a.sentAt) - sentKey(b.sentAt);
  if (d !== 0) return d;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function buildThreads(input: ThreadingInput[]): ThreadingResult {
  const present = new Map<string, ThreadingInput>();
  for (const m of input) present.set(m.rfcMessageId, m);

  // 1. Union-find connectivity over all ids (present + referenced).
  const uf = new UnionFind();
  for (const m of input) {
    uf.add(m.rfcMessageId);
    const links = [...m.references, ...(m.inReplyTo ? [m.inReplyTo] : [])];
    for (const link of links) {
      if (link === m.rfcMessageId) continue;
      uf.union(m.rfcMessageId, link);
    }
  }

  // 2. Per-message display parent = nearest *present* ancestor.
  const threaded: ThreadedMessage[] = input.map((m) => {
    const candidates = [
      ...(m.inReplyTo ? [m.inReplyTo] : []),
      ...[...m.references].reverse(), // deepest first
    ];
    let parentId: string | null = null;
    for (const c of candidates) {
      if (c !== m.rfcMessageId && present.has(c)) {
        parentId = c;
        break;
      }
    }
    return {
      rfcMessageId: m.rfcMessageId,
      threadKey: "", // filled in below once component keys are known
      parentId,
      isRoot: parentId === null,
    };
  });

  // 3. Component key = smallest id in the component (deterministic).
  const componentKey = new Map<string, string>(); // root -> min id
  for (const id of uf.ids()) {
    const root = uf.find(id);
    const cur = componentKey.get(root);
    if (cur === undefined || id < cur) componentKey.set(root, id);
  }
  const keyFor = (id: string) => componentKey.get(uf.find(id))!;

  for (const tm of threaded) tm.threadKey = keyFor(tm.rfcMessageId);

  // 4. Assemble threads from components that contain >=1 present message.
  const byKey = new Map<string, ThreadedMessage[]>();
  for (const tm of threaded) {
    const arr = byKey.get(tm.threadKey);
    if (arr) arr.push(tm);
    else byKey.set(tm.threadKey, [tm]);
  }

  const threads: Thread[] = [];
  for (const [threadKey, members] of byKey) {
    const msgs = members.map((tm) => present.get(tm.rfcMessageId)!);
    const ordered = [...msgs].sort((a, b) =>
      bySentThenId(
        { sentAt: a.sentAt, id: a.rfcMessageId },
        { sentAt: b.sentAt, id: b.rfcMessageId },
      ),
    );

    // Root: earliest present message with no present parent.
    const rootCandidates = members
      .filter((tm) => tm.isRoot)
      .map((tm) => present.get(tm.rfcMessageId)!)
      .sort((a, b) =>
        bySentThenId(
          { sentAt: a.sentAt, id: a.rfcMessageId },
          { sentAt: b.sentAt, id: b.rfcMessageId },
        ),
      );
    const root = rootCandidates[0] ?? ordered[0] ?? null;

    const lastMessageAt =
      ordered.reduce<string | null>((acc, m) => {
        if (!m.sentAt) return acc;
        if (acc === null || sentKey(m.sentAt) > sentKey(acc)) return m.sentAt;
        return acc;
      }, null);

    threads.push({
      threadKey,
      rootMessageId: root ? root.rfcMessageId : null,
      subject: root ? normalizeSubject(root.subject) : "",
      messageIds: ordered.map((m) => m.rfcMessageId),
      lastMessageAt,
      messageCount: ordered.length,
    });
  }

  return { messages: threaded, threads };
}
