// Minimal Gmail REST client for the poll-gmail Edge Function.
//
// Authenticates with an OAuth2 refresh token (read-only scope) and exposes just
// the calls poll-gmail needs: full listing, incremental history, raw fetch, and
// the profile historyId cursor. `fetch` is injectable so the HTTP/URL logic is
// unit-testable without network access.
//
// Portable TypeScript — runs under Deno (Edge Function) and Node (tests).

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface GmailCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

/** Exchange a refresh token for a short-lived access token. */
export async function fetchAccessToken(
  creds: GmailCredentials,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const body = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    refresh_token: creds.refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`Gmail token exchange failed: ${res.status}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("Gmail token response missing access_token");
  return json.access_token;
}

/** Decode Gmail base64url (URL-safe, possibly unpadded) into a UTF-8 string. */
export function decodeBase64Url(data: string): string {
  let b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) b64 += "=";
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

export interface RawMessage {
  id: string;
  raw: string; // decoded RFC822 source
  gmailThreadId: string | null;
  historyId: string | null;
}

export class GmailClient {
  constructor(
    private accessToken: string,
    private fetchImpl: FetchLike = fetch,
  ) {}

  private async get(path: string): Promise<unknown> {
    const res = await this.fetchImpl(`${API_BASE}${path}`, {
      headers: { authorization: `Bearer ${this.accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`Gmail GET ${path} failed: ${res.status}`);
    }
    return res.json();
  }

  /** One page of message ids (optionally filtered by a Gmail `q` query). */
  async listMessageIds(
    opts: { q?: string; pageToken?: string } = {},
  ): Promise<{ ids: string[]; nextPageToken: string | null }> {
    const params = new URLSearchParams();
    if (opts.q) params.set("q", opts.q);
    if (opts.pageToken) params.set("pageToken", opts.pageToken);
    const qs = params.toString();
    const json = (await this.get(`/messages${qs ? `?${qs}` : ""}`)) as {
      messages?: { id: string }[];
      nextPageToken?: string;
    };
    return {
      ids: (json.messages ?? []).map((m) => m.id),
      nextPageToken: json.nextPageToken ?? null,
    };
  }

  /** All message ids, following pagination. */
  async listAllMessageIds(q?: string): Promise<string[]> {
    const all: string[] = [];
    let pageToken: string | undefined;
    do {
      const page = await this.listMessageIds({ q, pageToken });
      all.push(...page.ids);
      pageToken = page.nextPageToken ?? undefined;
    } while (pageToken);
    return all;
  }

  /** Fetch a single message in raw form and decode it. */
  async getRawMessage(id: string): Promise<RawMessage> {
    const json = (await this.get(`/messages/${id}?format=raw`)) as {
      id: string;
      raw: string;
      threadId?: string;
      historyId?: string;
    };
    return {
      id: json.id,
      raw: decodeBase64Url(json.raw),
      gmailThreadId: json.threadId ?? null,
      historyId: json.historyId ?? null,
    };
  }

  /** The mailbox's current historyId — the cursor baseline for incremental sync. */
  async getProfileHistoryId(): Promise<string> {
    const json = (await this.get("/profile")) as { historyId: string };
    return json.historyId;
  }

  /**
   * New message ids added since `startHistoryId`, plus the latest historyId.
   * Follows pagination and dedupes ids.
   */
  async listHistory(
    startHistoryId: string,
  ): Promise<{ messageIds: string[]; historyId: string }> {
    const ids = new Set<string>();
    let latest = startHistoryId;
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        startHistoryId,
        historyTypes: "messageAdded",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const json = (await this.get(`/history?${params.toString()}`)) as {
        history?: { messagesAdded?: { message: { id: string } }[] }[];
        historyId?: string;
        nextPageToken?: string;
      };
      for (const h of json.history ?? []) {
        for (const added of h.messagesAdded ?? []) ids.add(added.message.id);
      }
      if (json.historyId) latest = json.historyId;
      pageToken = json.nextPageToken ?? undefined;
    } while (pageToken);
    return { messageIds: [...ids], historyId: latest };
  }
}
