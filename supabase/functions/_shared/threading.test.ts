import { describe, it, expect } from "vitest";
import { buildThreads, type ThreadingInput } from "./threading.ts";

/** Compact helper to build a ThreadingInput. */
function msg(
  id: string,
  opts: Partial<ThreadingInput> = {},
): ThreadingInput {
  return {
    rfcMessageId: id,
    inReplyTo: opts.inReplyTo ?? null,
    references: opts.references ?? [],
    subject: opts.subject ?? "Subject",
    sentAt: opts.sentAt ?? "2026-01-01T00:00:00.000Z",
  };
}

/** Find the threaded-message record for an id. */
function tm(result: ReturnType<typeof buildThreads>, id: string) {
  const m = result.messages.find((x) => x.rfcMessageId === id);
  if (!m) throw new Error(`message ${id} not found in result`);
  return m;
}

/** The thread containing a given message id. */
function threadOf(result: ReturnType<typeof buildThreads>, id: string) {
  const key = tm(result, id).threadKey;
  const t = result.threads.find((x) => x.threadKey === key);
  if (!t) throw new Error(`thread ${key} not found`);
  return t;
}

describe("buildThreads — parenting", () => {
  it("parents a reply via In-Reply-To", () => {
    const r = buildThreads([
      msg("root@x", { sentAt: "2026-01-01T00:00:00Z" }),
      msg("child@x", {
        inReplyTo: "root@x",
        sentAt: "2026-01-01T01:00:00Z",
      }),
    ]);
    expect(tm(r, "child@x").parentId).toBe("root@x");
    expect(tm(r, "root@x").parentId).toBeNull();
    expect(tm(r, "root@x").isRoot).toBe(true);
    expect(threadOf(r, "child@x").threadKey).toBe(
      threadOf(r, "root@x").threadKey,
    );
  });

  it("parents via References when In-Reply-To is absent", () => {
    const r = buildThreads([
      msg("root@x"),
      msg("child@x", { references: ["root@x"] }),
    ]);
    expect(tm(r, "child@x").parentId).toBe("root@x");
  });

  it("uses the deepest (last) known reference as parent", () => {
    const r = buildThreads([
      msg("a@x"),
      msg("b@x", { references: ["a@x"], inReplyTo: "a@x" }),
      msg("c@x", { references: ["a@x", "b@x"], inReplyTo: "b@x" }),
    ]);
    expect(tm(r, "c@x").parentId).toBe("b@x");
    expect(tm(r, "b@x").parentId).toBe("a@x");
    // all in one thread
    expect(threadOf(r, "c@x").messageCount).toBe(3);
  });
});

describe("buildThreads — grouping", () => {
  it("groups two replies to the same present root", () => {
    const r = buildThreads([
      msg("root@x"),
      msg("c1@x", { inReplyTo: "root@x" }),
      msg("c2@x", { inReplyTo: "root@x" }),
    ]);
    const k = threadOf(r, "root@x").threadKey;
    expect(threadOf(r, "c1@x").threadKey).toBe(k);
    expect(threadOf(r, "c2@x").threadKey).toBe(k);
    expect(threadOf(r, "root@x").messageCount).toBe(3);
  });

  it("groups replies to an ABSENT root via a shared reference", () => {
    const r = buildThreads([
      msg("c1@x", {
        references: ["absent-root@x"],
        sentAt: "2026-01-01T00:00:00Z",
      }),
      msg("c2@x", {
        references: ["absent-root@x"],
        sentAt: "2026-01-01T01:00:00Z",
      }),
    ]);
    expect(threadOf(r, "c1@x").threadKey).toBe(threadOf(r, "c2@x").threadKey);
    // The true origin is absent, so neither reply has a *present* parent —
    // both head the visible tree, and the earliest becomes the display root.
    expect(tm(r, "c1@x").parentId).toBeNull();
    expect(tm(r, "c2@x").parentId).toBeNull();
    expect(threadOf(r, "c1@x").rootMessageId).toBe("c1@x");
  });
});

describe("buildThreads — out-of-order arrival", () => {
  it("threads correctly regardless of input order", () => {
    const inOrder = buildThreads([
      msg("root@x", { sentAt: "2026-01-01T00:00:00Z" }),
      msg("child@x", { inReplyTo: "root@x", sentAt: "2026-01-01T01:00:00Z" }),
    ]);
    const reversed = buildThreads([
      msg("child@x", { inReplyTo: "root@x", sentAt: "2026-01-01T01:00:00Z" }),
      msg("root@x", { sentAt: "2026-01-01T00:00:00Z" }),
    ]);
    expect(tm(reversed, "child@x").parentId).toBe("root@x");
    expect(threadOf(reversed, "child@x").rootMessageId).toBe("root@x");
    // Same logical grouping either way.
    expect(reversed.threads.length).toBe(inOrder.threads.length);
  });
});

describe("buildThreads — thread metadata", () => {
  it("computes root, subject, count, ordering and last activity", () => {
    const r = buildThreads([
      msg("root@x", {
        subject: "Hello world",
        sentAt: "2026-01-01T00:00:00Z",
      }),
      msg("child@x", {
        inReplyTo: "root@x",
        subject: "Re: Hello world",
        sentAt: "2026-01-02T00:00:00Z",
      }),
    ]);
    const t = threadOf(r, "root@x");
    expect(t.rootMessageId).toBe("root@x");
    expect(t.subject).toBe("Hello world"); // normalized from the root
    expect(t.messageCount).toBe(2);
    expect(t.lastMessageAt).toBe("2026-01-02T00:00:00Z");
    expect(t.messageIds).toEqual(["root@x", "child@x"]); // sorted by sentAt
  });

  it("picks the earliest message as root when no parent is present", () => {
    const r = buildThreads([
      msg("late@x", {
        references: ["ghost@x"],
        sentAt: "2026-01-02T00:00:00Z",
      }),
      msg("early@x", {
        references: ["ghost@x"],
        sentAt: "2026-01-01T00:00:00Z",
      }),
    ]);
    // Both reference an absent ancestor; the earliest present message is root.
    expect(threadOf(r, "late@x").rootMessageId).toBe("early@x");
  });
});

describe("buildThreads — conservative subject handling", () => {
  it("does NOT merge same-subject messages lacking header links (default)", () => {
    const r = buildThreads([
      msg("a@x", { subject: "Weekly sync" }),
      msg("b@x", { subject: "Re: Weekly sync" }),
    ]);
    expect(threadOf(r, "a@x").threadKey).not.toBe(threadOf(r, "b@x").threadKey);
    expect(r.threads.length).toBe(2);
  });
});
