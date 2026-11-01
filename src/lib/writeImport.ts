import { inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { RESUMES } from "./resumes";
import type { MappedImport } from "./importDashboard";

type Db = NodePgDatabase<typeof schema>;

function chunks<T>(rows: T[], n = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += n) out.push(rows.slice(i, i + n));
  return out;
}

/**
 * Writes an import. Safe to run again: by default it only adds what's missing and never
 * overwrites changes you've made in the app. Pass { update: true } to overwrite from the export.
 */
export async function writeImport(db: Db, m: MappedImport, opts: { update?: boolean } = {}) {
  const { postings, matches, applications, emails, feedback, settings, resumes } = schema;
  const counts = { postings: 0, applications: 0, events: 0, emails: 0, feedback: 0 };

  await db.transaction(async (tx) => {
    for (const rows of chunks(m.postings)) {
      const q = tx.insert(postings).values(rows);
      const r = opts.update
        ? await q.onConflictDoUpdate({ target: postings.id, set: { ...excludedSet(postings, rows[0]), updatedAt: sql`now()` } }).returning({ id: postings.id })
        : await q.onConflictDoNothing().returning({ id: postings.id });
      counts.postings += r.length;
    }
    for (const rows of chunks(m.matches)) {
      const q = tx.insert(matches).values(rows);
      if (opts.update) await q.onConflictDoUpdate({ target: matches.postingId, set: excludedSet(matches, rows[0]) });
      else await q.onConflictDoNothing();
    }
    for (const rows of chunks(m.applications)) {
      const q = tx.insert(applications).values(rows);
      const r = opts.update
        ? await q.onConflictDoUpdate({ target: applications.postingId, set: { ...excludedSet(applications, rows[0]), updatedAt: sql`now()` } }).returning({ id: applications.postingId })
        : await q.onConflictDoNothing().returning({ id: applications.postingId });
      counts.applications += r.length;
    }

    // Events have no natural key unless they came from an email, so skip ones already stored.
    const postingIds = [...new Set(m.events.map((e) => e.postingId))];
    const existing = new Set<string>();
    for (const ids of chunks(postingIds, 500)) {
      const rows = await tx.select().from(schema.events).where(inArray(schema.events.postingId, ids));
      rows.forEach((e) => existing.add([e.postingId, e.date, e.kind, e.summary, e.emailId ?? ""].join("\u0001")));
    }
    const fresh = m.events.filter((e) => !existing.has([e.postingId, e.date, e.kind, e.summary, e.emailId ?? ""].join("\u0001")));
    for (const rows of chunks(fresh)) {
      const r = await tx.insert(schema.events).values(rows).onConflictDoNothing().returning({ id: schema.events.id });
      counts.events += r.length;
    }

    for (const rows of chunks(m.emails)) {
      const q = tx.insert(emails).values(rows);
      const r = opts.update
        ? await q.onConflictDoUpdate({ target: emails.id, set: excludedSet(emails, rows[0]) }).returning({ id: emails.id })
        : await q.onConflictDoNothing().returning({ id: emails.id });
      counts.emails += r.length;
    }

    const havePass = new Set((await tx.select({ id: feedback.postingId }).from(feedback).where(sql`${feedback.kind} = 'pass'`)).map((r) => r.id));
    const newFeedback = m.feedback.filter((f) => !havePass.has(f.postingId));
    if (newFeedback.length) counts.feedback = (await tx.insert(feedback).values(newFeedback).returning({ id: feedback.id })).length;

    for (const s of m.settings) {
      const q = tx.insert(settings).values({ key: s.key, value: s.value });
      if (opts.update) await q.onConflictDoUpdate({ target: settings.key, set: { value: s.value, updatedAt: sql`now()` } });
      else await q.onConflictDoNothing();
    }
    await tx.insert(resumes).values(RESUMES).onConflictDoNothing();
  });
  return counts;
}

/** Builds { col: excluded.col } for every column present in a row, for upserts. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function excludedSet(table: any, row: Record<string, unknown>) {
  const set: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    const col = table[key];
    if (col && col.name) set[key] = sql.raw(`excluded."${col.name}"`);
  }
  return set;
}
