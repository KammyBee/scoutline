import "server-only";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { openDb } from "./open";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __scoutlineDb?: Promise<Db> };

/**
 * One database handle per server process.
 * DATABASE_URL set → Postgres (Neon in production). Not set → a local PGlite database in .data/
 */
export function getDb(): Promise<Db> {
  if (!globalForDb.__scoutlineDb) globalForDb.__scoutlineDb = openDb();
  return globalForDb.__scoutlineDb;
}

export { schema };
