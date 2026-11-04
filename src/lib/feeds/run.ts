import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { aiConfigured } from "../ai/claude";
import { autoDraftLetters, scoreNewJobs } from "../ai/features";
import { runFeeds, type RunOptions, type RunSummary } from "./ingest";

type Db = NodePgDatabase<typeof schema>;

export type CheckSummary = RunSummary & { claudeScored: number; claudeNote: string | null; lettersDrafted: number };

/**
 * Checks the job boards, then (if a Claude API key is set) has Claude score the new jobs and pick a resume
 * for each, then drafts cover letters for the best matches. Drafts only: nothing is ever submitted.
 */
export async function checkAndScore(db: Db, opts: RunOptions): Promise<CheckSummary> {
  const s = await runFeeds(db, opts);
  let claudeScored = 0;
  let claudeNote: string | null = null;
  if (s.newJobs.length && aiConfigured()) {
    try {
      claudeScored = await scoreNewJobs(db, s.newJobs.map((j) => j.id));
    } catch (e) {
      claudeNote = "Claude scoring skipped: " + (e instanceof Error ? e.message : String(e));
    }
  }
  let lettersDrafted = 0;
  if (aiConfigured() && !claudeNote) {
    const r = await autoDraftLetters(db, opts.today);
    lettersDrafted = r.written;
    claudeNote = r.note;
  }
  return { ...s, claudeScored, claudeNote, lettersDrafted };
}
