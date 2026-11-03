import { and, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { CANDIDATE_NAME } from "./profile";
import { addDays, daysBetween, fmtDate, todayIn } from "./dates";

type Db = NodePgDatabase<typeof schema>;
const { postings, applications, events } = schema;

const envDays = (name: string, def: number) => {
  const v = process.env[name];
  const n = v === undefined || v === "" ? def : Number(v);
  return isFinite(n) && n >= 0 ? Math.round(n) : def;
};
/** Days after applying (or after your last follow-up) before a follow-up comes due. */
export const followUpDays = () => Math.max(1, envDays("FOLLOW_UP_DAYS", 7));
/** Days with no reply after applying before a job is marked "No response". 0 turns this off. */
export const noResponseDays = () => envDays("NO_RESPONSE_DAYS", 30);
/** Days without any email while interviewing before it shows up as worth a nudge. */
export const quietInterviewDays = () => Math.max(1, envDays("QUIET_INTERVIEW_DAYS", 14));

/** Event kinds that mean the employer wrote back. */
export const HEARD = new Set(["rejection", "interview", "action", "recruiter", "offer", "update"]);

export type FollowState = {
  postingId: string;
  company: string;
  title: string;
  status: string;
  appliedAt: string | null;
  followUpAt: string | null;
  events: { date: string; kind: string }[];
};
export type FollowUpDue = { postingId: string; company: string; title: string; status: string; appliedAt: string | null; reason: string; lastContact: string | null };
export type FollowPlan = { due: FollowUpDue[]; markNoResponse: { postingId: string; days: number }[] };

/**
 * The follow-up rules, as a pure function so they're easy to test:
 * - Applied, no reply, and the follow-up date has come: follow up.
 * - Applied, no reply for NO_RESPONSE_DAYS since applying (or since your last follow-up): mark "No response".
 * - Interviewing, and no email either way for QUIET_INTERVIEW_DAYS: worth a check-in.
 */
export function planFollowUps(rows: FollowState[], today: string, cfg = { noResponse: noResponseDays(), quiet: quietInterviewDays() }): FollowPlan {
  const plan: FollowPlan = { due: [], markNoResponse: [] };
  for (const r of rows) {
    const sorted = [...r.events].sort((a, b) => a.date.localeCompare(b.date));
    const last = sorted.at(-1)?.date ?? null;
    const lastFollow = sorted.filter((e) => e.kind === "followup").at(-1)?.date ?? null;
    const lastHeard = sorted.filter((e) => HEARD.has(e.kind)).at(-1)?.date ?? null;
    const base = { postingId: r.postingId, company: r.company, title: r.title, status: r.status, appliedAt: r.appliedAt };
    if (r.status === "applied") {
      if (!r.appliedAt) continue;
      const heard = !!lastHeard && lastHeard >= r.appliedAt;
      const since = lastFollow && lastFollow > r.appliedAt ? lastFollow : r.appliedAt;
      const quietFor = daysBetween(since, today);
      if (!heard && cfg.noResponse > 0 && quietFor >= cfg.noResponse) {
        plan.markNoResponse.push({ postingId: r.postingId, days: daysBetween(r.appliedAt, today) });
        continue;
      }
      if (r.followUpAt && r.followUpAt <= today) {
        const reason = heard
          ? `Last heard from them ${fmtDate(lastHeard)}`
          : lastFollow && lastFollow > r.appliedAt
            ? `No reply since you followed up ${fmtDate(lastFollow)}`
            : `No reply ${daysBetween(r.appliedAt, today)} days after applying`;
        plan.due.push({ ...base, reason, lastContact: last });
      }
    } else if (r.status === "interviewing") {
      const since = last ?? r.appliedAt;
      if (!since) continue;
      const quiet = daysBetween(since, today);
      if (quiet >= cfg.quiet && (!r.followUpAt || r.followUpAt <= today)) plan.due.push({ ...base, reason: `No word for ${quiet} days while interviewing`, lastContact: last });
    }
  }
  plan.due.sort((a, b) => String(a.appliedAt ?? "").localeCompare(String(b.appliedAt ?? "")));
  return plan;
}

export async function loadFollowStates(db: Db): Promise<FollowState[]> {
  const rows = await db
    .select({ postingId: postings.id, company: postings.company, title: postings.title, status: applications.status, appliedAt: applications.appliedAt, followUpAt: applications.followUpAt })
    .from(postings)
    .innerJoin(applications, eq(applications.postingId, postings.id))
    .where(and(eq(postings.archived, false), inArray(applications.status, ["applied", "interviewing"])));
  if (!rows.length) return [];
  const evs = await db.select({ postingId: events.postingId, date: events.date, kind: events.kind }).from(events).where(inArray(events.postingId, rows.map((r) => r.postingId)));
  const by = new Map<string, { date: string; kind: string }[]>();
  for (const e of evs) by.set(e.postingId, [...(by.get(e.postingId) ?? []), { date: e.date, kind: e.kind }]);
  return rows.map((r) => ({ ...r, events: by.get(r.postingId) ?? [] }));
}

/** Runs the rules and saves the "No response" changes. Safe to run as often as you like. */
export async function applyFollowUpRules(db: Db, today = todayIn()): Promise<FollowPlan> {
  const plan = planFollowUps(await loadFollowStates(db), today);
  for (const m of plan.markNoResponse) {
    await db.update(applications).set({ status: "noresponse", noResponseAt: today, updatedAt: new Date() }).where(and(eq(applications.postingId, m.postingId), eq(applications.status, "applied")));
    await db.insert(events).values({ postingId: m.postingId, date: today, kind: "noresponse", summary: `No reply ${m.days} days after applying, so Scoutline marked it No response.` });
  }
  return plan;
}

/** "I followed up": logs it and sets the next follow-up date. */
export async function recordFollowUp(db: Db, postingId: string, today = todayIn()): Promise<void> {
  await db.insert(events).values({ postingId, date: today, kind: "followup", summary: "You followed up." });
  await db.update(applications).set({ followUpAt: addDays(today, followUpDays()), updatedAt: new Date() }).where(eq(applications.postingId, postingId));
}

/** Pushes the follow-up date out without logging anything. */
export async function snoozeFollowUp(db: Db, postingId: string, days = followUpDays(), today = todayIn()): Promise<void> {
  await db.update(applications).set({ followUpAt: addDays(today, days), updatedAt: new Date() }).where(eq(applications.postingId, postingId));
}

/** A short, plain follow-up note for you to edit. Uses nothing but the job and your name. */
export function followUpText(j: { company: string; title: string; appliedAt: string | null; status: string }): { subject: string; body: string } {
  const applied = j.appliedAt ? ` on ${fmtDate(j.appliedAt)}` : "";
  if (j.status === "interviewing") {
    return {
      subject: `Checking in: ${j.title}`,
      body: `Hi,\n\nI wanted to check in on the ${j.title} role. I enjoyed our conversations so far and I'm still very interested. Is there anything else you need from me, or an idea of timing for next steps?\n\nThanks,\n${CANDIDATE_NAME}`,
    };
  }
  return {
    subject: `Following up on my application: ${j.title}`,
    body: `Hi ${j.company} team,\n\nI applied for the ${j.title} role${applied} and wanted to follow up. I'm still interested, and I'd be glad to share anything else that would help with your review.\n\nThanks for your time,\n${CANDIDATE_NAME}`,
  };
}
