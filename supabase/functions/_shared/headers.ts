// Pure helpers for parsing RFC 5322 threading headers.
//
// Portable TypeScript: uses only web-standard APIs so the same module runs
// under Deno (in the poll-gmail Edge Function) and under Node (in tests).

/** Matches a single message-id token, e.g. `<abc@example.com>`. */
const MESSAGE_ID_TOKEN = /<([^<>]+)>/g;

/**
 * Normalize a Message-ID: strip surrounding angle brackets and whitespace.
 * Returns null if the result is empty. Case is preserved — Message-IDs cannot
 * be safely lowercased (the local part is case-sensitive per RFC 5322).
 */
export function normalizeMessageId(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  let id = raw.trim();
  if (id.startsWith("<") && id.endsWith(">")) {
    id = id.slice(1, -1).trim();
  }
  return id.length > 0 ? id : null;
}

/**
 * Parse an In-Reply-To header. Per RFC it should be a single message-id, but
 * some clients add commentary ("Your message of ... <id>"). We extract the
 * first `<...>` token, falling back to treating the whole trimmed value as an
 * id only if it contains no angle brackets but looks like an id.
 */
export function parseInReplyTo(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const match = raw.match(/<([^<>]+)>/);
  if (match) return normalizeMessageId(match[0]);
  // No angle brackets: accept a bare token only if it looks like an id.
  const trimmed = raw.trim();
  return /\S+@\S+/.test(trimmed) ? trimmed : null;
}

/**
 * Parse a References header into an ordered, de-duplicated list of normalized
 * message-ids (first-seen order preserved). Stray non-id tokens are ignored.
 */
export function parseReferences(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of raw.matchAll(MESSAGE_ID_TOKEN)) {
    const id = normalizeMessageId(m[0]);
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Reply/forward prefixes to strip from subjects (case-insensitive). */
const REPLY_PREFIX = /^\s*(?:re|fwd?|fw)\s*:\s*/i;

/**
 * Normalize a subject for thread titles and conservative subject matching:
 * repeatedly strip leading Re:/Fwd:/Fw: prefixes, then collapse whitespace.
 */
export function normalizeSubject(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = raw;
  // Strip leading reply/forward prefixes repeatedly.
  while (REPLY_PREFIX.test(s)) {
    s = s.replace(REPLY_PREFIX, "");
  }
  return s.replace(/\s+/g, " ").trim();
}
