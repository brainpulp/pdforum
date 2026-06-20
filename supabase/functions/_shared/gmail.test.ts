import { describe, it, expect } from "vitest";
import {
  fetchAccessToken,
  decodeBase64Url,
  GmailClient,
  type FetchLike,
} from "./gmail.ts";

/** Build a fake fetch that records calls and returns scripted JSON responses. */
function fakeFetch(
  handler: (url: string, init?: RequestInit) => unknown,
): { fetch: FetchLike; calls: { url: string; init?: RequestInit }[] } {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetch: FetchLike = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    const body = handler(url, init);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch, calls };
}

function b64url(s: string): string {
  // Encode UTF-8 string to base64url (no padding) for fixtures.
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("decodeBase64Url", () => {
  it("round-trips UTF-8 content with url-safe chars and no padding", () => {
    const original = "Subject: hi — café\r\n\r\nbody?>";
    expect(decodeBase64Url(b64url(original))).toBe(original);
  });
});

describe("fetchAccessToken", () => {
  it("posts a refresh_token grant and returns the access token", async () => {
    const { fetch, calls } = fakeFetch(() => ({ access_token: "tok-123" }));
    const token = await fetchAccessToken(
      { clientId: "cid", clientSecret: "sec", refreshToken: "rt" },
      fetch,
    );
    expect(token).toBe("tok-123");
    expect(calls[0].url).toBe("https://oauth2.googleapis.com/token");
    expect(calls[0].init?.method).toBe("POST");
    expect(String(calls[0].init?.body)).toContain("grant_type=refresh_token");
    expect(String(calls[0].init?.body)).toContain("refresh_token=rt");
  });

  it("throws when the response lacks an access token", async () => {
    const { fetch } = fakeFetch(() => ({}));
    await expect(
      fetchAccessToken({ clientId: "c", clientSecret: "s", refreshToken: "r" }, fetch),
    ).rejects.toThrow(/access_token/);
  });
});

describe("GmailClient.listAllMessageIds", () => {
  it("follows pagination and concatenates ids", async () => {
    const { fetch, calls } = fakeFetch((url) => {
      if (url.includes("pageToken=p2")) {
        return { messages: [{ id: "c" }] };
      }
      return { messages: [{ id: "a" }, { id: "b" }], nextPageToken: "p2" };
    });
    const client = new GmailClient("tok", fetch);
    const ids = await client.listAllMessageIds("label:list");
    expect(ids).toEqual(["a", "b", "c"]);
    expect(calls[0].init?.headers).toMatchObject({ authorization: "Bearer tok" });
    expect(calls[0].url).toContain("q=label%3Alist");
  });
});

describe("GmailClient.getRawMessage", () => {
  it("requests format=raw and decodes the payload", async () => {
    const rfc822 = "From: a@x\r\nSubject: hi\r\n\r\nhello";
    const { fetch, calls } = fakeFetch(() => ({
      id: "m1",
      threadId: "t1",
      historyId: "555",
      raw: b64url(rfc822),
    }));
    const client = new GmailClient("tok", fetch);
    const msg = await client.getRawMessage("m1");
    expect(calls[0].url).toContain("/messages/m1?format=raw");
    expect(msg.raw).toBe(rfc822);
    expect(msg.gmailThreadId).toBe("t1");
    expect(msg.historyId).toBe("555");
  });
});

describe("GmailClient.listHistory", () => {
  it("collects added message ids and advances the historyId", async () => {
    const { fetch, calls } = fakeFetch(() => ({
      history: [
        { messagesAdded: [{ message: { id: "n1" } }, { message: { id: "n2" } }] },
        { messagesAdded: [{ message: { id: "n2" } }] }, // duplicate
      ],
      historyId: "999",
    }));
    const client = new GmailClient("tok", fetch);
    const res = await client.listHistory("900");
    expect(res.messageIds.sort()).toEqual(["n1", "n2"]);
    expect(res.historyId).toBe("999");
    expect(calls[0].url).toContain("startHistoryId=900");
    expect(calls[0].url).toContain("historyTypes=messageAdded");
  });
});
