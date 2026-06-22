// Small rendering helpers. Message bodies are rendered as escaped text (never
// raw HTML) to avoid injecting untrusted email content into the DOM.

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Strip tags from an HTML string to derive a plain-text fallback. */
export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body.textContent ?? "";
}

/** Best available plain-text body for a message. */
export function messageText(
  bodyText: string | null,
  bodyHtml: string | null,
): string {
  if (bodyText && bodyText.trim()) return bodyText;
  if (bodyHtml && bodyHtml.trim()) return htmlToText(bodyHtml);
  return "";
}

export function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function senderLabel(
  name: string | null,
  email: string | null,
): string {
  if (name) return name;
  if (email) return email;
  return "Unknown sender";
}
