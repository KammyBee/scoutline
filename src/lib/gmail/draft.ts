import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { accessToken, canDraft, getAccount } from "../google/account";
import type { Fetcher } from "../google/oauth";
import { GmailApi } from "./api";

type Db = NodePgDatabase<typeof schema>;

const ADDRESS = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

/** Splits "a@x.com, b@y.com" and keeps only plain, valid addresses. */
export function parseRecipients(to: string): string[] {
  return to.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean).filter((s) => ADDRESS.test(s)).slice(0, 5);
}

const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();
const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : "=?UTF-8?B?" + Buffer.from(s, "utf8").toString("base64") + "?=");

/** An RFC 2822 message, base64url-encoded the way the Gmail API wants it. Header injection is stripped. */
export function buildRaw(m: { from: string; to: string[]; subject: string; body: string }): string {
  const lines = [
    `From: ${oneLine(m.from)}`,
    ...(m.to.length ? [`To: ${m.to.join(", ")}`] : []),
    `Subject: ${encodeHeader(oneLine(m.subject))}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(m.body.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").replace(/.{76}/g, "$&\r\n"),
  ];
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

/**
 * Saves a draft in your Gmail Drafts folder. It does not send it. Open it in Gmail, check it, and
 * send it yourself if you want to. Needs the drafts permission (gmail.compose).
 */
export async function saveDraft(db: Db, m: { to: string; subject: string; body: string }, opts: { api?: GmailApi; fetcher?: Fetcher } = {}): Promise<{ draftId: string; url: string }> {
  const a = await getAccount(db);
  if (!canDraft(a)) throw new Error("Turn on Gmail drafts first.");
  const subject = m.subject.trim().slice(0, 200);
  const body = m.body.trim().slice(0, 10000);
  if (!subject || !body) throw new Error("Add a subject and a message.");
  const api = opts.api ?? new GmailApi(await accessToken(db, opts.fetcher), opts.fetcher);
  const r = await api.createDraft(buildRaw({ from: a!.email, to: parseRecipients(m.to), subject, body }));
  return { draftId: r.id, url: `https://mail.google.com/mail/u/${encodeURIComponent(a!.email)}/#drafts?compose=${encodeURIComponent(r.message.id)}` };
}
