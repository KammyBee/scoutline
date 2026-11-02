import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { computeMatch, prefsFrom, whyFromMatch, type Prefs } from "./match";

type Db = NodePgDatabase<typeof schema>;
const { postings, matches, feedback } = schema;

export async function loadPrefs(db: Db): Promise<Prefs> {
  const rows = await db.select({ kind: feedback.kind, reason: feedback.reason, title: feedback.title, terms: feedback.terms }).from(feedback);
  return prefsFrom(rows);
}

/**
 * Recomputes skill chips for every job, and the fit of jobs scored only by rules.
 * Fits set by Claude or by you are left alone. Only rows whose values change are written.
 */
export async function rescoreAll(db: Db): Promise<{ updated: number }> {
  const prefs = await loadPrefs(db);
  const rows = await db
    .select({ id: postings.id, title: postings.title, description: postings.description, scoredBy: matches.scoredBy, fit: matches.fit, why: matches.why, hits: matches.hits, gaps: matches.gaps })
    .from(postings)
    .leftJoin(matches, eq(matches.postingId, postings.id))
    .where(eq(postings.archived, false));
  const same = (a: string[] | null, b: string[]) => JSON.stringify(a ?? []) === JSON.stringify(b);
  let updated = 0;
  for (const r of rows) {
    const m = computeMatch(r.title, r.description, prefs);
    const why = whyFromMatch(m);
    if (!r.scoredBy) {
      await db.insert(matches).values({ postingId: r.id, fit: m.fit, why, hits: m.hits, gaps: m.gaps, scoredBy: "rules" }).onConflictDoNothing();
      updated++;
    } else if (r.scoredBy === "rules") {
      if (r.fit === m.fit && r.why === why && same(r.hits, m.hits) && same(r.gaps, m.gaps)) continue;
      await db.update(matches).set({ fit: m.fit, why, hits: m.hits, gaps: m.gaps }).where(eq(matches.postingId, r.id));
      updated++;
    } else if (!same(r.hits, m.hits) || !same(r.gaps, m.gaps)) {
      await db.update(matches).set({ hits: m.hits, gaps: m.gaps }).where(eq(matches.postingId, r.id));
      updated++;
    }
  }
  return { updated };
}
