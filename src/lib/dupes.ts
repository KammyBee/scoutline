import { eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { looseKey, normUrl } from "./dedupe";

type Db = NodePgDatabase<typeof schema>;
const { postings, applications } = schema;

export type Duplicate = { id: string; title: string; company: string; keptId: string };

const RANK: Record<string, number> = { saved: 1, new: 2 };

/**
 * Finds jobs in To review or Saved that are a second copy of another job in your pipeline: the same link,
 * or the same company and title once tags like "(Remote)" and requisition numbers are ignored. The copy you
 * already acted on (applied, interviewing...) wins; otherwise Saved beats To review, then the older one.
 * With apply, the extra copies are removed from your list the same way "Remove from list" does.
 */
export async function hideDuplicates(db: Db, apply = true): Promise<Duplicate[]> {
  const rows = await db
    .select({ id: postings.id, num: postings.num, title: postings.title, company: postings.company, url: postings.url, status: applications.status })
    .from(postings)
    .innerJoin(applications, eq(applications.postingId, postings.id))
    .where(eq(postings.archived, false));
  const order = [...rows].sort((a, b) => (RANK[a.status] ?? 0) - (RANK[b.status] ?? 0) || (a.num ?? 1e9) - (b.num ?? 1e9) || a.id.localeCompare(b.id));
  const byKey = new Map<string, string>();
  const byUrl = new Map<string, string>();
  const dupes: Duplicate[] = [];
  for (const r of order) {
    const k = looseKey(r.company, r.title);
    const u = normUrl(r.url);
    const kept = byKey.get(k) ?? (u ? byUrl.get(u) : undefined);
    if (kept && r.status in RANK) {
      dupes.push({ id: r.id, title: r.title, company: r.company, keptId: kept });
      continue;
    }
    if (!byKey.has(k)) byKey.set(k, r.id);
    if (u && !byUrl.has(u)) byUrl.set(u, r.id);
  }
  if (apply && dupes.length) await db.update(postings).set({ archived: true, updatedAt: new Date() }).where(inArray(postings.id, dupes.map((d) => d.id)));
  return dupes;
}
