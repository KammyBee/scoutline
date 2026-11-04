import { eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { applyFollowUpRules } from "../followups";
import { accessToken, canRead, getAccount } from "../google/account";
import { GoogleAuthError, type Fetcher } from "../google/oauth";
import { GmailApi, GmailRateLimited } from "./api";
import { classify, gmailQuery, looksJobRelated, senderDomain, type MailKind } from "./classify";
import { linkMessage, type Candidate } from "./link";
import { clip, redact, toMailIn, type MailIn } from "./parse";
import { applyToJob, jobsForThreads, summarize } from "./apply";

type Db = NodePgDatabase<typeof schema>;
const { emails, postings, applications, googleAccount } = schema;

export type SyncSummary = { read: number; saved: number; matched: number; unmatched: number; statusChanges: number; markedNoResponse: number; more: boolean; rateLimited: boolean };

const FIRST_SYNC_DAYS = () => Math.max(1, Number(process.env.GMAIL_FIRST_SYNC_DAYS) || 45);
const MAX_LIST = 500;
const MAX_READ = () => Math.max(1, Number(process.env.GMAIL_MAX_PER_SYNC) || 150);

/** Sender domains never read or saved (for example your current employer). From GMAIL_SKIP_DOMAINS. */
export function skipDomains(): string[] {
  return (process.env.GMAIL_SKIP_DOMAINS || "").split(",").map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
}
export function skipped(address: string, domains = skipDomains()): boolean {
  const d = senderDomain(address);
  return domains.some((x) => d === x || d.endsWith("." + x));
}

/** Opens the conversation in Gmail. Gmail's web links take a conversation (thread) id, not a message id. */
export function gmailLink(threadId: string, account?: string | null): string {
  return `https://mail.google.com/mail/u/${account ? encodeURIComponent(account) : "0"}/#all/${threadId}`;
}

async function pool<T>(items: T[], n: number, fn: (item: T, i: number) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; await fn(items[k], k); }
  }));
}

/**
 * Reads new job mail from Gmail (read-only) and files it under your jobs.
 * Saves only: sender, a cleaned-up subject, a one-line summary from a template, the kind, dates and a Gmail link.
 * Never saves message bodies, attachments, phone numbers or money amounts.
 */
export async function syncGmail(db: Db, opts: { api?: GmailApi; fetcher?: Fetcher; now?: Date; sleep?: (ms: number) => Promise<void> } = {}): Promise<SyncSummary> {
  const now = opts.now ?? new Date();
  const account = await getAccount(db);
  if (!canRead(account)) throw new GoogleAuthError("not_connected", "Connect Gmail first.");
  const summary: SyncSummary = { read: 0, saved: 0, matched: 0, unmatched: 0, statusChanges: 0, markedNoResponse: 0, more: false, rateLimited: false };
  try {
    const api = opts.api ?? new GmailApi(await accessToken(db, opts.fetcher), opts.fetcher, opts.sleep);
    const from = account!.syncedThrough ? Date.parse(account!.syncedThrough) - 864e5 : +now - FIRST_SYNC_DAYS() * 864e5;
    const listed = await api.listIds(gmailQuery(Math.floor(from / 1000)), MAX_LIST);
    const known = new Set<string>();
    for (let i = 0; i < listed.length; i += 200) {
      const ids = listed.slice(i, i + 200).map((m) => m.id);
      (await db.select({ id: emails.id }).from(emails).where(inArray(emails.id, ids))).forEach((r) => known.add(r.id));
    }
    // Oldest first, so a job moves applied → interviewing → offer in the right order.
    let todo = listed.filter((m) => !known.has(m.id)).reverse();
    if (todo.length > MAX_READ()) { todo = todo.slice(0, MAX_READ()); summary.more = true; }

    // Two at a time keeps well inside Gmail's per-minute quota. If Google still says "too fast",
    // stop reading, file what was read so far (oldest first, no gaps), and pick up from there next time.
    const fetched: (MailIn | undefined)[] = new Array(todo.length);
    let stopped = false;
    await pool(todo, 2, async (m, i) => {
      if (stopped) return;
      try {
        fetched[i] = toMailIn(await api.getMessage(m.id));
      } catch (e) {
        if (!(e instanceof GmailRateLimited)) throw e;
        stopped = true;
      }
    });
    const gap = fetched.findIndex((m) => !m);
    const msgs = (gap < 0 ? fetched : fetched.slice(0, gap)) as MailIn[];
    if (stopped) { summary.more = true; summary.rateLimited = true; }
    summary.read = msgs.length;
    msgs.sort((a, b) => a.date.localeCompare(b.date));

    const candidates: Candidate[] = await db
      .select({ id: postings.id, company: postings.company, title: postings.title, status: applications.status, appliedAt: applications.appliedAt })
      .from(postings)
      .innerJoin(applications, eq(applications.postingId, postings.id))
      .where(eq(postings.archived, false));
    const companyOf = new Map(candidates.map((c) => [c.id, c.company]));
    const threads = await jobsForThreads(db, [...new Set(msgs.map((m) => m.threadId))]);
    const skip = skipDomains();

    let newest = account!.syncedThrough ? Date.parse(account!.syncedThrough) : 0;
    for (const m of msgs) {
      newest = Math.max(newest, Date.parse(m.date));
      if (skipped(m.fromAddress, skip)) continue;
      let c = classify(m);
      const link = linkMessage(m, candidates, threads.get(m.threadId));
      if (!c && link && looksJobRelated(m)) c = { kind: "update", actionText: null, due: null };
      if (!c) continue;
      if (!link && c.kind === "update") continue; // routine hiring-system mail for a job you don't track
      const company = link ? companyOf.get(link.postingId)! : m.fromName || senderDomain(m.fromAddress) || "Unknown sender";
      const subject = clip(redact(m.subject), 200);
      const row = {
        id: m.id,
        threadId: m.threadId,
        postingId: link?.postingId ?? null,
        date: m.date,
        sender: clip(m.fromName ? `${m.fromName} <${m.fromAddress}>` : m.fromAddress, 200),
        subject,
        kind: c.kind as MailKind,
        summary: clip(redact(summarize(c.kind, company, c.actionText, subject)), 300),
        link: gmailLink(m.threadId, account!.email),
        actionText: c.actionText,
        due: c.due,
        state: link ? "matched" : "unmatched",
        processedAt: now.toISOString(),
      };
      const ins = await db.insert(emails).values(row).onConflictDoNothing().returning({ id: emails.id });
      if (!ins.length) continue;
      summary.saved++;
      if (link) {
        summary.matched++;
        threads.set(m.threadId, link.postingId);
        if (await applyToJob(db, link.postingId, { id: m.id, kind: row.kind, date: m.date, summary: row.summary, link: row.link, actionText: row.actionText, due: row.due })) summary.statusChanges++;
      } else summary.unmatched++;
    }
    const plan = await applyFollowUpRules(db);
    summary.markedNoResponse = plan.markNoResponse.length;
    // When reading stopped early, only move forward as far as what was actually read.
    const through = summary.more ? (newest ? new Date(newest).toISOString() : account!.syncedThrough) : new Date(Math.max(newest, +now)).toISOString();
    await db
      .update(googleAccount)
      .set({ syncedThrough: through, lastSyncAt: now.toISOString(), lastSyncStatus: "ok", lastSyncError: null, lastSyncSummary: { read: summary.read, saved: summary.saved, matched: summary.matched, unmatched: summary.unmatched, statusChanges: summary.statusChanges } })
      .where(eq(googleAccount.id, 1));
    return summary;
  } catch (e) {
    const reconnect = e instanceof GoogleAuthError && e.code === "invalid_grant";
    await db
      .update(googleAccount)
      .set({ lastSyncAt: now.toISOString(), lastSyncStatus: reconnect ? "reconnect" : "error", lastSyncError: clip(e instanceof Error ? e.message : String(e), 300) })
      .where(eq(googleAccount.id, 1));
    throw e;
  }
}
