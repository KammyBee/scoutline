import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { parseAshbyList, parseBoardUrl, parseGreenhouseList, parseLeverList, parseMoneyRange } from "@/lib/feeds/boards";
import { runFeeds } from "@/lib/feeds/ingest";
import { judge, placeFor, titleTier } from "@/lib/feeds/rules";
import { htmlToText } from "@/lib/feeds/text";
import type { Fetcher } from "@/lib/feeds/types";
import { ashbyList, greenhouseJob101, greenhouseList, leverList } from "./feedFixtures";

const TODAY = "2026-11-01";

describe("board readers", () => {
  it("reads Greenhouse lists", () => {
    const jobs = parseGreenhouseList("acmehw", greenhouseList);
    expect(jobs).toHaveLength(6);
    expect(jobs[0]).toMatchObject({ externalId: "101", location: "San Francisco, CA", posted: "2026-10-28", url: "https://job-boards.greenhouse.io/acmehw/jobs/101" });
  });
  it("reads Lever lists with pay and descriptions", () => {
    const [a, b] = parseLeverList("robocorp", leverList);
    expect(a).toMatchObject({ title: "ERP Developer (Epicor)", workplace: "remote", country: "US", payMin: 110000, payMax: 140000, posted: "2026-10-25", employmentType: "Full-time" });
    expect(a.description).toContain("- SQL Server");
    expect(b.workplace).toBe("onsite");
  });
  it("reads Ashby lists, skipping unlisted jobs", () => {
    const jobs = parseAshbyList("chipco", ashbyList);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ workplace: "hybrid", country: "USA", payMin: 130000, payMax: 165000, employmentType: "Full-Time", location: "San Francisco; Remote - US" });
  });
  it("turns escaped HTML into text", () => {
    expect(htmlToText(greenhouseJob101.content)).toBe("Own our NetSuite ERP.\n\n- SQL\n- Integrations & APIs");
  });
  it("parses pay ranges", () => {
    expect(parseMoneyRange("$120,000 - $150,000")).toEqual({ min: 120000, max: 150000 });
    expect(parseMoneyRange("$60 – $70 per hour")).toBeNull();
  });
  it("recognizes job board links", () => {
    expect(parseBoardUrl("https://job-boards.greenhouse.io/anthropic/jobs/123")).toEqual({ ats: "greenhouse", board: "anthropic" });
    expect(parseBoardUrl("https://boards.greenhouse.io/embed/job_app?for=samsara&token=1")).toEqual({ ats: "greenhouse", board: "samsara" });
    expect(parseBoardUrl("jobs.lever.co/zoox/abc-123/apply")).toEqual({ ats: "lever", board: "zoox" });
    expect(parseBoardUrl("https://jobs.ashbyhq.com/notion")).toEqual({ ats: "ashby", board: "notion" });
    expect(parseBoardUrl("https://www.linkedin.com/jobs/view/1")).toBeNull();
  });
});

describe("filters", () => {
  it("ranks titles by how close they are to your work", () => {
    expect(titleTier("ERP Systems Analyst")).toBe("A");
    expect(titleTier("Business Systems Engineer")).toBe("A");
    expect(titleTier("Application Support Analyst")).toBe("B");
    expect(titleTier("Software Engineer")).toBe("C");
    expect(titleTier("Senior ERP Engineer")).toBeNull();
    expect(titleTier("Account Executive")).toBeNull();
    expect(titleTier("Software Engineering Intern")).toBeNull();
  });
  it("keeps remote US and Bay Area roles only", () => {
    expect(placeFor({ location: "Remote - US", workplace: null, country: null })).toBe("remote");
    expect(placeFor({ location: "Remote", workplace: "remote", country: "CA" })).toBeNull();
    expect(placeFor({ location: "Remote - EMEA", workplace: null, country: null })).toBeNull();
    expect(placeFor({ location: "Hybrid - Fremont, CA", workplace: null, country: null })).toBe("hybrid");
    expect(placeFor({ location: "Austin, TX", workplace: "onsite", country: "US" })).toBeNull();
    expect(placeFor({ location: "New York, NY; San Francisco, CA", workplace: null, country: null })).toBe("onsite");
  });
  it("drops postings older than 30 days", () => {
    const old = parseGreenhouseList("acmehw", greenhouseList).find((j) => j.externalId === "105")!;
    expect(judge(old, TODAY)).toEqual({ keep: false, reason: "age" });
  });
});

function mockFetcher(): { fetcher: Fetcher; calls: string[] } {
  const calls: string[] = [];
  const routes: Record<string, unknown> = {
    "https://boards-api.greenhouse.io/v1/boards/acmehw/jobs": greenhouseList,
    "https://boards-api.greenhouse.io/v1/boards/acmehw/jobs/101": greenhouseJob101,
    "https://api.lever.co/v0/postings/robocorp?mode=json": leverList,
    "https://api.ashbyhq.com/posting-api/job-board/chipco?includeCompensation=true": ashbyList,
  };
  const fetcher: Fetcher = async (url) => {
    calls.push(url);
    if (url in routes) return { ok: true, status: 200, json: async () => routes[url] };
    if (url.includes("/jobs/")) return { ok: true, status: 200, json: async () => ({ content: "<p>Details</p>" }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { fetcher, calls };
}

describe("runFeeds", () => {
  it("adds new matching jobs once, records status, and switches off boards that don't exist", async () => {
    const client = new PGlite();
    const db = drizzle(client, { schema }) as unknown as NodePgDatabase<typeof schema>;
    await migrate(db as never, { migrationsFolder: "drizzle" });
    await db.insert(schema.companies).values([
      { name: "Acme Hardware", ats: "greenhouse", board: "acmehw" },
      { name: "RoboCorp", ats: "lever", board: "robocorp" },
      { name: "ChipCo", ats: "ashby", board: "chipco" },
      { name: "Ghost Inc", ats: "greenhouse", board: "doesnotexist" },
    ]);
    // Already in the pipeline under a slightly different spelling: must not be added again.
    await db.insert(schema.postings).values({ id: "existing", title: "Finance Systems Analyst", company: "ChipCo", dedupeKey: "chipco|finance systems analyst" });

    const { fetcher } = mockFetcher();
    const s = await runFeeds(db, { fetcher, trigger: "script", today: TODAY });
    expect(s.companiesChecked).toBe(4);
    expect(s.failed).toBe(1);
    expect(s.switchedOff).toEqual(["Ghost Inc"]);
    // Acme: 101 (BSA, SF) and 106 (app support, Fremont hybrid). RoboCorp: Epicor dev (remote); Austin role dropped. ChipCo: already there.
    expect(s.newJobs.map((j) => j.title).sort()).toEqual(["Application Support Analyst", "Business Systems Analyst, NetSuite", "ERP Developer (Epicor)"]);

    const rows = await db.select().from(schema.postings).innerJoin(schema.applications, eq(schema.applications.postingId, schema.postings.id)).innerJoin(schema.matches, eq(schema.matches.postingId, schema.postings.id));
    const bsa = rows.find((r) => r.postings.title.startsWith("Business Systems"))!;
    expect(bsa.applications.status).toBe("new");
    expect(bsa.matches.fit).toBe(4);
    expect(bsa.postings).toMatchObject({ mode: "onsite", source: "Greenhouse · Acme Hardware", atsRef: "greenhouse:acmehw:101", found: TODAY });
    expect(bsa.postings.description).toContain("NetSuite");
    const epicor = rows.find((r) => r.postings.title.startsWith("ERP Developer"))!;
    expect(epicor.postings).toMatchObject({ mode: "remote", payMin: 110000, payMax: 140000 });

    const [ghost] = await db.select().from(schema.companies).where(eq(schema.companies.name, "Ghost Inc"));
    expect(ghost).toMatchObject({ active: false, lastStatus: "not_found" });
    const [acme] = await db.select().from(schema.companies).where(eq(schema.companies.name, "Acme Hardware"));
    expect(acme).toMatchObject({ lastStatus: "ok", lastJobCount: 6, lastMatchCount: 2 });

    const again = await runFeeds(db, { fetcher, trigger: "script", today: TODAY });
    expect(again.added).toBe(0);
    expect(again.companiesChecked).toBe(3); // Ghost is switched off now
    expect((await db.select().from(schema.feedRuns)).length).toBe(2);
    await client.close();
  });
});
