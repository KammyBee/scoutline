import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { AiUnavailable, aiConfigured, askClaude, estimateCost, extractJsonArray, setClaudeForTests, usageThisMonth, type ClaudeLike } from "@/lib/ai/claude";
import { answerQuestion, autoDraftLetters, scoreWithClaude, writeCoverLetter } from "@/lib/ai/features";
import { computeMatch, prefsFrom, whyFromMatch } from "@/lib/match";
import { rescoreAll } from "@/lib/rescore";
import { replyStats } from "@/lib/stats";

type Db = NodePgDatabase<typeof schema>;
async function freshDb(): Promise<Db> {
  const db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: "drizzle" });
  return db;
}
async function addJob(db: Db, id: string, title: string, description: string, scoredBy = "rules", fit = 2) {
  await db.insert(schema.postings).values({ id, title, company: "Co " + id, dedupeKey: "co|" + id, description });
  await db.insert(schema.applications).values({ postingId: id, status: "new" });
  await db.insert(schema.matches).values({ postingId: id, fit, why: "", scoredBy });
}
function fakeClaude(reply: (prompt: string) => string) {
  const prompts: { model: string; prompt: string }[] = [];
  const c: ClaudeLike = {
    messages: {
      create: async (p) => {
        prompts.push({ model: p.model, prompt: p.messages[0].content });
        return { content: [{ type: "text", text: reply(p.messages[0].content) }], usage: { input_tokens: 2000, output_tokens: 300 } };
      },
    },
  };
  return { c, prompts };
}

afterEach(() => {
  setClaudeForTests(null);
  delete process.env.CLAUDE_DAILY_LIMIT;
  delete process.env.AUTO_LETTERS_PER_DAY;
});

describe("skill match", () => {
  it("finds skills and gaps and ranks an ERP developer role above an unrelated one", () => {
    const erp = computeMatch("ERP Developer", "Epicor Kinetic, BPMs and BAQs, SQL Server, REST API integrations. Nice to have: NetSuite.");
    expect(erp.hits).toEqual(expect.arrayContaining(["Epicor", "BPMs / BAQs", "SQL Server / T-SQL", "REST APIs", "Integrations"]));
    expect(erp.gaps).toContain("NetSuite");
    const other = computeMatch("Senior Staff ML Engineer", "Python, PyTorch, AWS");
    expect(erp.fit).toBeGreaterThan(other.fit);
    expect(whyFromMatch(erp)).toMatch(/^Matches your Epicor/);
  });
  it("More like this raises similar jobs; Not for me lowers similar titles", () => {
    const text = "SAP ABAP and SQL reporting";
    const base = computeMatch("Business Systems Analyst", text);
    const liked = computeMatch("Business Systems Analyst", text, prefsFrom([{ kind: "like", reason: null, title: "x", terms: ["SAP", "ABAP", "SQL"] }]));
    expect(liked.points).toBe(base.points + 3);
    const disliked = computeMatch("Business Systems Analyst", text, prefsFrom([{ kind: "pass", reason: "Not for me", title: "Business Systems Analyst II", terms: [] }]));
    expect(disliked.points).toBe(base.points - 3);
    // A pass for an unrelated reason doesn't count against similar jobs.
    const commute = computeMatch("Business Systems Analyst", text, prefsFrom([{ kind: "pass", reason: "Commute or onsite", title: "Business Systems Analyst", terms: [] }]));
    expect(commute.points).toBe(base.points);
  });
  it("rescore fills in chips everywhere but only changes the fit of rule-scored jobs", async () => {
    const db = await freshDb();
    await addJob(db, "a", "ERP Developer", "Epicor, SQL Server, REST APIs, integrations", "rules", 1);
    await addJob(db, "b", "ERP Developer", "Epicor, SQL Server", "you", 2);
    await addJob(db, "c", "ERP Developer", "Epicor, SQL Server", "claude", 5);
    const r = await rescoreAll(db);
    expect(r.updated).toBe(3);
    const rows = Object.fromEntries((await db.select().from(schema.matches)).map((m) => [m.postingId, m]));
    expect(rows.a.fit).toBeGreaterThan(1);
    expect(rows.a.hits).toContain("Epicor");
    expect(rows.b.fit).toBe(2);
    expect(rows.b.hits).toContain("Epicor");
    expect(rows.c.fit).toBe(5);
    expect((await rescoreAll(db)).updated).toBe(0); // nothing changed the second time
  });
});

describe("Claude calls", () => {
  it("is off without a key", async () => {
    const db = await freshDb();
    const key = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    expect(aiConfigured()).toBe(false);
    await expect(askClaude(db, { purpose: "answer", model: "claude-sonnet-5-5", prompt: "hi", maxTokens: 10 })).rejects.toBeInstanceOf(AiUnavailable);
    if (key) process.env.ANTHROPIC_API_KEY = key;
  });
  it("estimates cost from published prices", () => {
    expect(estimateCost("claude-haiku-5-5", 50_000, 100_000)).toBeCloseTo(0.055);
    expect(estimateCost("claude-haiku-5-5", 1_000_000, 1_000_000)).toBeCloseTo(3); // long prompts cost more
    expect(estimateCost("claude-sonnet-5-5", 2000, 300)).toBeCloseTo(0.007);
  });
  it("reads JSON lists wrapped in prose or code fences", () => {
    expect(extractJsonArray('Here you go:\n```json\n[{"ref":"j1","fit":4}]\n```')).toEqual([{ ref: "j1", fit: 4 }]);
    expect(() => extractJsonArray("no list here")).toThrow();
  });
  it("logs every call and stops at the daily limit", async () => {
    const db = await freshDb();
    const { c } = fakeClaude(() => "ok");
    setClaudeForTests(c);
    process.env.CLAUDE_DAILY_LIMIT = "2";
    await askClaude(db, { purpose: "answer", model: "claude-sonnet-5-5", prompt: "1", maxTokens: 10 });
    await askClaude(db, { purpose: "answer", model: "claude-sonnet-5-5", prompt: "2", maxTokens: 10 });
    await expect(askClaude(db, { purpose: "answer", model: "claude-sonnet-5-5", prompt: "3", maxTokens: 10 })).rejects.toMatchObject({ reason: "daily_limit" });
    const usage = await usageThisMonth(db);
    expect(usage).toEqual([{ purpose: "answer", calls: 2, cost: expect.closeTo(0.014, 5), failed: 0 }]);
  });
  it("logs failed calls too", async () => {
    const db = await freshDb();
    setClaudeForTests({ messages: { create: async () => { throw new Error("overloaded"); } } });
    await expect(askClaude(db, { purpose: "score", model: "claude-haiku-5-5", prompt: "x", maxTokens: 10 })).rejects.toThrow("overloaded");
    const [row] = await db.select().from(schema.aiCalls);
    expect(row).toMatchObject({ ok: false, error: "overloaded", purpose: "score" });
  });
});

describe("Claude features", () => {
  it("scores jobs with Haiku, ignoring bad entries and never touching your own scores", async () => {
    const db = await freshDb();
    await addJob(db, "a", "ERP Developer", "Epicor");
    await addJob(db, "b", "Data Scientist", "Python");
    await addJob(db, "mine", "Analyst", "SQL", "you", 4);
    const { c, prompts } = fakeClaude((p) => {
      expect(p).not.toContain('"Analyst"');
      return 'Sure:\n[{"ref":"j1","fit":5,"why":"Epicor developer role, his core stack."},{"ref":"j2","fit":1,"why":"Python ML role."},{"ref":"j9","fit":3,"why":"?"},{"ref":"j1","fit":"x"}]';
    });
    setClaudeForTests(c);
    expect(await scoreWithClaude(db, ["a", "b", "mine"])).toBe(2);
    expect(prompts).toHaveLength(1);
    expect(prompts[0].model).toBe("claude-haiku-5-5");
    const rows = Object.fromEntries((await db.select().from(schema.matches)).map((m) => [m.postingId, m]));
    expect(rows.a).toMatchObject({ fit: 5, scoredBy: "claude", why: "Epicor developer role, his core stack." });
    expect(rows.b.fit).toBe(1);
    expect(rows.mine).toMatchObject({ fit: 4, scoredBy: "you" });
  });
  it("writes and saves a cover letter with Sonnet, using only the fact list", async () => {
    const db = await freshDb();
    await addJob(db, "a", "ERP Developer", "Epicor Kinetic developer");
    const { c, prompts } = fakeClaude(() => "Hello,\n\nLetter body.\n\nKamdon Basinger");
    setClaudeForTests(c);
    const text = await writeCoverLetter(db, "a");
    expect(prompts[0].model).toBe("claude-sonnet-5-5");
    expect(prompts[0].prompt).toContain("USE ONLY THESE TRUE FACTS");
    expect(prompts[0].prompt).toContain("ERP Developer at Co a");
    const [app] = await db.select().from(schema.applications).where(eq(schema.applications.postingId, "a"));
    expect(app.coverLetter).toBe(text);
  });
  it("picks a resume while scoring, but never replaces one you chose", async () => {
    const db = await freshDb();
    await addJob(db, "a", "ERP Developer", "SAP ABAP");
    await addJob(db, "b", "ERP Developer", "SAP ABAP");
    await addJob(db, "c", "ERP Developer", "SAP ABAP");
    await db.update(schema.applications).set({ resumeName: "App & ERP Dev", resumeUrl: "u", resumePickedBy: "rules" }).where(eq(schema.applications.postingId, "a"));
    await db.update(schema.applications).set({ resumeName: "Epicor", resumeUrl: "u", resumePickedBy: "you" }).where(eq(schema.applications.postingId, "b"));
    const { c, prompts } = fakeClaude(() => '[{"ref":"j1","fit":5,"why":"x","resume":"SAP"},{"ref":"j2","fit":5,"why":"x","resume":"SAP"},{"ref":"j3","fit":4,"why":"x","resume":"Not a resume"}]');
    setClaudeForTests(c);
    await scoreWithClaude(db, ["a", "b", "c"]);
    expect(prompts[0].prompt).toContain("- Integrations: Integration/API/EDI");
    const apps = Object.fromEntries((await db.select().from(schema.applications)).map((a) => [a.postingId, a]));
    expect(apps.a).toMatchObject({ resumeName: "SAP", resumePickedBy: "claude" });
    expect(apps.a.resumeUrl).toMatch(/^https:\/\/claude\.ai\/artifact\//);
    expect(apps.b).toMatchObject({ resumeName: "Epicor", resumePickedBy: "you" });
    expect(apps.c.resumeName).toBeNull(); // an unknown name is ignored
  });
  it("drafts cover letters on its own only for strong new matches, within the daily allowance", async () => {
    const db = await freshDb();
    const today = "2026-11-03";
    const job = async (id: string, fit: number, opts: { scoredBy?: string; found?: string; status?: "new" | "applied"; letter?: string } = {}) => {
      await addJob(db, id, "ERP Developer", "Epicor", opts.scoredBy ?? "claude", fit);
      await db.update(schema.postings).set({ found: opts.found ?? today }).where(eq(schema.postings.id, id));
      await db.update(schema.applications).set({ status: opts.status ?? "new", coverLetter: opts.letter ?? null }).where(eq(schema.applications.postingId, id));
    };
    await job("five", 5);
    await job("four", 4);
    await job("four-b", 4);
    await job("three", 3);
    await job("rules", 5, { scoredBy: "rules" });
    await job("old", 5, { found: "2026-10-01" });
    await job("applied", 5, { status: "applied" });
    await job("has-letter", 5, { letter: "Mine" });
    const { c, prompts } = fakeClaude(() => "Hello,\n\nLetter.\n\nKamdon Basinger");
    setClaudeForTests(c);
    process.env.AUTO_LETTERS_PER_DAY = "2";
    expect(await autoDraftLetters(db, today)).toEqual({ written: 2, note: null });
    expect(prompts.every((p) => p.model === "claude-sonnet-5-5")).toBe(true);
    const apps = Object.fromEntries((await db.select().from(schema.applications)).map((a) => [a.postingId, a]));
    expect(apps.five).toMatchObject({ coverLetterBy: "claude-auto" });
    expect(apps.five.coverLetter).toContain("Letter.");
    expect([apps.four.coverLetter, apps["four-b"].coverLetter].filter(Boolean)).toHaveLength(1);
    for (const id of ["three", "rules", "old", "applied"]) expect(apps[id].coverLetter).toBeNull();
    expect(apps["has-letter"].coverLetter).toBe("Mine");
    // Today's allowance is used up, so a second check writes nothing.
    expect((await autoDraftLetters(db, today)).written).toBe(0);
    // Automatic letters always leave room under the daily cap for things you ask for.
    process.env.AUTO_LETTERS_PER_DAY = "8";
    process.env.CLAUDE_DAILY_LIMIT = "12";
    expect((await autoDraftLetters(db, today)).written).toBe(0);
    process.env.AUTO_LETTERS_PER_DAY = "0";
    process.env.CLAUDE_DAILY_LIMIT = "60";
    expect((await autoDraftLetters(db, today)).written).toBe(0);
  });
  it("answers screening questions with saved answers in the prompt", async () => {
    const db = await freshDb();
    await addJob(db, "a", "ERP Developer", "Epicor");
    await db.insert(schema.settings).values({ key: "screeningAnswers", value: { workAuth: "US citizen", salary: "" } });
    const { c, prompts } = fakeClaude(() => "Yes, I can.");
    setClaudeForTests(c);
    expect(await answerQuestion(db, "a", "Are you authorized to work in the US?")).toBe("Yes, I can.");
    expect(prompts[0].prompt).toContain("workAuth: US citizen");
    expect(prompts[0].prompt).not.toContain("salary:");
  });
});

describe("reply stats", () => {
  it("counts only sent applications and groups them", () => {
    const s = replyStats([
      { status: "applied", resumeName: "ERP", source: "Dice", mode: "remote", fit: 4, replied: false },
      { status: "interviewing", resumeName: "ERP", source: "Dice", mode: "remote", fit: 4, replied: false },
      { status: "rejected", resumeName: "Full stack", source: "Greenhouse", mode: "onsite", fit: 3, replied: false },
      { status: "noresponse", resumeName: null, source: null, mode: null, fit: null, replied: true },
      { status: "new", resumeName: "ERP", source: "Dice", mode: "remote", fit: 5, replied: false },
    ]);
    expect(s.total).toMatchObject({ applied: 4, replies: 3, interviews: 1 });
    expect(s.groups[0].lines[0]).toEqual({ label: "ERP", applied: 2, replies: 1, interviews: 1 });
    expect(s.groups[0].lines.map((l) => l.label)).toContain("No resume recorded");
    expect(s.groups[1].lines.map((l) => l.label)).toEqual(["Dice", "2 other sources"]);
    expect(s.groups[3].lines.map((l) => l.label)).toEqual(["Fit 4 of 5", "Fit 3 of 5", "Not scored"]);
  });
});
