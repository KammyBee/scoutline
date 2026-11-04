// The only Gmail API calls Scoutline can make. Everything goes through gmailFetch(), which refuses any
// request that isn't on this list, so no code path can send, reply, label, archive or delete mail.
//
//   GET  users/me/messages            list message ids matching a search
//   GET  users/me/messages/{id}       read one message (headers and text, never attachments)
//   POST users/me/drafts              save a draft (only when you've turned on drafts)

import type { Fetcher } from "../google/oauth";

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me/";

const ALLOWED: { method: string; path: RegExp }[] = [
  { method: "GET", path: /^messages$/ },
  { method: "GET", path: /^messages\/[A-Za-z0-9_-]+$/ },
  { method: "POST", path: /^drafts$/ },
];

export class GmailBlocked extends Error {}

/** Google's per-minute Gmail quota was hit and retrying a few times didn't help. */
export class GmailRateLimited extends Error {
  constructor() {
    super("Google's per-minute Gmail limit was reached. Wait a minute and sync again; it picks up where it stopped.");
  }
}

const isRateLimit = (status: number, text: string) => status === 429 || (status === 403 && /rate ?limit|quota exceeded|userRateLimitExceeded|RESOURCE_EXHAUSTED/i.test(text));

export function isAllowed(method: string, url: string): boolean {
  if (!url.startsWith(BASE)) return false;
  const path = url.slice(BASE.length).split("?")[0];
  return ALLOWED.some((a) => a.method === method.toUpperCase() && a.path.test(path));
}

export type GmailHeader = { name: string; value: string };
export type GmailPart = { mimeType?: string; filename?: string; headers?: GmailHeader[]; body?: { data?: string; size?: number; attachmentId?: string }; parts?: GmailPart[] };
export type GmailMessage = { id: string; threadId: string; labelIds?: string[]; snippet?: string; internalDate?: string; payload?: GmailPart };

export class GmailApi {
  constructor(
    private token: string,
    private fetcher: Fetcher = (u, i) => fetch(u, i),
    /** waits between retries when Google says "too fast"; tests pass a no-op */
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const url = BASE + path;
    if (!isAllowed(method, url)) throw new GmailBlocked(`Blocked Gmail call: ${method} ${path.split("?")[0]}`);
    const waits = [2000, 6000, 15000];
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetcher(url, {
        method,
        headers: { authorization: "Bearer " + this.token, ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.ok) return (await res.json()) as T;
      const text = await res.text().catch(() => "");
      if (isRateLimit(res.status, text)) {
        if (attempt >= waits.length) throw new GmailRateLimited();
        const retryAfter = Number(res.headers.get("retry-after"));
        await this.sleep(retryAfter > 0 && retryAfter <= 60 ? retryAfter * 1000 : waits[attempt]);
        continue;
      }
      throw new Error(`Gmail ${res.status}: ${text.slice(0, 200)}`);
    }
  }

  /** Message ids matching a Gmail search, newest first, up to `max`. */
  async listIds(q: string, max: number): Promise<{ id: string; threadId: string }[]> {
    const out: { id: string; threadId: string }[] = [];
    let pageToken: string | undefined;
    do {
      const p = new URLSearchParams({ q, maxResults: String(Math.min(100, max - out.length)) });
      if (pageToken) p.set("pageToken", pageToken);
      const r = await this.call<{ messages?: { id: string; threadId: string }[]; nextPageToken?: string }>("GET", "messages?" + p.toString());
      out.push(...(r.messages ?? []));
      pageToken = r.nextPageToken;
    } while (pageToken && out.length < max);
    return out.slice(0, max);
  }

  /** One message with headers and its text parts. Attachment contents are never downloaded. */
  getMessage(id: string): Promise<GmailMessage> {
    return this.call<GmailMessage>("GET", `messages/${encodeURIComponent(id)}?format=full`);
  }

  /** Saves a draft in your Gmail. It is never sent; you open it in Gmail and send it yourself. */
  createDraft(raw: string): Promise<{ id: string; message: { id: string; threadId: string } }> {
    return this.call("POST", "drafts", { message: { raw } });
  }
}
