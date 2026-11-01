import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { todayIn } from "./dates";
import type { JobDetail, JobRow, PipelineData } from "./types";

const { postings, applications, matches, events, settings } = schema;

const rowColumns = {
  id: postings.id,
  num: postings.num,
  title: postings.title,
  company: postings.company,
  location: postings.location,
  mode: postings.mode,
  employmentType: postings.employmentType,
  payText: postings.payText,
  payMin: postings.payMin,
  payMax: postings.payMax,
  url: postings.url,
  source: postings.source,
  posted: postings.posted,
  found: postings.found,
  tags: postings.tags,
  status: applications.status,
  appliedAt: applications.appliedAt,
  followUpAt: applications.followUpAt,
  passReason: applications.passReason,
  actionNeeded: applications.actionNeeded,
  interviewAt: applications.interviewAt,
  prep: applications.prep,
  fit: matches.fit,
};

export async function getPipeline(): Promise<PipelineData> {
  const db = await getDb();
  const [rows, evs, ans] = await Promise.all([
    db
      .select(rowColumns)
      .from(postings)
      .innerJoin(applications, eq(applications.postingId, postings.id))
      .leftJoin(matches, eq(matches.postingId, postings.id))
      .where(eq(postings.archived, false)),
    db.select({ postingId: events.postingId, kind: events.kind, date: events.date }).from(events),
    db.select().from(settings).where(eq(settings.key, "screeningAnswers")),
  ]);
  const last = new Map<string, { kind: string; date: string }>();
  for (const e of evs) {
    const cur = last.get(e.postingId);
    if (!cur || e.date >= cur.date) last.set(e.postingId, { kind: e.kind, date: e.date });
  }
  const jobs: JobRow[] = rows.map(({ prep, fit, ...r }) => ({
    ...r,
    hasPrep: !!prep?.text,
    fit: fit ?? 3,
    lastEvent: last.get(r.id) ?? null,
  }));
  return { jobs, answers: (ans[0]?.value as Record<string, string>) ?? {}, today: todayIn() };
}

export async function getJobDetail(id: string): Promise<JobDetail | null> {
  const db = await getDb();
  const [row] = await db
    .select({
      ...rowColumns,
      why: matches.why,
      verified: postings.verified,
      description: postings.description,
      descriptionSavedAt: postings.descriptionSavedAt,
      descriptionUnavailable: postings.descriptionUnavailable,
      notes: applications.notes,
      coverLetter: applications.coverLetter,
      resumeName: applications.resumeName,
      resumeUrl: applications.resumeUrl,
      kitTips: applications.kitTips,
      interviewEnd: applications.interviewEnd,
      thankYou: applications.thankYou,
    })
    .from(postings)
    .innerJoin(applications, eq(applications.postingId, postings.id))
    .leftJoin(matches, eq(matches.postingId, postings.id))
    .where(and(eq(postings.id, id), eq(postings.archived, false)));
  if (!row) return null;
  const evs = await db
    .select({ id: events.id, date: events.date, kind: events.kind, summary: events.summary, link: events.link })
    .from(events)
    .where(eq(events.postingId, id))
    .orderBy(desc(events.date), desc(events.id));
  const { prep, fit, ...rest } = row;
  return {
    ...rest,
    prep: prep ?? null,
    hasPrep: !!prep?.text,
    fit: fit ?? 3,
    events: evs,
    lastEvent: evs[0] ? { kind: evs[0].kind, date: evs[0].date } : null,
  };
}
