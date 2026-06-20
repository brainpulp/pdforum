import { describe, it, expect } from "vitest";
import {
  normalizeMessageId,
  parseInReplyTo,
  parseReferences,
  normalizeSubject,
} from "./headers.ts";

describe("normalizeMessageId", () => {
  it("strips angle brackets and trims", () => {
    expect(normalizeMessageId("<abc@example.com>")).toBe("abc@example.com");
    expect(normalizeMessageId("  <abc@example.com>  ")).toBe("abc@example.com");
  });

  it("accepts ids without angle brackets", () => {
    expect(normalizeMessageId("abc@example.com")).toBe("abc@example.com");
  });

  it("returns null for empty/missing input", () => {
    expect(normalizeMessageId(null)).toBeNull();
    expect(normalizeMessageId(undefined)).toBeNull();
    expect(normalizeMessageId("")).toBeNull();
    expect(normalizeMessageId("   ")).toBeNull();
    expect(normalizeMessageId("<>")).toBeNull();
  });

  it("preserves case (Message-IDs are not safely lowercased)", () => {
    expect(normalizeMessageId("<AbC@Example.com>")).toBe("AbC@Example.com");
  });
});

describe("parseInReplyTo", () => {
  it("extracts the message-id from a bare value", () => {
    expect(parseInReplyTo("<parent@example.com>")).toBe("parent@example.com");
  });

  it("extracts the first message-id when commentary is present", () => {
    expect(
      parseInReplyTo("Your message of yesterday <parent@example.com>"),
    ).toBe("parent@example.com");
  });

  it("returns null when there is no id", () => {
    expect(parseInReplyTo(null)).toBeNull();
    expect(parseInReplyTo("no id here")).toBeNull();
  });
});

describe("parseReferences", () => {
  it("parses a whitespace-separated list in order", () => {
    expect(
      parseReferences("<a@x.com> <b@x.com>\n <c@x.com>"),
    ).toEqual(["a@x.com", "b@x.com", "c@x.com"]);
  });

  it("returns an empty array for missing input", () => {
    expect(parseReferences(null)).toEqual([]);
    expect(parseReferences("")).toEqual([]);
  });

  it("deduplicates while preserving first-seen order", () => {
    expect(
      parseReferences("<a@x.com> <b@x.com> <a@x.com>"),
    ).toEqual(["a@x.com", "b@x.com"]);
  });

  it("ignores stray tokens that are not message-ids", () => {
    expect(parseReferences("garbage <a@x.com> more")).toEqual(["a@x.com"]);
  });
});

describe("normalizeSubject", () => {
  it("strips a single Re: prefix", () => {
    expect(normalizeSubject("Re: Hello")).toBe("Hello");
  });

  it("strips repeated and mixed reply/forward prefixes, case-insensitive", () => {
    expect(normalizeSubject("RE: Fwd: re: Hello")).toBe("Hello");
    expect(normalizeSubject("FW: Hello")).toBe("Hello");
  });

  it("collapses internal whitespace and trims", () => {
    expect(normalizeSubject("  Hello    world  ")).toBe("Hello world");
  });

  it("handles empty/missing input", () => {
    expect(normalizeSubject(null)).toBe("");
    expect(normalizeSubject("Re:")).toBe("");
  });

  it("does not strip 'Re' that is part of a word", () => {
    expect(normalizeSubject("Recursion is fun")).toBe("Recursion is fun");
  });
});
