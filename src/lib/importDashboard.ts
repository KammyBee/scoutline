import type { ActionNeeded, Prep, Status, ThankYou } from "@/db/schema";
import { STATUSES } from "@/db/schema";
import { dedupeKey, slugify } from "./dedupe";

/** Shape of the JSON exported from the Claude "ERP Job Pipeline" dashboard. */
export type DashboardExport = {
  format: string;
  version: number;
  exportedAt?: string;
  jobs: DashboardJob[];
  emails: DashboardEmail[];
  meta: { seen?: { jobs?: { url?: string; job?: string }[] }; answers?: Record<string, unknown>; [k: string]: unknown };
};

type Activity = { date?: string; kind?: string; summary?: string; link?: string; emailId?: string };
export type DashboardJob = {
  id: string;
  num?: number;
  title?: string;
  company?: string;
  location?: string;
  mode?: string;
  type?: string;
  pay?: string;
  payMin?: number;
  payMax?: number;
  url?: string;
  source?: string;
  posted?: string;
  found?: string;
  verified?: string;
  fit?: number;
  why?: string;
  tags?: string[];
  status?: string;
  appliedAt?: string | null;
  followUpAt?: string | null;
  passReason?: string;
  passedAt?: string;
  noResponseAt?: string;
  notes?: string;
  coverLetter?: string;
  activity?: Activity[];
  lastEmailAt?: string;
  actionNeeded?: ActionNeeded;
  description?: { text?: string; savedAt?: string; sourceUrl?: string; unavailable?: boolean };
  kit?: { resumeName?: string; resumeUrl?: string; tips?: string[] };
  prep?: Prep;
  interviewAt?: string;
  interviewEnd?: string;
  thankYou?: ThankYou;
  match?: { hits?: string[]; gaps?: string[] };
};
export type DashboardEmail = {
  id: string;
  threadId?: string;
  jobId?: string;
  date?: string;
  from?: string;
  subject?: string;
  kind?: string;
  summary?: string;
  link?: string;
  actionText?: string | null;
  due?: string | null;
  state?: string;
  processedAt?: string;
};

export type MappedImport = {
  postings: {
    id: string; num: number | null; title: string; company: string; location: string; mode: string; employmentType: string | null;
    payText: string | null; payMin: number | null; payMax: number | null; url: string | null; source: string | null;
    posted: string | null; found: string | null; verified: string | null; description: string | null; descriptionSavedAt: string | null;
    descriptionUnavailable: boolean; tags: string[]; dedupeKey: string; archived: boolean;
  }[];
  matches: { postingId: string; fit: number; why: string | null; hits: string[]; gaps: string[]; scoredBy: string }[];
  applications: {
    postingId: string; status: Status; appliedAt: string | null; followUpAt: string | null; passedAt: string | null; passReason: string | null;
    noResponseAt: string | null; notes: string | null; coverLetter: string | null; resumeName: string | null; resumeUrl: string | null;
    kitTips: string[]; actionNeeded: ActionNeeded | null; interviewAt: string | null; interviewEnd: string | null; prep: Prep | null;
    thankYou: ThankYou | null; lastEmailAt: string | null;
  }[];
  events: { postingId: string; date: string; kind: string; summary: string; link: string | null; emailId: string | null }[];
  emails: {
    id: string; threadId: string | null; postingId: string | null; date: string | null; sender: string | null; subject: string | null;
    kind: string | null; summary: string | null; link: string | null; actionText: string | null; due: string | null; state: string;
    processedAt: string | null;
  }[];
  feedback: { postingId: string; kind: string; reason: string | null; title: string; company: string }[];
  settings: { key: string; value: unknown }[];
  warnings: string[];
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export function asDay(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  const d = v.slice(0, 10);
  if (!DAY.test(d)) return null;
  const t = Date.parse(d + "T00:00:00Z");
  return !isNaN(t) && new Date(t).toISOString().slice(0, 10) === d ? d : null; // rejects Feb 30 etc.
}
export function asTimestamp(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  return isNaN(Date.parse(v)) ? null : new Date(v).toISOString();
}
function asText(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}
function asInt(v: unknown): number | null {
  return typeof v === "number" && isFinite(v) ? Math.round(v) : null;
}
function asStatus(v: unknown): Status {
  return (STATUSES as readonly string[]).includes(String(v)) ? (v as Status) : "new";
}
function asMode(v: unknown): string {
  const m = String(v ?? "").toLowerCase();
  return m === "remote" || m === "hybrid" || m === "onsite" ? m : "";
}

/** Turns a dashboard export into rows for each table. Pure, so it can be unit-tested. */
export function mapExport(exp: DashboardExport): MappedImport {
  if (!exp || !Array.isArray(exp.jobs)) throw new Error("Not a dashboard export: missing jobs[]");
  const out: MappedImport = { postings: [], matches: [], applications: [], events: [], emails: [], feedback: [], settings: [], warnings: [] };
  const keys = new Set<string>();
  const urls = new Set<string>();
  const ids = new Set<string>();

  for (const j of exp.jobs) {
    if (!j.id || !j.title || !j.company) { out.warnings.push(`Skipped a job with no id, title or company (${j.id ?? "?"})`); continue; }
    let key = dedupeKey(j.company, j.title);
    if (keys.has(key)) { out.warnings.push(`Duplicate role kept separately: ${j.company} | ${j.title} (${j.id})`); key = key + "#" + j.id; }
    keys.add(key);
    let url = asText(j.url);
    if (url && urls.has(url)) { out.warnings.push(`Shared posting link dropped from ${j.id} (already used by another job)`); url = null; }
    if (url) urls.add(url);
    ids.add(j.id);

    const d = j.description || {};
    out.postings.push({
      id: j.id, num: asInt(j.num), title: j.title, company: j.company, location: j.location ?? "", mode: asMode(j.mode),
      employmentType: asText(j.type), payText: asText(j.pay), payMin: asInt(j.payMin), payMax: asInt(j.payMax), url,
      source: asText(j.source), posted: asDay(j.posted), found: asDay(j.found), verified: asDay(j.verified),
      description: asText(d.text), descriptionSavedAt: asTimestamp(d.savedAt), descriptionUnavailable: !!d.unavailable,
      tags: Array.isArray(j.tags) ? j.tags.map(String) : [], dedupeKey: key, archived: false,
    });
    out.matches.push({
      postingId: j.id, fit: Math.max(1, Math.min(5, asInt(j.fit) ?? 3)), why: asText(j.why),
      hits: j.match?.hits ?? [], gaps: j.match?.gaps ?? [], scoredBy: "import",
    });
    const kit = j.kit || {};
    out.applications.push({
      postingId: j.id, status: asStatus(j.status), appliedAt: asDay(j.appliedAt), followUpAt: asDay(j.followUpAt), passedAt: asDay(j.passedAt),
      passReason: asText(j.passReason), noResponseAt: asDay(j.noResponseAt), notes: asText(j.notes), coverLetter: asText(j.coverLetter),
      resumeName: asText(kit.resumeName), resumeUrl: asText(kit.resumeUrl), kitTips: Array.isArray(kit.tips) ? kit.tips.map(String) : [],
      actionNeeded: j.actionNeeded && j.actionNeeded.text ? { ...j.actionNeeded, done: !!j.actionNeeded.done } : null,
      interviewAt: asTimestamp(j.interviewAt), interviewEnd: asTimestamp(j.interviewEnd),
      prep: j.prep && j.prep.text ? j.prep : null, thankYou: j.thankYou && (j.thankYou.draftUrl || j.thankYou.createdAt) ? j.thankYou : null,
      lastEmailAt: asTimestamp(j.lastEmailAt),
    });
    for (const a of j.activity ?? []) {
      const date = asDay(a.date) ?? asDay(j.found);
      if (!date) continue;
      out.events.push({ postingId: j.id, date, kind: a.kind || "update", summary: a.summary || "", link: asText(a.link), emailId: asText(a.emailId) });
    }
    if (j.status === "passed") out.feedback.push({ postingId: j.id, kind: "pass", reason: asText(j.passReason), title: j.title, company: j.company });
  }

  // Roles seen before but no longer in the dashboard: kept, archived, so they never come back.
  for (const s of exp.meta?.seen?.jobs ?? []) {
    const label = String(s.job ?? "");
    const cut = label.indexOf(" | ");
    if (cut < 0) continue;
    const company = label.slice(0, cut).trim(), title = label.slice(cut + 3).trim();
    if (!company || !title) continue;
    const key = dedupeKey(company, title);
    const url = asText(s.url);
    if (keys.has(key) || (url && urls.has(url))) continue;
    let id = "seen-" + slugify(company + "-" + title, 54);
    while (ids.has(id)) id += "-x";
    ids.add(id); keys.add(key); if (url) urls.add(url);
    out.postings.push({
      id, num: null, title, company, location: "", mode: "", employmentType: null, payText: null, payMin: null, payMax: null, url,
      source: "Seen in dashboard", posted: null, found: null, verified: null, description: null, descriptionSavedAt: null,
      descriptionUnavailable: false, tags: [], dedupeKey: key, archived: true,
    });
  }

  for (const e of exp.emails ?? []) {
    if (!e.id) continue;
    out.emails.push({
      id: e.id, threadId: asText(e.threadId), postingId: e.jobId && ids.has(e.jobId) ? e.jobId : null, date: asTimestamp(e.date),
      sender: asText(e.from), subject: asText(e.subject), kind: asText(e.kind), summary: asText(e.summary), link: asText(e.link),
      actionText: asText(e.actionText), due: asDay(e.due), state: e.state || "matched", processedAt: asTimestamp(e.processedAt),
    });
  }

  const answers = exp.meta?.answers;
  if (answers && typeof answers === "object") {
    const rest = Object.fromEntries(Object.entries(answers).filter(([k]) => k !== "updatedAt"));
    out.settings.push({ key: "screeningAnswers", value: rest });
  }
  return out;
}
