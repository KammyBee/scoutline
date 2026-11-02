import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { asc } from "drizzle-orm";
import * as schema from "@/db/schema";
import { STARTER_WATCHLIST } from "./feeds/watchlist";

type Db = NodePgDatabase<typeof schema>;

export type CompanyRow = typeof schema.companies.$inferSelect;

export async function listCompanies(db: Db): Promise<CompanyRow[]> {
  return db.select().from(schema.companies).orderBy(asc(schema.companies.name));
}

/** Adds the starter watch list; companies already on your list are left as they are. */
export async function seedStarterList(db: Db): Promise<number> {
  const rows = await db
    .insert(schema.companies)
    .values(STARTER_WATCHLIST.map((c) => ({ ...c, active: true })))
    .onConflictDoNothing()
    .returning({ id: schema.companies.id });
  return rows.length;
}
