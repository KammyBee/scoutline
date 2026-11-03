import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { todayIn } from "./dates";
import { followUpText, loadFollowStates, planFollowUps } from "./followups";
import { canDraft, canRead, getAccount } from "./google/account";
import { googleConfigured } from "./google/oauth";
import { isNoReply, viaAts } from "./gmail/classify";
import { parseFrom } from "./gmail/parse";

const { emails, postings, applications } = schema;

export type GmailStatus = {
  configured: boolean;
  email: string | null;
  canRead: boolean;
  canDraft: boolean;
  lastSyncAt: string | null;
  status: string | null;
  error: string | null;
  summary: { read: number; saved: number; matched: number; unmatched: number; statusChanges: number } | null;
};
export type DueRow = { postingId: string; company: string; title: string; status: string; appliedAt: string | null; reason: string; to: string; subject: string; body: string };
export type MailRow = { id: string; date: string | null; sender: string | null; subject: string | null; kind: string | null; summary: string | null; link: string | null; postingId: string | null; company: string | null; title: string | null };
export type JobOption = { id: string; label: string };
export type InboxData = { gmail: GmailStatus; due: DueRow[]; unmatched: MailRow[]; recent: MailRow[]; jobs: JobOption[]; today: string };

export async function getGmailStatus(): Promise<GmailStatus> {
  const a = await getAccount(await getDb());
  return {
    configured: googleConfigured(),
    email: a?.email ?? null,
    canRead: canRead(a),
    canDraft: canDraft(a),
    lastSyncAt: a?.lastSyncAt ?? null,
    status: a?.lastSyncStatus ?? null,
    error: a?.lastSyncError ?? null,
    summary: a?.lastSyncSummary ?? null,
  };
}

const mailCols = { id: emails.id, date: emails.date, sender: emails.sender, subject: emails.subject, kind: emails.kind, summary: emails.summary, link: emails.link, postingId: emails.postingId, company: postings.company, title: postings.title };

export async function getInbox(): Promise<InboxData> {
  const db = await getDb();
  const today = todayIn();
  const [gmail, states, unmatched, recent, jobs] = await Promise.all([
    getGmailStatus(),
    loadFollowStates(db),
    db.select(mailCols).from(emails).leftJoin(postings, eq(postings.id, emails.postingId)).where(eq(emails.state, "unmatched")).orderBy(desc(emails.date)).limit(50),
    db.select(mailCols).from(emails).leftJoin(postings, eq(postings.id, emails.postingId)).where(and(eq(emails.state, "matched"), isNotNull(emails.postingId))).orderBy(desc(emails.date)).limit(40),
    db
      .select({ id: postings.id, company: postings.company, title: postings.title, status: applications.status })
      .from(postings)
      .innerJoin(applications, eq(applications.postingId, postings.id))
      .where(and(eq(postings.archived, false), ne(applications.status, "passed")))
      .orderBy(asc(postings.company), asc(postings.title)),
  ]);
  const plan = planFollowUps(states, today);
  // Suggest the last real person who wrote about each job as the follow-up recipient.
  const ids = plan.due.map((d) => d.postingId);
  const senders = ids.length
    ? await db.select({ postingId: emails.postingId, sender: emails.sender, date: emails.date }).from(emails).where(inArray(emails.postingId, ids)).orderBy(desc(emails.date))
    : [];
  const toFor = new Map<string, string>();
  for (const s of senders) {
    if (!s.postingId || toFor.has(s.postingId) || !s.sender) continue;
    const addr = parseFrom(s.sender).address;
    if (addr && !isNoReply(addr) && !viaAts(addr)) toFor.set(s.postingId, addr);
  }
  return {
    gmail,
    today,
    due: plan.due.map((d) => ({ ...d, to: toFor.get(d.postingId) ?? "", ...followUpText(d) })),
    unmatched,
    recent,
    jobs: jobs.map((j) => ({ id: j.id, label: `${j.company} · ${j.title}${j.status === "new" ? "" : ` (${j.status})`}` })),
  };
}
