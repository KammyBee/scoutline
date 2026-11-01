import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { asDay, mapExport } from "@/lib/importDashboard";
import { writeImport } from "@/lib/writeImport";
import { sampleExport } from "./fixtures";

describe("mapExport", () => {
  const m = mapExport(sampleExport);

  it("keeps valid jobs and skips ones without an id", () => {
    expect(m.applications.map((a) => a.postingId)).toEqual(["acme-erp-developer", "acme-erp-developer-dup", "globex-bsa"]);
    expect(m.warnings.some((w) => w.startsWith("Skipped"))).toBe(true);
  });

  it("keeps a second copy of the same role but gives it a distinct key, and drops its shared link", () => {
    const [a, b] = m.postings;
    expect(a.dedupeKey).toBe("acme manufacturing|erp developer");
    expect(b.dedupeKey).toBe("acme manufacturing|erp developer#acme-erp-developer-dup");
    expect(b.url).toBeNull();
  });

  it("cleans up bad values", () => {
    const dup = m.applications.find((x) => x.postingId === "acme-erp-developer-dup")!;
    expect(dup.status).toBe("new");
    expect(m.matches.find((x) => x.postingId === "acme-erp-developer-dup")!.fit).toBe(5);
    expect(m.postings[1].found).toBeNull();
    expect(asDay("2026-02-30")).toBeNull();
    expect(asDay("2026-10-21T08:00:00Z")).toBe("2026-10-21");
  });

  it("archives seen roles that are not already jobs", () => {
    const archived = m.postings.filter((p) => p.archived);
    expect(archived.map((p) => p.company + " | " + p.title)).toEqual(["Initech | SAP Analyst"]);
  });

  it("maps history, emails, pass reasons and answers", () => {
    expect(m.events).toHaveLength(1);
    expect(m.emails.find((e) => e.id === "m2")!.postingId).toBeNull();
    expect(m.feedback).toEqual([{ postingId: "globex-bsa", kind: "pass", reason: "Too senior", title: "Business Systems Analyst", company: "Globex" }]);
    expect(m.settings[0]).toEqual({ key: "screeningAnswers", value: { linkedin: "https://linkedin.example/in/someone" } });
  });
});

describe("writeImport", () => {
  it("writes everything once and is safe to run again", async () => {
    const client = new PGlite();
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: "drizzle" });
    const pg = db as unknown as NodePgDatabase<typeof schema>;
    const m = mapExport(sampleExport);

    const first = await writeImport(pg, m);
    expect(first).toMatchObject({ postings: 4, applications: 3, events: 1, emails: 2, feedback: 1 });

    await pg.update(schema.applications).set({ notes: "my own note" }).where(eq(schema.applications.postingId, "acme-erp-developer"));
    const again = await writeImport(pg, m);
    expect(again).toMatchObject({ postings: 0, applications: 0, events: 0, emails: 0, feedback: 0 });
    const [row] = await pg.select().from(schema.applications).where(eq(schema.applications.postingId, "acme-erp-developer"));
    expect(row.notes).toBe("my own note");

    // The database itself refuses a second posting with the same company + title.
    await expect(
      pg.insert(schema.postings).values({ id: "x", title: "ERP Developer", company: "Acme", dedupeKey: "acme manufacturing|erp developer" }),
    ).rejects.toThrow();
    await client.close();
  });
});
