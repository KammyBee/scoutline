import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { aiConfigured } from "../ai/claude";
import { scoreNewJobs } from "../ai/features";
import { runFeeds, type RunOptions, type RunSummary } from "./ingest";

type Db = NodePgDatabase<typeof schema>;

export type CheckSummary = RunSummary & { claudeScored: number; claudeNote: string | null };

/** Checks the job boards, then (if a Claude API key is set) has Claude score the new jobs. */
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
  return { ...s, claudeScored, claudeNote };
}
