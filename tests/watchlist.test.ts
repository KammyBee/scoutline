import { PGlite } from "@electric-sql/pglite";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { listCompanies, seedStarterList } from "@/lib/companies";
import { SMALLER_COMPANIES, STARTER_WATCHLIST } from "@/lib/feeds/watchlist";

// Companies Kam took off the watch list. They must never come back from the starter list.
const REMOVED = ["10x Genomics", "Applied Intuition", "Aurora", "Joby Aviation", "Plaid"];

describe("starter watch list", () => {
  it("has no repeated companies or job boards", () => {
    const names = STARTER_WATCHLIST.map((c) => c.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    const boards = STARTER_WATCHLIST.filter((c) => c.board !== "search").map((c) => `${c.ats}|${c.board.toLowerCase()}`);
    expect(new Set(boards).size).toBe(boards.length);
  });

  it("leaves out companies you removed", () => {
    const names = STARTER_WATCHLIST.map((c) => c.name.toLowerCase());
    for (const r of REMOVED) expect(names.some((n) => n.includes(r.toLowerCase()))).toBe(false);
  });

  it("adds only the smaller companies when asked, and never twice", async () => {
    const client = new PGlite();
    const db = drizzle(client, { schema }) as unknown as NodePgDatabase<typeof schema>;
    await migrate(db as never, { migrationsFolder: "drizzle" });
    await db.insert(schema.companies).values({ name: "Samsara", ats: "greenhouse", board: "samsara" });
    expect(await seedStarterList(db, SMALLER_COMPANIES)).toBe(SMALLER_COMPANIES.length);
    expect(await seedStarterList(db, SMALLER_COMPANIES)).toBe(0);
    const names = (await listCompanies(db)).map((c) => c.name);
    expect(names).toHaveLength(SMALLER_COMPANIES.length + 1);
    expect(names).not.toContain("Verkada"); // other starter companies are not added back
  });
});
