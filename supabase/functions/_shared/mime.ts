// Raw RFC822/MIME email → normalized ParsedMessage.
//
// Thin adapter over `postal-mime` (pure JS, runs under both Deno and Node).
// We delegate MIME structure/body decoding to postal-mime, but run the
// threading headers through our own helpers so normalization is identical to
// the threading logic that consumes them.

import PostalMime from "postal-mime";
import {
  normalizeMessageId,
  parseInReplyTo,
  parseReferences,
} from "./headers.ts";

export interface ParsedMessage {
  rfcMessageId: string | null;
  inReplyTo: string | null;
  references: string[];
  fromName: string | null;
  fromEmail: string | null;
  toRaw: string | null;
  subject: string;
  bodyText: string | null;
  bodyHtml: string | null;
  /** ISO-8601 timestamp, or null if the Date header is missing/unparseable. */
  sentAt: string | null;
}

interface RawHeader {
  key: string;
  value: string;
}

/** First raw header value matching `name` (case-insensitive), or null. */
function headerValue(headers: RawHeader[], name: string): string | null {
  const lname = name.toLowerCase();
  for (const h of headers) {
    if (h.key.toLowerCase() === lname) return h.value;
  }
  return null;
}

/** Coerce a date-ish string to an ISO timestamp, or null if invalid. */
function toIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/**
 * Parse a raw RFC822 message (as produced by Gmail `format=raw`, already base64
 * decoded into a string) into a normalized ParsedMessage.
 */
export async function parseRawEmail(raw: string): Promise<ParsedMessage> {
  const email = await PostalMime.parse(raw);
  const headers = (email.headers ?? []) as RawHeader[];

  return {
    rfcMessageId: normalizeMessageId(headerValue(headers, "message-id")),
    inReplyTo: parseInReplyTo(headerValue(headers, "in-reply-to")),
    references: parseReferences(headerValue(headers, "references")),
    fromName: email.from?.name?.trim() || null,
    fromEmail: email.from?.address ?? null,
    toRaw: headerValue(headers, "to"),
    subject: email.subject ?? "",
    bodyText: email.text ?? null,
    bodyHtml: email.html ?? null,
    sentAt: toIso(email.date) ?? toIso(headerValue(headers, "date")),
  };
}
