import { describe, it, expect } from "vitest";
import {
  runPoll,
  type GmailSource,
  type PollStore,
  type PersistPayload,
} from "./poll.ts";
import type { ThreadingInput } from "./threading.ts";

/** Build a minimal raw RFC822 message. */
function rawEmail(opts: {
  id: string;
  from?: string;
  subject?: string;
  inReplyTo?: string;
  references?: string[];
  date?: string;
  body?: string;
}): string {
  const lines = [
    `From: ${opts.from ?? "someone@example.com"}`,
    "To: list@example.com",
    `Subject: ${opts.subject ?? "Subject"}`,
    `Message-ID: <${opts.id}>`,
  ];
  if (opts.inReplyTo) lines.push(`In-Reply-To: <${opts.inReplyTo}>`);
  if (opts.references) {
    lines.push(`References: ${opts.references.map((r) => `<${r}>`).join(" ")}`);
  }
  lines.push(`Date: ${opts.date ?? "Mon, 01 Jan 2026 10:00:00 +0000"}`);
  lines.push("", opts.body ?? "body", "");
  return lines.join("\r\n");
}

class FakeGmail implements GmailSource {
  constructor(
    private raws: Record<string, string>,
    private allIds: string[],
    private profile: string,
    private history?: { messageIds: string[]; historyId: string },
  ) {}
  async listAllMessageIds() {
    return this.allIds;
  }
  async getProfileHistoryId() {
    return this.profile;
  }
  async listHistory() {
    if (!this.history) throw new Error("no history scripted");
    return this.history;
  }
  async getRawMessage(id: string) {
    return { raw: this.raws[id], gmailThreadId: `gt-${id}` };
  }
}

class FakeStore implements PollStore {
  cursor: string | null;
  known: Set<string>;
  inputs: ThreadingInput[];
  persisted: PersistPayload | null = null;
  cursorSet: { historyId: string; polledAt: string } | null = null;
  constructor(init: {
    cursor?: string | null;
    known?: string[];
    inputs?: ThreadingInput[];
  }) {
    this.cursor = init.cursor ?? null;
    this.known = new Set(init.known ?? []);
    this.inputs = init.inputs ?? [];
  }
  async getCursor() {
    return this.cursor;
  }
  async setCursor(historyId: string, polledAt: string) {
    this.cursorSet = { historyId, polledAt };
    this.cursor = historyId;
  }
  async getKnownMessageIds() {
    return new Set(this.known);
  }
  async getThreadingInputs() {
    return this.inputs;
  }
  async persist(payload: PersistPayload) {
    this.persisted = payload;
  }
}

const NOW = () => "2026-06-20T00:00:00.000Z";

describe("runPoll — first full sync", () => {
  it("ingests a two-message conversation into one thread", async () => {
    const gmail = new FakeGmail(
      {
        g1: rawEmail({ id: "m1@x", subject: "Hello" }),
        g2: rawEmail({
          id: "m2@x",
          subject: "Re: Hello",
          inReplyTo: "m1@x",
          references: ["m1@x"],
          date: "Mon, 01 Jan 2026 11:00:00 +0000",
        }),
      },
      ["g1", "g2"],
      "100",
    );
    const store = new FakeStore({ cursor: null });

    const result = await runPoll(gmail, store, NOW);

    expect(result.fetched).toBe(2);
    expect(result.inserted).toBe(2);
    expect(store.persisted!.messages.map((m) => m.rfcMessageId).sort()).toEqual([
      "m1@x",
      "m2@x",
    ]);
    // Both share one thread; the reply is parented to the root.
    const keys = new Set(store.persisted!.messages.map((m) => m.threadKey));
    expect(keys.size).toBe(1);
    const reply = store.persisted!.messages.find((m) => m.rfcMessageId === "m2@x")!;
    expect(reply.parentId).toBe("m1@x");
    expect(reply.gmailId).toBe("g2");
    expect(store.persisted!.threads).toHaveLength(1);
    expect(store.persisted!.threads[0].messageCount).toBe(2);
    // Cursor advanced to the profile historyId.
    expect(store.cursorSet).toEqual({
      historyId: "100",
      polledAt: NOW(),
    });
  });
});

describe("runPoll — incremental sync", () => {
  it("fetches only history-added messages and re-threads them in", async () => {
    const existingInputs: ThreadingInput[] = [
      { rfcMessageId: "m1@x", inReplyTo: null, references: [], subject: "Hello", sentAt: "2026-01-01T10:00:00.000Z" },
      { rfcMessageId: "m2@x", inReplyTo: "m1@x", references: ["m1@x"], subject: "Re: Hello", sentAt: "2026-01-01T11:00:00.000Z" },
    ];
    const gmail = new FakeGmail(
      {
        g3: rawEmail({
          id: "m3@x",
          subject: "Re: Hello",
          inReplyTo: "m2@x",
          references: ["m1@x", "m2@x"],
          date: "Mon, 01 Jan 2026 12:00:00 +0000",
        }),
      },
      [],
      "100",
      { messageIds: ["g3"], historyId: "150" },
    );
    const store = new FakeStore({
      cursor: "100",
      known: ["m1@x", "m2@x"],
      inputs: existingInputs,
    });

    const result = await runPoll(gmail, store, NOW);

    expect(result.fetched).toBe(1);
    expect(result.inserted).toBe(1);
    expect(store.persisted!.messages).toHaveLength(1);
    const m3 = store.persisted!.messages[0];
    expect(m3.rfcMessageId).toBe("m3@x");
    expect(m3.parentId).toBe("m2@x");
    // The touched thread now spans all three messages.
    expect(store.persisted!.threads).toHaveLength(1);
    expect(store.persisted!.threads[0].messageCount).toBe(3);
    expect(store.cursorSet!.historyId).toBe("150");
  });
});

describe("runPoll — idempotency", () => {
  it("skips messages whose Message-ID is already stored", async () => {
    const gmail = new FakeGmail(
      {
        g1: rawEmail({ id: "m1@x", subject: "Hello" }),
        g2: rawEmail({ id: "m2@x", subject: "Re: Hello", inReplyTo: "m1@x", references: ["m1@x"] }),
      },
      ["g1", "g2"],
      "100",
    );
    const store = new FakeStore({
      cursor: null,
      known: ["m1@x"],
      inputs: [{ rfcMessageId: "m1@x", inReplyTo: null, references: [], subject: "Hello", sentAt: "2026-01-01T10:00:00.000Z" }],
    });

    const result = await runPoll(gmail, store, NOW);

    expect(result.fetched).toBe(2); // both fetched
    expect(result.inserted).toBe(1); // only the unseen one inserted
    expect(store.persisted!.messages.map((m) => m.rfcMessageId)).toEqual(["m2@x"]);
  });
});
