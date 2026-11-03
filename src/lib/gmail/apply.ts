import { and, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import type { Status } from "@/db/schema";
import { addDays, todayIn } from "../dates";
import { followUpDays } from "../followups";
import type { MailKind } from "./classify";

type Db = NodePgDatabase<typeof schema>;
const { applications, events } = schema;

export type SavedMail = { id: string; kind: MailKind; date: string; summary: string; link: string; actionText: string | null; due: string | null };

/** The status a job moves to after an email of this kind. null = leave it alone. Never moves a passed job. */
export function nextStatus(cur: Status, kind: MailKind): Status | null {
  if (cur === "passed") return null;
  switch (kind) {
    case "applied":
      return cur === "new" || cur === "saved" ? "applied" : null;
    case "action":
      return cur === "new" || cur === "saved" || cur === "noresponse" ? "applied" : null;
    case "interview":
      return ["new", "saved", "applied", "noresponse"].includes(cur) ? "interviewing" : null;
    case "rejection":
      return ["new", "saved", "applied", "noresponse", "interviewing"].includes(cur) ? "rejected" : null;
    case "offer":
      return cur === "offer" ? null : "offer";
    case "recruiter":
    case "update":
      return cur === "noresponse" ? "applied" : null;
  }
}

const SUMMARY: Record<MailKind, (co: string) => string> = {
  applied: (co) => `${co} confirmed your application.`,
  rejection: (co) => `${co} isn't moving forward.`,
  interview: (co) => `${co} wants to set up an interview.`,
  action: (co) => `${co} asked you to do something.`,
  offer: (co) => `${co} sent an offer.`,
  recruiter: (co) => `Recruiter message from ${co}.`,
  update: (co) => `Update from ${co}.`,
};

/** The one-line summary saved for a message. Built from a template, never copied from the email body. */
export function summarize(kind: MailKind, company: string, actionText: string | null, subject: string): string {
  const base = kind === "action" && actionText ? `${company}: ${actionText.charAt(0).toLowerCase() + actionText.slice(1)}.` : SUMMARY[kind](company);
  return kind === "update" || kind === "recruiter" ? `${base} "${subject}"` : base;
}

/**
 * Records a message on its job: adds it to the history, moves the status forward when the email
 * says so, and sets "Action needed" for interviews, assessments and offers. Returns true if the
 * status changed. Running it twice for the same message does nothing the second time.
 */
export async function applyToJob(db: Db, postingId: string, m: SavedMail): Promise<boolean> {
  const day = todayIn(undefined, new Date(m.date));
  const inserted = await db
    .insert(events)
    .values({ postingId, date: day, kind: m.kind, summary: m.summary, link: m.link, emailId: m.id })
    .onConflictDoNothing()
    .returning({ id: events.id });
  if (!inserted.length) return false;
  const [cur] = await db.select().from(applications).where(eq(applications.postingId, postingId));
  if (!cur) return false;
  const patch: Partial<typeof applications.$inferInsert> = { updatedAt: new Date() };
  if (!cur.lastEmailAt || cur.lastEmailAt < m.date) patch.lastEmailAt = m.date;
  const to = nextStatus(cur.status, m.kind);
  if (to) {
    patch.status = to;
    if (to === "applied" && !cur.appliedAt) {
      patch.appliedAt = day;
      patch.followUpAt = cur.followUpAt ?? addDays(day, followUpDays());
    }
  }
  if (m.actionText && (m.kind === "interview" || m.kind === "action" || m.kind === "offer")) {
    patch.actionNeeded = { text: m.actionText, link: m.link, date: day, due: m.due, done: false };
  }
  await db.update(applications).set(patch).where(eq(applications.postingId, postingId));
  return !!to;
}

/** Jobs with at least one linked message in these threads, so replies stay with the same job. */
export async function jobsForThreads(db: Db, threadIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!threadIds.length) return out;
  const rows = await db
    .select({ threadId: schema.emails.threadId, postingId: schema.emails.postingId })
    .from(schema.emails)
    .where(and(inArray(schema.emails.threadId, threadIds), sql`${schema.emails.postingId} is not null`));
  for (const r of rows) if (r.threadId && r.postingId) out.set(r.threadId, r.postingId);
  return out;
}
