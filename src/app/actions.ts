"use server";

import { eq, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { getDb, schema } from "@/db/client";
import { STATUSES, type Status } from "@/db/schema";
import { addDays, todayIn } from "@/lib/dates";
import { AiUnavailable, aiConfigured } from "@/lib/ai/claude";
import { answerQuestion, scoreWithClaude, writeCoverLetter } from "@/lib/ai/features";
import { checkAndScore } from "@/lib/feeds/run";
import { rescoreAll } from "@/lib/rescore";
import { getJobDetail } from "@/lib/queries";
import { requireSession } from "@/lib/requireSession";
import type { JobDetail } from "@/lib/types";

const { applications, matches, postings, feedback } = schema;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function loadJob(id: string): Promise<JobDetail | null> {
  await requireSession();
  return getJobDetail(String(id));
}

/** Moves an application to a new status, filling in the dates that go with it. */
export async function setStatus(id: string, status: Status, passReason?: string): Promise<JobDetail | null> {
  await requireSession();
  if (!(STATUSES as readonly string[]).includes(status)) throw new Error("Unknown status");
  const db = await getDb();
  const today = todayIn();
  const [cur] = await db.select().from(applications).where(eq(applications.postingId, id));
  if (!cur) throw new Error("No such job");
  const patch: Partial<typeof applications.$inferInsert> = { status, updatedAt: new Date() };
  if (status === "applied" && !cur.appliedAt) {
    patch.appliedAt = today;
    patch.followUpAt = cur.followUpAt ?? addDays(today, 7);
  }
  if (status === "passed") {
    patch.passedAt = today;
    patch.passReason = passReason?.slice(0, 80) || "Other";
  } else if (cur.status === "passed") {
    patch.passReason = null;
    patch.passedAt = null;
  }
  if (status === "noresponse") patch.noResponseAt = today;
  await db.update(applications).set(patch).where(eq(applications.postingId, id));
  if (status === "passed") {
    const [p] = await db.select({ title: postings.title, company: postings.company }).from(postings).where(eq(postings.id, id));
    await db.insert(feedback).values({ postingId: id, kind: "pass", reason: patch.passReason, title: p?.title, company: p?.company });
    // "Not for me" style passes lower the score of similar titles still in your list.
    if (["Not for me", "Not interested", "Wrong stack"].includes(patch.passReason ?? "")) await rescoreAll(db);
  }
  refresh();
  return getJobDetail(id);
}

const TEXT_FIELDS = { notes: applications.notes, coverLetter: applications.coverLetter } as const;
const DATE_FIELDS = { appliedAt: applications.appliedAt, followUpAt: applications.followUpAt } as const;

export async function saveText(id: string, field: keyof typeof TEXT_FIELDS, value: string): Promise<void> {
  await requireSession();
  if (!(field in TEXT_FIELDS)) throw new Error("Unknown field");
  const db = await getDb();
  await db.update(applications).set({ [field]: String(value).slice(0, 20000), updatedAt: new Date() }).where(eq(applications.postingId, id));
}

export async function saveDate(id: string, field: keyof typeof DATE_FIELDS, value: string | null): Promise<void> {
  await requireSession();
  if (!(field in DATE_FIELDS)) throw new Error("Unknown field");
  if (value && !DAY.test(value)) throw new Error("Use YYYY-MM-DD");
  const db = await getDb();
  await db.update(applications).set({ [field]: value || null, updatedAt: new Date() }).where(eq(applications.postingId, id));
  refresh();
}

export async function setFit(id: string, fit: number): Promise<void> {
  await requireSession();
  const n = Math.max(1, Math.min(5, Math.round(Number(fit))));
  const db = await getDb();
  await db
    .insert(matches)
    .values({ postingId: id, fit: n, scoredBy: "you" })
    .onConflictDoUpdate({ target: matches.postingId, set: { fit: n, scoredBy: "you", scoredAt: sql`now()` } });
  refresh();
}

export async function markActionDone(id: string): Promise<void> {
  await requireSession();
  const db = await getDb();
  const [cur] = await db.select({ a: applications.actionNeeded }).from(applications).where(eq(applications.postingId, id));
  if (!cur?.a) return;
  await db.update(applications).set({ actionNeeded: { ...cur.a, done: true }, updatedAt: new Date() }).where(eq(applications.postingId, id));
  refresh();
}

/** Hides a job but keeps it in the database, so the same role is never suggested again. */
export async function archiveJob(id: string): Promise<void> {
  await requireSession();
  const db = await getDb();
  await db.update(postings).set({ archived: true, updatedAt: new Date() }).where(eq(postings.id, id));
  refresh();
}

export type CheckResult = { companiesChecked: number; jobsMatched: number; added: number; failed: number; switchedOff: string[]; claudeScored: number; claudeNote: string | null };

/** "Check for new jobs": reads every watched job board now instead of waiting for the nightly run. */
export async function checkForJobs(): Promise<CheckResult> {
  await requireSession();
  const s = await checkAndScore(await getDb(), { trigger: "manual" });
  refresh();
  return { companiesChecked: s.companiesChecked, jobsMatched: s.jobsMatched, added: s.added, failed: s.failed, switchedOff: s.switchedOff, claudeScored: s.claudeScored, claudeNote: s.claudeNote };
}

/** "More like this": remembers which of your skills this job uses and ranks similar jobs higher. */
export async function likeJob(id: string): Promise<JobDetail | null> {
  await requireSession();
  const db = await getDb();
  const [p] = await db.select({ title: postings.title, company: postings.company, hits: matches.hits }).from(postings).leftJoin(matches, eq(matches.postingId, postings.id)).where(eq(postings.id, id));
  if (!p) throw new Error("No such job");
  await db.insert(feedback).values({ postingId: id, kind: "like", title: p.title, company: p.company, terms: p.hits ?? [] });
  await rescoreAll(db);
  refresh();
  return getJobDetail(id);
}

export type AiResult<T> = { ok: true; value: T } | { ok: false; error: string };
async function ai<T>(fn: () => Promise<T>): Promise<AiResult<T>> {
  await requireSession();
  if (!aiConfigured()) return { ok: false, error: "Add your ANTHROPIC_API_KEY to .env.local (or Vercel) to use Claude features." };
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    if (e instanceof AiUnavailable) return { ok: false, error: e.message };
    console.error("Claude call failed", e);
    return { ok: false, error: "Claude didn't answer. Try again in a moment." };
  }
}

export async function scoreJob(id: string): Promise<AiResult<JobDetail | null>> {
  return ai(async () => {
    const db = await getDb();
    await scoreWithClaude(db, [id]);
    refresh();
    return getJobDetail(id);
  });
}

export async function draftCoverLetter(id: string): Promise<AiResult<string>> {
  return ai(async () => writeCoverLetter(await getDb(), id));
}

export async function draftAnswer(id: string, question: string): Promise<AiResult<string>> {
  const q = String(question ?? "").trim();
  if (!q) return { ok: false, error: "Paste the question first." };
  return ai(async () => answerQuestion(await getDb(), id, q));
}
