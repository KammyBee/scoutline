import "server-only";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrateDb, openDb } from "./open";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __scoutlineDb?: Promise<Db> };

async function init(): Promise<Db> {
  const db = await openDb();
  // The local PGlite database brings itself up to date on first use, so a new version of the app
  // never runs against old tables. Postgres/Neon is migrated explicitly with `npm run db:migrate`.
  if (!process.env.DATABASE_URL) await migrateDb(db);
  return db;
}

/**
 * One database handle per server process.
 * DATABASE_URL set → Postgres (Neon in production). Not set → a local PGlite database in .data/
 */
export function getDb(): Promise<Db> {
  if (!globalForDb.__scoutlineDb) {
    globalForDb.__scoutlineDb = init().catch((e) => {
      globalForDb.__scoutlineDb = undefined; // let the next request retry
      throw e;
    });
  }
  return globalForDb.__scoutlineDb;
}

export { schema };
