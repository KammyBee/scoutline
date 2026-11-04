import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { dedupeKey, looseKey, normUrl, slugify } from "../dedupe";
import { todayIn } from "../dates";
import { computeMatch, whyFromMatch, type Prefs } from "../match";
import { hideDuplicates } from "../dupes";
import { loadPrefs } from "../rescore";
import { pickResume } from "../resumes";
import { fetchBoard, fetchDescription } from "./boards";
import { TIER_FIT, judge } from "./rules";
import { ATS_LABEL, isSearchSource, type Ats, type FeedJob, type Fetcher } from "./types";

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
  /** second copies found already sitting in To review or Saved, and removed */
  duplicatesRemoved: number;
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

/** Search sources list many employers; a company board's jobs all belong to the watched company. */
const companyOf = (j: FeedJob, watched: string) => (j.company?.trim() ? j.company.trim().slice(0, 120) : watched);

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

  // Everything already in the database (including jobs you removed), so nothing is added twice. Besides the exact
  // key, jobs are compared by a looser company + title and by link, which catches the same job posted on a
  // company board and on a job site, or under "Acme Inc." on one and "Acme" on another.
  const existing = await db.select({ key: postings.dedupeKey, url: postings.url, ref: postings.atsRef, id: postings.id, company: postings.company, title: postings.title }).from(postings);
  const keys = new Set(existing.map((e) => e.key));
  const loose = new Set(existing.map((e) => looseKey(e.company, e.title)));
  const urls = new Set(existing.map((e) => normUrl(e.url)).filter(Boolean));
  const refs = new Set(existing.map((e) => e.ref).filter(Boolean) as string[]);
  const ids = new Set(existing.map((e) => e.id));
  const [{ maxNum }] = await db.select({ maxNum: sql<number>`coalesce(max(${postings.num}), 0)` }).from(postings);
  let nextNum = Number(maxNum) + 1;
  const prefs: Prefs = await loadPrefs(db);

  const summary: RunSummary = { runId: 0, companiesChecked: 0, jobsSeen: 0, jobsMatched: 0, added: 0, failed: 0, switchedOff: [], errors: [], newJobs: [], duplicatesRemoved: 0 };

  await pool(list, opts.concurrency ?? 4, async (c) => {
    const ats = c.ats as Ats;
    const board = c.board!;
    const res = await fetchBoard(fetcher, ats, board, today);
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

    // Newest first; each job is checked and reserved in one pass, so a second copy in the same list, or on
    // another board later in this run, is skipped too.
    const searching = isSearchSource(ats);
    const fresh: typeof kept = [];
    for (const x of [...kept].sort((a, b) => String(b.j.posted ?? "").localeCompare(String(a.j.posted ?? "")))) {
      if (fresh.length >= (searching ? Math.max(limit, 40) : limit)) break;
      const company = companyOf(x.j, c.name);
      const ref = `${ats}:${board}:${x.j.externalId}`;
      const u = normUrl(x.j.url);
      const k = dedupeKey(company, x.j.title), lk = looseKey(company, x.j.title);
      if (refs.has(ref) || (u && urls.has(u)) || keys.has(k) || loose.has(lk)) continue;
      refs.add(ref);
      if (u) urls.add(u);
      keys.add(k);
      loose.add(lk);
      fresh.push(x);
    }

    const rows: (typeof postings.$inferInsert)[] = [];
    const fits: { id: string; fit: number; why: string; hits: string[]; gaps: string[] }[] = [];
    const picks = new Map<string, { name: string; url: string }>();
    for (const { j, v } of fresh) {
      const company = companyOf(j, c.name);
      const description = j.description ?? (await fetchDescription(fetcher, ats, board, j.externalId));
      let id = slugify(`${company}-${j.title}`, 50) + "-" + slugify(j.externalId, 8);
      while (ids.has(id)) id += "x";
      ids.add(id);
      rows.push({
        id,
        num: nextNum++,
        title: j.title,
        company,
        location: j.location || (v.mode === "remote" ? "Remote" : ""),
        mode: v.mode,
        employmentType: j.employmentType,
        payText: j.payText,
        payMin: j.payMin,
        payMax: j.payMax,
        url: j.url || null,
        source: `${ATS_LABEL[ats]} · ${company}`,
        posted: j.posted,
        found: today,
        verified: today,
        description,
        descriptionSavedAt: description ? checkedAt : null,
        tags: [searching ? "Broad search" : "Watch list"],
        dedupeKey: dedupeKey(company, j.title),
        atsRef: `${ats}:${board}:${j.externalId}`,
      });
      const m = computeMatch(j.title, description, prefs);
      // The title tier keeps a strong ERP title from sinking just because the posting text is short.
      fits.push({ id, fit: Math.max(m.fit, TIER_FIT[v.tier] - 1), why: whyFromMatch(m), hits: m.hits, gaps: m.gaps });
      picks.set(id, pickResume(j.title, description));
    }

    let added: string[] = [];
    if (rows.length) {
      await db.transaction(async (tx) => {
        const inserted = await tx.insert(postings).values(rows).onConflictDoNothing().returning({ id: postings.id });
        added = inserted.map((r) => r.id);
        if (!added.length) return;
        await tx
          .insert(applications)
          .values(added.map((postingId) => ({ postingId, status: "new" as const, resumeName: picks.get(postingId)?.name, resumeUrl: picks.get(postingId)?.url, resumePickedBy: "rules" })))
          .onConflictDoNothing();
        await tx.insert(matches).values(fits.filter((f) => added.includes(f.id)).map((f) => ({ postingId: f.id, fit: f.fit, why: f.why, hits: f.hits, gaps: f.gaps, scoredBy: "rules" }))).onConflictDoNothing();
      });
    }
    summary.added += added.length;
    for (const r of rows) if (added.includes(r.id!)) summary.newJobs.push({ id: r.id!, title: r.title, company: r.company });
    await db.update(companies).set({ lastCheckedAt: checkedAt, lastStatus: "ok", lastError: null, lastJobCount: res.jobs.length, lastMatchCount: kept.length }).where(eq(companies.id, c.id));
  });

  // Belt and braces: anything that slipped in earlier (imports, older checks) is cleared out of To review too.
  const dupes = await hideDuplicates(db);
  summary.duplicatesRemoved = dupes.length;
  if (dupes.length) {
    const gone = new Set(dupes.map((d) => d.id));
    summary.newJobs = summary.newJobs.filter((j) => !gone.has(j.id));
    summary.added = summary.newJobs.length;
  }

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
  const res = await fetchBoard(fetcher ?? ((url, init) => fetch(url, init)), ats, board, today);
  if (!res.ok) return res;
  const matched = res.jobs.filter((j) => judge(j, today).keep).length;
  return { ok: true as const, total: res.jobs.length, matched };
}

export async function lastRun(db: Db) {
  const [r] = await db.select().from(feedRuns).orderBy(sql`${feedRuns.id} desc`).limit(1);
  return r ?? null;
}

