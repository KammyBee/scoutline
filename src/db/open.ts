import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

type Db = NodePgDatabase<typeof schema>;

/** Opens Postgres when DATABASE_URL is set, otherwise a local PGlite database (no install needed). */
export async function openDb(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const pool = new Pool({ connectionString: url, max: Number(process.env.DATABASE_POOL_MAX) || 3 });
    return drizzle(pool, { schema });
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const dir = process.env.PGLITE_DIR || ".data/pglite";
  if (dir !== "memory://") (await import("node:fs")).mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  // Same query builder API as node-postgres; the cast keeps one Db type across the app.
  return drizzle(client, { schema }) as unknown as Db;
}

/** Applies the SQL migrations in ./drizzle to whichever database openDb() picks. */
export async function migrateDb(db: Db, migrationsFolder = "drizzle") {
  if (process.env.DATABASE_URL) {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(db, { migrationsFolder });
  } else {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await migrate(db as any, { migrationsFolder });
  }
}
