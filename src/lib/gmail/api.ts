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

export function isAllowed(method: string, url: string): boolean {
  if (!url.startsWith(BASE)) return false;
  const path = url.slice(BASE.length).split("?")[0];
  return ALLOWED.some((a) => a.method === method.toUpperCase() && a.path.test(path));
}

export type GmailHeader = { name: string; value: string };
export type GmailPart = { mimeType?: string; filename?: string; headers?: GmailHeader[]; body?: { data?: string; size?: number; attachmentId?: string }; parts?: GmailPart[] };
export type GmailMessage = { id: string; threadId: string; labelIds?: string[]; snippet?: string; internalDate?: string; payload?: GmailPart };

export class GmailApi {
  constructor(private token: string, private fetcher: Fetcher = (u, i) => fetch(u, i)) {}

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const url = BASE + path;
    if (!isAllowed(method, url)) throw new GmailBlocked(`Blocked Gmail call: ${method} ${path.split("?")[0]}`);
    const res = await this.fetcher(url, {
      method,
      headers: { authorization: "Bearer " + this.token, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Gmail ${res.status}: ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
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
