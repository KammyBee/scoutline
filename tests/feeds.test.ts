import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { WORKDAY_SEARCHES, boardPublicUrl, fetchBoard, parseAshbyList, parseBoardUrl, parseGreenhouseList, parseLeverList, parseMoneyRange, parseSmartRecruitersList, parseWorkableList, workdayPostedOn } from "@/lib/feeds/boards";
import { runFeeds } from "@/lib/feeds/ingest";
import { judge, placeFor, titleTier } from "@/lib/feeds/rules";
import { htmlToText } from "@/lib/feeds/text";
import type { Fetcher } from "@/lib/feeds/types";
import { pickResume } from "@/lib/resumes";
import { ashbyList, greenhouseJob101, greenhouseList, leverList, smartRecruitersJob1, smartRecruitersList, workableAccount, workdayDetails, workdaySearch } from "./feedFixtures";

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
    expect(parseBoardUrl("https://jobs.smartrecruiters.com/Visa/744000001-sap-analyst")).toEqual({ ats: "smartrecruiters", board: "Visa" });
    expect(parseBoardUrl("https://careers.smartrecruiters.com/BoschGroup")).toEqual({ ats: "smartrecruiters", board: "BoschGroup" });
    expect(parseBoardUrl("https://apply.workable.com/gearworks/j/AB12CD34/")).toEqual({ ats: "workable", board: "gearworks" });
    expect(parseBoardUrl("https://apply.workable.com/j/AB12CD34")).toBeNull();
    expect(parseBoardUrl("https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/SAP-Analyst_JR1")).toEqual({ ats: "workday", board: "nvidia.wd5/NVIDIAExternalCareerSite" });
    expect(parseBoardUrl("https://amat.wd1.myworkdayjobs.com/External")).toEqual({ ats: "workday", board: "amat.wd1/External" });
    expect(boardPublicUrl("workday", "amat.wd1/External")).toBe("https://amat.wd1.myworkdayjobs.com/External");
    expect(parseBoardUrl("https://www.linkedin.com/jobs/view/1")).toBeNull();
  });
  it("reads SmartRecruiters and Workable lists", () => {
    const sr = parseSmartRecruitersList("Visa", smartRecruitersList);
    expect(sr[0]).toMatchObject({ title: "SAP MM Analyst", location: "San Jose, CA", country: "US", url: "https://jobs.smartrecruiters.com/Visa/744000001", posted: "2026-10-30" });
    expect(sr[1]).toMatchObject({ workplace: "remote", location: "Austin, TX; Remote" });
    const wk = parseWorkableList("gearworks", workableAccount);
    expect(wk[0]).toMatchObject({ title: "NetSuite Administrator", workplace: "remote", country: "US", posted: "2026-10-27", url: "https://apply.workable.com/j/AB12CD34" });
    expect(wk[0].description).toContain("SuiteScript");
  });
  it("turns Workday's 'Posted N Days Ago' into dates", () => {
    expect(workdayPostedOn("Posted Today", TODAY)).toBe(TODAY);
    expect(workdayPostedOn("Posted Yesterday", TODAY)).toBe("2026-10-31");
    expect(workdayPostedOn("Posted 3 Days Ago", TODAY)).toBe("2026-10-29");
    expect(workdayPostedOn("Posted 30+ Days Ago", TODAY)).toBe("2026-10-01");
  });
  it("searches Workday boards and opens only titles worth a look", async () => {
    const { fetcher, calls, posts } = mockFetcher();
    const r = await fetchBoard(fetcher, "workday", "chipworks.wd5/External", TODAY);
    if (!r.ok) throw new Error(r.error);
    expect(r.jobs.map((j) => j.title).sort()).toEqual(["ERP Analyst", "Oracle EBS Developer", "SAP FICO Analyst", "Senior SAP Architect"]);
    expect(posts.length).toBe(WORKDAY_SEARCHES.length); // one page each: every search came back short
    const fico = r.jobs.find((j) => j.title === "SAP FICO Analyst")!;
    expect(fico).toMatchObject({ location: "San Jose, CA; Austin, TX", workplace: "hybrid", country: "US", posted: "2026-10-29", payMin: 110000, payMax: 135000 });
    // "Senior SAP Architect" fails the title filter, so its detail page is never requested.
    expect(calls.some((u) => u.includes("Senior-SAP-Architect"))).toBe(false);
  });
});

describe("resume pick", () => {
  it("matches the resume to the kind of job", () => {
    expect(pickResume("SAP MM Analyst").name).toBe("SAP");
    expect(pickResume("SAP BusinessObjects Developer").name).toBe("SAP BI");
    expect(pickResume("Epicor Kinetic Developer").name).toBe("Epicor");
    expect(pickResume("Integration Engineer").name).toBe("Integrations");
    expect(pickResume("Business Systems Analyst").name).toBe("ERP Analyst");
    expect(pickResume("Business Systems Analyst", "Our SAP S/4 rollout. SAP MM experience.").name).toBe("SAP");
    expect(pickResume("NetSuite Administrator").name).toBe("ERP Support");
    expect(pickResume("ERP Developer").name).toBe("App & ERP Dev");
    expect(pickResume("Full Stack Engineer").name).toBe("Full Stack v2");
    expect(pickResume(".NET Developer").name).toBe("App Dev");
    expect(pickResume("Software Engineer II").name).toBe("Software Dev");
    expect(pickResume("Office Coordinator").name).toBe("General");
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

function mockFetcher(): { fetcher: Fetcher; calls: string[]; posts: string[] } {
  const calls: string[] = [];
  const posts: string[] = [];
  const routes: Record<string, unknown> = {
    "https://boards-api.greenhouse.io/v1/boards/acmehw/jobs": greenhouseList,
    "https://boards-api.greenhouse.io/v1/boards/acmehw/jobs/101": greenhouseJob101,
    "https://api.lever.co/v0/postings/robocorp?mode=json": leverList,
    "https://api.ashbyhq.com/posting-api/job-board/chipco?includeCompensation=true": ashbyList,
    "https://api.smartrecruiters.com/v1/companies/BigCo/postings?limit=100&offset=0": smartRecruitersList,
    "https://api.smartrecruiters.com/v1/companies/BigCo/postings/744000001": smartRecruitersJob1,
    "https://apply.workable.com/api/v1/widget/accounts/gearworks?details=true": workableAccount,
  };
  const WD = "https://chipworks.wd5.myworkdayjobs.com/wday/cxs/chipworks/External";
  const fetcher: Fetcher = async (url, init) => {
    calls.push(url);
    if (url === WD + "/jobs" && init?.method === "POST") {
      const b = JSON.parse(init.body ?? "{}");
      posts.push(b.searchText);
      return { ok: true, status: 200, json: async () => workdaySearch(b.searchText, b.offset) };
    }
    if (url.startsWith(WD + "/job/")) {
      const d = workdayDetails[url.slice(WD.length)];
      return d ? { ok: true, status: 200, json: async () => d } : { ok: false, status: 404, json: async () => ({}) };
    }
    if (url in routes) return { ok: true, status: 200, json: async () => routes[url] };
    if (url.includes("/jobs/")) return { ok: true, status: 200, json: async () => ({ content: "<p>Details</p>" }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { fetcher, calls, posts };
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

  it("brings in jobs from SmartRecruiters, Workable and Workday and picks a resume for each", async () => {
    const client = new PGlite();
    const db = drizzle(client, { schema }) as unknown as NodePgDatabase<typeof schema>;
    await migrate(db as never, { migrationsFolder: "drizzle" });
    await db.insert(schema.companies).values([
      { name: "BigCo", ats: "smartrecruiters", board: "BigCo" },
      { name: "Gearworks", ats: "workable", board: "gearworks" },
      { name: "ChipWorks", ats: "workday", board: "chipworks.wd5/External" },
    ]);
    const { fetcher } = mockFetcher();
    const s = await runFeeds(db, { fetcher, trigger: "script", today: TODAY });
    expect(s.failed).toBe(0);
    // Dropped: Marketing Manager (title), Senior SAP Architect (title), ERP Analyst in Bangalore (location).
    expect(s.newJobs.map((j) => j.title).sort()).toEqual(["Integration Developer", "NetSuite Administrator", "Oracle EBS Developer", "SAP FICO Analyst", "SAP MM Analyst"]);
    const rows = await db.select().from(schema.postings).innerJoin(schema.applications, eq(schema.applications.postingId, schema.postings.id));
    const by = (t: string) => rows.find((r) => r.postings.title === t)!;
    expect(by("SAP MM Analyst").postings).toMatchObject({ source: "SmartRecruiters · BigCo", mode: "onsite", atsRef: "smartrecruiters:BigCo:744000001" });
    expect(by("SAP MM Analyst").postings.description).toContain("S/4HANA");
    expect(by("SAP FICO Analyst").postings).toMatchObject({ source: "Workday · ChipWorks", mode: "hybrid", payMin: 110000 });
    expect(by("NetSuite Administrator").postings).toMatchObject({ mode: "remote", source: "Workable · Gearworks" });
    expect(by("SAP MM Analyst").applications).toMatchObject({ resumeName: "SAP", resumePickedBy: "rules" });
    expect(by("Integration Developer").applications.resumeName).toBe("Integrations");
    expect(by("NetSuite Administrator").applications.resumeName).toBe("ERP Support");
    expect(by("Integration Developer").applications.resumeUrl).toMatch(/^https:\/\/claude\.ai\/artifact\//);
    await client.close();
  });
});
