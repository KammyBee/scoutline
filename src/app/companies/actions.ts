"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { getDb, schema } from "@/db/client";
import { seedStarterList } from "@/lib/companies";
import { parseBoardUrl } from "@/lib/feeds/boards";
import { runFeeds, testBoard } from "@/lib/feeds/ingest";
import { ATS_LABEL, ATS_LIST, type Ats } from "@/lib/feeds/types";
import { requireSession } from "@/lib/requireSession";

const { companies } = schema;

export async function addStarterList(): Promise<number> {
  await requireSession();
  const n = await seedStarterList(await getDb());
  refresh();
  return n;
}

export type AddState = { error?: string; ok?: string };

/** Adds a company from a pasted job board link (or an ATS + board name), after checking the board exists. */
export async function addCompany(_prev: AddState, form: FormData): Promise<AddState> {
  await requireSession();
  const name = String(form.get("name") ?? "").trim().slice(0, 120);
  const link = String(form.get("link") ?? "").trim();
  let target: { ats: Ats; board: string } | null = link ? parseBoardUrl(link) : null;
  if (!target) {
    const ats = String(form.get("ats") ?? "") as Ats;
    const board = String(form.get("board") ?? link).trim();
    if (ATS_LIST.includes(ats) && board && !board.includes("/")) target = { ats, board };
  }
  if (!name) return { error: "Enter the company's name." };
  if (!target) return { error: "Paste a link to the company's Greenhouse, Lever or Ashby job board (or one of their job postings), or choose the system and type the board name." };
  const test = await testBoard(target.ats, target.board);
  if (!test.ok) {
    return { error: test.status === "not_found" ? `There's no ${ATS_LABEL[target.ats]} job board named "${target.board}". Check the link.` : `Couldn't reach the job board (${test.error}). Try again in a moment.` };
  }
  const db = await getDb();
  const now = new Date().toISOString();
  const values = { name, ats: target.ats, board: target.board, active: true, lastStatus: "ok", lastError: null, lastCheckedAt: now, lastJobCount: test.total, lastMatchCount: test.matched };
  await db.insert(companies).values(values).onConflictDoUpdate({ target: companies.name, set: values });
  refresh();
  return { ok: `Added ${name}: ${test.total} open job${test.total === 1 ? "" : "s"}, ${test.matched} match${test.matched === 1 ? "es" : ""} your filters. Use "Check now" to bring them in.` };
}

export async function setCompanyActive(id: number, active: boolean): Promise<void> {
  await requireSession();
  await (await getDb()).update(companies).set({ active }).where(eq(companies.id, Number(id)));
  refresh();
}

export async function removeCompany(id: number): Promise<void> {
  await requireSession();
  await (await getDb()).delete(companies).where(eq(companies.id, Number(id)));
  refresh();
}

/** Checks one company's board now and adds its new matching jobs. */
export async function checkCompany(id: number): Promise<{ added: number; error?: string }> {
  await requireSession();
  const db = await getDb();
  await db.update(companies).set({ active: true }).where(eq(companies.id, Number(id)));
  const s = await runFeeds(db, { trigger: "manual", companyIds: [Number(id)] });
  refresh();
  return { added: s.added, error: s.errors[0]?.error };
}
