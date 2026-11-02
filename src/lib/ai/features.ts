import { and, desc, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { CANDIDATE_NAME, TARGETS, factsText } from "../profile";
import { SCORE_MODEL, WRITE_MODEL, askClaude, extractJsonArray } from "./claude";

type Db = NodePgDatabase<typeof schema>;
const { postings, matches, applications, settings } = schema;

const BATCH = 15;

/**
 * Claude reads each posting and rates fit 1–5 with a one-line reason. Overwrites rule scores,
 * never a fit you set yourself. Returns how many jobs were scored.
 */
export async function scoreWithClaude(db: Db, postingIds: string[]): Promise<number> {
  if (!postingIds.length) return 0;
  const rows = await db
    .select({ id: postings.id, title: postings.title, company: postings.company, location: postings.location, mode: postings.mode, payText: postings.payText, payMin: postings.payMin, payMax: postings.payMax, description: postings.description, scoredBy: matches.scoredBy })
    .from(postings)
    .leftJoin(matches, eq(matches.postingId, postings.id))
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
      'Reply with only a JSON array like [{"ref":"j1","fit":4,"why":"..."}], one entry per job.\n\nJobs:\n' +
      JSON.stringify(jobs);
    const text = await askClaude(db, { purpose: "score", model: SCORE_MODEL(), prompt, maxTokens: 1500 });
    const out = extractJsonArray(text) as { ref?: unknown; fit?: unknown; why?: unknown }[];
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
export async function writeCoverLetter(db: Db, id: string): Promise<string> {
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
  const text = await askClaude(db, { purpose: "cover_letter", model: WRITE_MODEL(), prompt, maxTokens: 1200, postingId: id });
  await db.update(applications).set({ coverLetter: text, updatedAt: new Date() }).where(eq(applications.postingId, id));
  return text;
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
