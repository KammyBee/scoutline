import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { dedupeKey, slugify } from "../dedupe";
import { todayIn } from "../dates";
import { computeMatch, whyFromMatch, type Prefs } from "../match";
import { loadPrefs } from "../rescore";
import { fetchBoard, fetchGreenhouseDescription } from "./boards";
import { TIER_FIT, judge } from "./rules";
import { ATS_LABEL, type Ats, type FeedJob, type Fetcher } from "./types";

type Db = NodePgDatabase<typeof schema>;
const { companies, postings, applications, matches, feedRuns } = schema;

export type RunSummary = {
  runId: number;
  companiesChecked: number;
  jobsSeen: number;
  jobsMatched: number;
  added: number;
  failed: number;
  switchedOff: string[];
  errors: { company: string; error: string }[];
  newJobs: { id: string; title: string; company: string }[];
};

export type RunOptions = {
  fetcher?: Fetcher;
  trigger: "cron" | "manual" | "script";
  today?: string;
  /** only these companies (by id); default: every active one */
  companyIds?: number[];
  /** newest jobs added per company per run */
  perCompanyLimit?: number;
  concurrency?: number;
};

async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

/** Checks every watched company's job board and adds new matching roles to your review list. */
export async function runFeeds(db: Db, opts: RunOptions): Promise<RunSummary> {
  const fetcher: Fetcher = opts.fetcher ?? ((url, init) => fetch(url, init));
  const today = opts.today ?? todayIn();
  const startedAt = new Date().toISOString();
  const limit = opts.perCompanyLimit ?? 25;

  let list = await db.select().from(companies).where(and(eq(companies.active, true), isNotNull(companies.ats), isNotNull(companies.board)));
  if (opts.companyIds?.length) list = list.filter((c) => opts.companyIds!.includes(c.id));

  // Everything already in the database, so nothing is added twice.
  const existing = await db.select({ key: postings.dedupeKey, url: postings.url, ref: postings.atsRef, id: postings.id }).from(postings);
  const keys = new Set(existing.map((e) => e.key));
  const urls = new Set(existing.map((e) => e.url).filter(Boolean) as string[]);
  const refs = new Set(existing.map((e) => e.ref).filter(Boolean) as string[]);
  const ids = new Set(existing.map((e) => e.id));
  const [{ maxNum }] = await db.select({ maxNum: sql<number>`coalesce(max(${postings.num}), 0)` }).from(postings);
  let nextNum = Number(maxNum) + 1;
  const prefs: Prefs = await loadPrefs(db);

  const summary: RunSummary = { runId: 0, companiesChecked: 0, jobsSeen: 0, jobsMatched: 0, added: 0, failed: 0, switchedOff: [], errors: [], newJobs: [] };

  await pool(list, opts.concurrency ?? 4, async (c) => {
    const ats = c.ats as Ats;
    const board = c.board!;
    const res = await fetchBoard(fetcher, ats, board);
    summary.companiesChecked++;
    const checkedAt = new Date().toISOString();
    if (!res.ok) {
      summary.failed++;
      const neverWorked = c.lastStatus !== "ok";
      const switchOff = res.status === "not_found" && neverWorked;
      const error = switchOff ? `${res.error}. Switched off; check the board name.` : res.error;
      summary.errors.push({ company: c.name, error });
      if (switchOff) summary.switchedOff.push(c.name);
      await db.update(companies).set({ lastCheckedAt: checkedAt, lastStatus: res.status, lastError: error, ...(switchOff ? { active: false } : {}) }).where(eq(companies.id, c.id));
      return;
    }

    summary.jobsSeen += res.jobs.length;
    const kept = res.jobs.map((j) => ({ j, v: judge(j, today) })).filter((x): x is { j: FeedJob; v: Extract<ReturnType<typeof judge>, { keep: true }> } => x.v.keep);
    summary.jobsMatched += kept.length;

    const fresh = kept
      .filter(({ j }) => {
        const ref = `${ats}:${board}:${j.externalId}`;
        return !refs.has(ref) && !(j.url && urls.has(j.url)) && !keys.has(dedupeKey(c.name, j.title));
      })
      .sort((a, b) => String(b.j.posted ?? "").localeCompare(String(a.j.posted ?? "")))
      .slice(0, limit);

    // Reserve keys now so two companies in the same run can't add the same role.
    for (const { j } of fresh) {
      refs.add(`${ats}:${board}:${j.externalId}`);
      if (j.url) urls.add(j.url);
      keys.add(dedupeKey(c.name, j.title));
    }

    const rows: (typeof postings.$inferInsert)[] = [];
    const fits: { id: string; fit: number; why: string; hits: string[]; gaps: string[] }[] = [];
    for (const { j, v } of fresh) {
      const description = j.description ?? (ats === "greenhouse" ? await fetchGreenhouseDescription(fetcher, board, j.externalId) : null);
      let id = slugify(`${c.name}-${j.title}`, 50) + "-" + slugify(j.externalId, 8);
      while (ids.has(id)) id += "x";
      ids.add(id);
      rows.push({
        id,
        num: nextNum++,
        title: j.title,
        company: c.name,
        location: j.location || (v.mode === "remote" ? "Remote" : ""),
        mode: v.mode,
        employmentType: j.employmentType,
        payText: j.payText,
        payMin: j.payMin,
        payMax: j.payMax,
        url: j.url || null,
        source: `${ATS_LABEL[ats]} · ${c.name}`,
        posted: j.posted,
        found: today,
        verified: today,
        description,
        descriptionSavedAt: description ? checkedAt : null,
        tags: ["Watch list"],
        dedupeKey: dedupeKey(c.name, j.title),
        atsRef: `${ats}:${board}:${j.externalId}`,
      });
      const m = computeMatch(j.title, description, prefs);
      // The title tier keeps a strong ERP title from sinking just because the posting text is short.
      fits.push({ id, fit: Math.max(m.fit, TIER_FIT[v.tier] - 1), why: whyFromMatch(m), hits: m.hits, gaps: m.gaps });
    }

    let added: string[] = [];
    if (rows.length) {
      await db.transaction(async (tx) => {
        const inserted = await tx.insert(postings).values(rows).onConflictDoNothing().returning({ id: postings.id });
        added = inserted.map((r) => r.id);
        if (!added.length) return;
        await tx.insert(applications).values(added.map((postingId) => ({ postingId, status: "new" as const }))).onConflictDoNothing();
        await tx.insert(matches).values(fits.filter((f) => added.includes(f.id)).map((f) => ({ postingId: f.id, fit: f.fit, why: f.why, hits: f.hits, gaps: f.gaps, scoredBy: "rules" }))).onConflictDoNothing();
      });
    }
    summary.added += added.length;
    for (const r of rows) if (added.includes(r.id!)) summary.newJobs.push({ id: r.id!, title: r.title, company: r.company });
    await db.update(companies).set({ lastCheckedAt: checkedAt, lastStatus: "ok", lastError: null, lastJobCount: res.jobs.length, lastMatchCount: kept.length }).where(eq(companies.id, c.id));
  });

  const [run] = await db
    .insert(feedRuns)
    .values({
      trigger: opts.trigger,
      startedAt,
      finishedAt: new Date().toISOString(),
      companiesChecked: summary.companiesChecked,
      jobsSeen: summary.jobsSeen,
      jobsMatched: summary.jobsMatched,
      added: summary.added,
      failed: summary.failed,
      errors: summary.errors,
    })
    .returning({ id: feedRuns.id });
  summary.runId = run.id;
  return summary;
}

/** Tests one board without saving anything; used when you add a company. */
export async function testBoard(ats: Ats, board: string, fetcher?: Fetcher, today = todayIn()) {
  const res = await fetchBoard(fetcher ?? ((url, init) => fetch(url, init)), ats, board);
  if (!res.ok) return res;
  const matched = res.jobs.filter((j) => judge(j, today).keep).length;
  return { ok: true as const, total: res.jobs.length, matched };
}

export async function lastRun(db: Db) {
  const [r] = await db.select().from(feedRuns).orderBy(sql`${feedRuns.id} desc`).limit(1);
  return r ?? null;
}

