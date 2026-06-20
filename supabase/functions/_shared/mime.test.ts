import { describe, it, expect } from "vitest";
import { parseRawEmail } from "./mime.ts";

const PLAIN = [
  "From: Alice Example <alice@example.com>",
  "To: list@example.com",
  "Subject: Hello world",
  "Message-ID: <msg1@example.com>",
  "Date: Mon, 01 Jan 2026 10:00:00 +0000",
  "",
  "This is the body.",
  "",
].join("\r\n");

const REPLY_MULTIPART = [
  'From: "Bob" <bob@example.com>',
  "To: list@example.com",
  "Subject: Re: Hello world",
  "Message-ID: <msg2@example.com>",
  "In-Reply-To: <msg1@example.com>",
  "References: <msg1@example.com>",
  "Date: Mon, 01 Jan 2026 11:00:00 +0000",
  'Content-Type: multipart/alternative; boundary="b"',
  "",
  "--b",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Reply text body.",
  "--b",
  "Content-Type: text/html; charset=utf-8",
  "",
  "<p>Reply <b>html</b> body.</p>",
  "--b--",
  "",
].join("\r\n");

describe("parseRawEmail", () => {
  it("parses a plain text message", async () => {
    const m = await parseRawEmail(PLAIN);
    expect(m.rfcMessageId).toBe("msg1@example.com");
    expect(m.fromEmail).toBe("alice@example.com");
    expect(m.fromName).toBe("Alice Example");
    expect(m.subject).toBe("Hello world");
    expect(m.inReplyTo).toBeNull();
    expect(m.references).toEqual([]);
    expect(m.bodyText).toContain("This is the body.");
    expect(m.sentAt).toBe("2026-01-01T10:00:00.000Z");
  });

  it("parses a multipart/alternative reply with threading headers", async () => {
    const m = await parseRawEmail(REPLY_MULTIPART);
    expect(m.rfcMessageId).toBe("msg2@example.com");
    expect(m.fromEmail).toBe("bob@example.com");
    expect(m.inReplyTo).toBe("msg1@example.com");
    expect(m.references).toEqual(["msg1@example.com"]);
    expect(m.subject).toBe("Re: Hello world");
    expect(m.bodyText).toContain("Reply text body.");
    expect(m.bodyHtml).toContain("<b>html</b>");
    expect(m.sentAt).toBe("2026-01-01T11:00:00.000Z");
  });

  it("normalizes threading headers via the shared helpers", async () => {
    // References with multiple ids and stray whitespace.
    const raw = [
      "From: c@example.com",
      "Subject: Re: Re: Deep thread",
      "Message-ID: <c@example.com>",
      "References: <a@example.com>\r\n <b@example.com>",
      "",
      "body",
      "",
    ].join("\r\n");
    const m = await parseRawEmail(raw);
    expect(m.references).toEqual(["a@example.com", "b@example.com"]);
    expect(m.rfcMessageId).toBe("c@example.com");
  });
});
