import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { addDays, todayIn } from "../dates";
import { CANDIDATE_NAME, TARGETS, factsText } from "../profile";
import { resumeMenu, resumeNamed } from "../resumes";
import { SCORE_MODEL, WRITE_MODEL, askClaude, callsToday, dailyLimit, extractJsonArray } from "./claude";

type Db = NodePgDatabase<typeof schema>;
const { postings, matches, applications, settings } = schema;

const BATCH = 15;

/** A resume you picked (or one carried over from the old dashboard) is never replaced. */
const canRepick = (r: { resumeName: string | null; resumePickedBy: string | null }) => !r.resumeName || r.resumePickedBy === "rules" || r.resumePickedBy === "claude";

/**
 * Claude reads each posting, rates fit 1–5 with a one-line reason, and picks the best of your resumes
 * in the same call. Overwrites rule scores, never a fit or resume you set yourself. Returns how many jobs were scored.
 */
export async function scoreWithClaude(db: Db, postingIds: string[]): Promise<number> {
  if (!postingIds.length) return 0;
  const rows = await db
    .select({ id: postings.id, title: postings.title, company: postings.company, location: postings.location, mode: postings.mode, payText: postings.payText, payMin: postings.payMin, payMax: postings.payMax, description: postings.description, scoredBy: matches.scoredBy, resumeName: applications.resumeName, resumePickedBy: applications.resumePickedBy })
    .from(postings)
    .leftJoin(matches, eq(matches.postingId, postings.id))
    .leftJoin(applications, eq(applications.postingId, postings.id))
    .where(inArray(postings.id, postingIds));
  const todo = rows.filter((r) => r.scoredBy !== "you");
  let scored = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const jobs = batch.map((r, k) => ({
      ref: "j" + (k + 1),
      title: r.title,
      company: r.company,
      location: r.location,
      mode: r.mode,
      pay: r.payText || (r.payMin ? `$${r.payMin}${r.payMax ? "-" + r.payMax : ""}` : ""),
      posting: (r.description ?? "(no description saved; judge from the title)").slice(0, 2500),
    }));
    const prompt =
      `You are scoring job postings for one candidate, ${CANDIDATE_NAME}.\n\nHis real background:\n${factsText()}\n\n${TARGETS}\n\n` +
      "For each job, give fit from 1 to 5 (5 = a strong match he could credibly win; 3 = worth a look; 1 = a poor match, e.g. wrong field, far too senior, or skills he lacks) " +
      "and one plain sentence (max 25 words) naming the specific overlap or the main gap. Don't invent anything about him.\n\n" +
      `Also pick which of his resumes fits each job best, by its exact name:\n${resumeMenu()}\n\n` +
      'Reply with only a JSON array like [{"ref":"j1","fit":4,"why":"...","resume":"ERP Analyst"}], one entry per job.\n\nJobs:\n' +
      JSON.stringify(jobs);
    const text = await askClaude(db, { purpose: "score", model: SCORE_MODEL(), prompt, maxTokens: 1800 });
    const out = extractJsonArray(text) as { ref?: unknown; fit?: unknown; why?: unknown; resume?: unknown }[];
    for (const o of out) {
      const idx = jobs.findIndex((j) => j.ref === String(o.ref));
      const fit = Math.round(Number(o.fit));
      if (idx < 0 || !(fit >= 1 && fit <= 5)) continue;
      const id = batch[idx].id;
      const why = String(o.why ?? "").slice(0, 300);
      await db
        .insert(matches)
        .values({ postingId: id, fit, why, scoredBy: "claude" })
        .onConflictDoUpdate({ target: matches.postingId, set: { fit, why, scoredBy: "claude", scoredAt: new Date() } });
      const pick = resumeNamed(o.resume);
      if (pick && canRepick(batch[idx])) {
        await db.update(applications).set({ resumeName: pick.name, resumeUrl: pick.url, resumePickedBy: "claude", updatedAt: new Date() }).where(eq(applications.postingId, id));
      }
      scored++;
    }
  }
  return scored;
}

/** Scores the newest rule-scored jobs still waiting for review (used after each job-board check). */
export async function scoreNewJobs(db: Db, ids: string[], max = 30): Promise<number> {
  return scoreWithClaude(db, ids.slice(0, max));
}

const STYLE =
  "Write like a real person: plain words, contractions, a mix of short and longer sentences, one specific detail per paragraph. " +
  'Avoid: "I am excited/thrilled/eager", "passionate", "leverage", "dynamic", "fast-paced", "I am confident that", "delve", "testament", "align(s) with", "esteemed", ' +
  '"proven track record", "synergy", em dashes, "not only... but also", bullet points, restating the job ad, and generic closings like "I look forward to the opportunity".';

async function jobForWriting(db: Db, id: string) {
  const [j] = await db
    .select({ title: postings.title, company: postings.company, location: postings.location, mode: postings.mode, description: postings.description, why: matches.why })
    .from(postings)
    .leftJoin(matches, eq(matches.postingId, postings.id))
    .where(eq(postings.id, id));
  if (!j) throw new Error("No such job");
  return j;
}

/** Drafts a cover letter from the posting and your true facts, and saves it on the application. */
export async function writeCoverLetter(db: Db, id: string, auto = false): Promise<string> {
  const j = await jobForWriting(db, id);
  const posting = (j.description || j.why || "").slice(0, 6000);
  const prompt =
    `Write a cover letter for ${CANDIDATE_NAME} for this job.\n\nJob: ${j.title} at ${j.company}${j.location ? ` (${j.location})` : ""}${j.mode ? ", " + j.mode : ""}\n` +
    (posting ? `Posting:\n${posting}\n\n` : "\n") +
    `USE ONLY THESE TRUE FACTS about him; never invent experience, tools, numbers, employers, places, dates or certifications. If the posting asks for something he hasn't done, say so honestly in one clause and point to the closest thing he has done:\n${factsText()}\n\n` +
    `Rules: 170-230 words in 3-4 short paragraphs. Greeting like "Hello," or "Hi ${j.company} team," and sign off with just "${CANDIDATE_NAME}". Name the exact role. Pick the two or three facts that best match the posting and be concrete. ` +
    "Mention he's based in San Francisco when location matters; for roles outside the Bay Area say he's open to remote work or occasional travel. Don't mention his current employer. " +
    STYLE +
    "\n\nReply with only the letter text.";
  const text = await askClaude(db, { purpose: auto ? "auto_letter" : "cover_letter", model: WRITE_MODEL(), prompt, maxTokens: 1200, postingId: id });
  await db.update(applications).set({ coverLetter: text, coverLetterBy: auto ? "claude-auto" : "claude", updatedAt: new Date() }).where(eq(applications.postingId, id));
  return text;
}

/** How many cover letters Claude drafts on its own each day (AUTO_LETTERS_PER_DAY, default 8; 0 turns it off). */
export const autoLettersPerDay = () => Math.max(0, Math.floor(Number(process.env.AUTO_LETTERS_PER_DAY ?? 8) || 0));
/** Claude calls kept free for things you ask for by hand, so automatic letters never use up the day. */
const KEEP_FOR_YOU = 10;
/** The minimum Claude score for an automatic letter. */
export const AUTO_LETTER_MIN_FIT = 4;

/**
 * Drafts cover letters for your best new matches: Claude scored them 4 or 5, they're still waiting for review,
 * found in the last week, and have no letter yet. Drafts only; nothing is ever sent or submitted.
 */
export async function autoDraftLetters(db: Db, today = todayIn()): Promise<{ written: number; note: string | null }> {
  const perDay = autoLettersPerDay();
  if (!perDay) return { written: 0, note: null };
  const [done] = await db.select({ n: sql<number>`count(*)` }).from(schema.aiCalls).where(and(eq(schema.aiCalls.day, today), eq(schema.aiCalls.purpose, "auto_letter")));
  const room = Math.min(perDay - Number(done?.n ?? 0), dailyLimit() - KEEP_FOR_YOU - (await callsToday(db)));
  if (room <= 0) return { written: 0, note: null };
  const todo = await db
    .select({ id: postings.id })
    .from(postings)
    .innerJoin(applications, eq(applications.postingId, postings.id))
    .innerJoin(matches, eq(matches.postingId, postings.id))
    .where(and(eq(matches.scoredBy, "claude"), gte(matches.fit, AUTO_LETTER_MIN_FIT), inArray(applications.status, ["new", "saved"]), isNull(applications.coverLetter), eq(postings.archived, false), gte(postings.found, addDays(today, -7))))
    .orderBy(desc(matches.fit), desc(postings.found), desc(postings.num))
    .limit(room);
  let written = 0;
  // Two at a time keeps "Check for new jobs" from waiting on each letter in turn.
  for (let i = 0; i < todo.length; i += 2) {
    const res = await Promise.allSettled(todo.slice(i, i + 2).map(({ id }) => writeCoverLetter(db, id, true)));
    written += res.filter((r) => r.status === "fulfilled").length;
    const failed = res.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed) return { written, note: "Automatic cover letters stopped: " + (failed.reason instanceof Error ? failed.reason.message : String(failed.reason)) };
  }
  return { written, note: null };
}

/** Drafts an answer to an application or recruiter question, using your facts and saved screening answers. */
export async function answerQuestion(db: Db, id: string, question: string): Promise<string> {
  const j = await jobForWriting(db, id);
  const [ans] = await db.select().from(settings).where(eq(settings.key, "screeningAnswers"));
  const saved = Object.entries((ans?.value as Record<string, string>) ?? {})
    .filter(([, v]) => v && String(v).trim())
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  const prompt =
    `Draft ${CANDIDATE_NAME}'s answer to this screening question for the job ${j.title} at ${j.company}.\n\nQuestion: ${question.slice(0, 1500)}\n\n` +
    (j.description ? `Posting:\n${j.description.slice(0, 4000)}\n\n` : "") +
    `His real background (use only these facts; never invent anything):\n${factsText()}\n\n` +
    (saved ? `His own standard answers:\n${saved}\n\n` : "") +
    "Write in first person, plain and specific, usually 2-5 sentences unless the question asks for a number or yes/no. If the question needs a fact not given here (a number, a date, a preference), put a short [bracketed placeholder] instead of guessing. " +
    'No em dashes, no "passionate" or "leverage". Reply with only the answer.';
  return askClaude(db, { purpose: "answer", model: WRITE_MODEL(), prompt, maxTokens: 600, postingId: id });
}

/** Jobs added by a check that are still rule-scored, newest first. */
export async function unscoredReviewJobs(db: Db, limit = 30): Promise<string[]> {
  const rows = await db
    .select({ id: postings.id })
    .from(postings)
    .innerJoin(applications, eq(applications.postingId, postings.id))
    .innerJoin(matches, eq(matches.postingId, postings.id))
    .where(and(eq(matches.scoredBy, "rules"), inArray(applications.status, ["new", "saved"]), eq(postings.archived, false)))
    .orderBy(desc(postings.found), desc(postings.num))
    .limit(limit);
  return rows.map((r) => r.id);
}
