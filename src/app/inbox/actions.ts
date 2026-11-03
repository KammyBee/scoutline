"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { getDb, schema } from "@/db/client";
import { recordFollowUp, snoozeFollowUp } from "@/lib/followups";
import { disconnect } from "@/lib/google/account";
import { GoogleAuthError } from "@/lib/google/oauth";
import { applyToJob, summarize } from "@/lib/gmail/apply";
import type { MailKind } from "@/lib/gmail/classify";
import { saveDraft } from "@/lib/gmail/draft";
import { redact } from "@/lib/gmail/parse";
import { syncGmail, type SyncSummary } from "@/lib/gmail/sync";
import { requireSession } from "@/lib/requireSession";

const { emails, postings } = schema;

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export async function syncNow(): Promise<Result<SyncSummary>> {
  await requireSession();
  try {
    const s = await syncGmail(await getDb());
    refresh();
    return { ok: true, value: s };
  } catch (e) {
    refresh();
    if (e instanceof GoogleAuthError) return { ok: false, error: e.code === "invalid_grant" ? "Google access expired. Connect Gmail again." : e.message };
    console.error("Gmail sync failed", e);
    return { ok: false, error: "The Gmail sync didn't finish. Try again in a moment." };
  }
}

/** Files an email Scoutline couldn't place under the job you pick. */
export async function attachEmail(emailId: string, postingId: string): Promise<void> {
  await requireSession();
  const db = await getDb();
  const [m] = await db.select().from(emails).where(eq(emails.id, String(emailId)));
  const [p] = await db.select({ company: postings.company }).from(postings).where(eq(postings.id, String(postingId)));
  if (!m || !p) throw new Error("No such email or job");
  const kind = (m.kind ?? "update") as MailKind;
  const summary = redact(summarize(kind, p.company, m.actionText, m.subject ?? ""));
  await db.update(emails).set({ postingId: String(postingId), state: "matched", summary }).where(eq(emails.id, m.id));
  if (m.date) await applyToJob(db, String(postingId), { id: m.id, kind, date: m.date, summary, link: m.link ?? "", actionText: m.actionText, due: m.due });
  refresh();
}

/** Hides an email that isn't about any of your jobs. */
export async function ignoreEmail(emailId: string): Promise<void> {
  await requireSession();
  await (await getDb()).update(emails).set({ state: "ignored", postingId: null }).where(eq(emails.id, String(emailId)));
  refresh();
}

export async function markFollowedUp(postingId: string): Promise<void> {
  await requireSession();
  await recordFollowUp(await getDb(), String(postingId));
  refresh();
}

export async function snooze(postingId: string): Promise<void> {
  await requireSession();
  await snoozeFollowUp(await getDb(), String(postingId));
  refresh();
}

/** Saves a follow-up as a Gmail draft. Never sends it. */
export async function createFollowUpDraft(to: string, subject: string, body: string): Promise<Result<string>> {
  await requireSession();
  try {
    const r = await saveDraft(await getDb(), { to: String(to ?? ""), subject: String(subject ?? ""), body: String(body ?? "") });
    return { ok: true, value: r.url };
  } catch (e) {
    console.error("Draft failed", e);
    return { ok: false, error: e instanceof Error && /Turn on|Add a subject/.test(e.message) ? e.message : "Gmail didn't save the draft. Try again in a moment." };
  }
}

export async function disconnectGmail(): Promise<void> {
  await requireSession();
  await disconnect(await getDb());
  refresh();
}
