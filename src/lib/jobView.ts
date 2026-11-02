import { daysBetween } from "./dates";
import type { ActionNeeded, JobRow, Status } from "./types";

export const STAGES: { id: Status; label: string; color: string }[] = [
  { id: "new", label: "New", color: "var(--accent)" },
  { id: "saved", label: "Saved", color: "var(--violet)" },
  { id: "applied", label: "Applied", color: "var(--teal)" },
  { id: "interviewing", label: "Interviewing", color: "var(--warn)" },
  { id: "offer", label: "Offer", color: "var(--ok)" },
  { id: "rejected", label: "Rejected", color: "var(--bad)" },
  { id: "noresponse", label: "No response", color: "var(--line-strong)" },
  { id: "passed", label: "Passed", color: "var(--faint)" },
];

export type ViewId = "review" | "remote" | "applied" | "closed" | "all";
export const VIEWS: { id: ViewId; label: string; statuses: Status[] | null; remote?: boolean }[] = [
  { id: "review", label: "To review", statuses: ["new", "saved"] },
  { id: "remote", label: "Remote (US)", statuses: ["new", "saved", "applied", "interviewing", "offer"], remote: true },
  { id: "applied", label: "Applied", statuses: ["applied", "interviewing", "offer"] },
  { id: "closed", label: "Passed & closed", statuses: ["passed", "rejected", "noresponse"] },
  { id: "all", label: "All", statuses: null },
];

export const PASS_REASONS = ["Not for me", "Too senior", "Commute or onsite", "Pay too low", "Wrong stack", "Contract only", "Other"];

export const KINDS: Record<string, string> = {
  applied: "Application received",
  rejection: "Not moving forward",
  interview: "Interview",
  action: "Action needed",
  recruiter: "Recruiter",
  offer: "Offer",
  update: "Update",
};

export const ANSWER_FIELDS: [string, string][] = [
  ["linkedin", "LinkedIn URL"], ["location", "Where you live (city, state)"], ["workAuth", "Work authorization"], ["sponsorship", "Need sponsorship now or later?"],
  ["totalYears", "Years of IT / development experience"], ["erpYears", "Years as an ERP developer"], ["sapYears", "Years with SAP ECC"], ["epicorYears", "Years with Epicor"],
  ["kineticYears", "Years with Epicor Kinetic"], ["certs", "Certifications"], ["hourlyRate", "Desired hourly rate (contracts)"], ["salary", "Desired salary (full-time)"],
  ["start", "Earliest start / notice needed"], ["remote", "Remote, hybrid or onsite preference"], ["relocate", "Willing to relocate?"], ["extra", "Other answers recruiters often ask for"],
];

export function answersText(a: Record<string, string>): string {
  return ANSWER_FIELDS.filter(([k]) => a[k] && String(a[k]).trim()).map(([k, label]) => label + ": " + String(a[k]).trim()).join("\n");
}

export const statusLabel = (s: string) => STAGES.find((x) => x.id === s)?.label ?? "New";
export const kindLabel = (k: string) => KINDS[k] ?? "Update";
export const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");

const money = (n: number) => "$" + Math.round(n / 1000) + "k";
export function payText(j: Pick<JobRow, "payText" | "payMin" | "payMax">): string {
  if (j.payText) return j.payText;
  if (j.payMin && j.payMax) return money(j.payMin) + "–" + money(j.payMax);
  if (j.payMin) return money(j.payMin) + "+";
  return "";
}

export function openAction(j: { actionNeeded: ActionNeeded | null }): ActionNeeded | null {
  return j.actionNeeded && !j.actionNeeded.done ? j.actionNeeded : null;
}
export const isDue = (j: JobRow, today: string) => j.status === "applied" && !!j.followUpAt && j.followUpAt <= today;
export function isSideGig(j: JobRow): boolean {
  const t = ((j.employmentType ?? "") + " " + j.tags.join(" ")).toLowerCase();
  return t.includes("part-time") || t.includes("side") || t.includes("flexible");
}
export function isRemoteUS(j: JobRow, today: string): boolean {
  if (j.mode !== "remote") return false;
  if (j.tags.some((t) => t.toLowerCase() === "ask about remote")) return false;
  if ((j.status === "new" || j.status === "saved") && j.posted && daysBetween(j.posted, today) > 30) return false;
  return true;
}
export function inView(j: JobRow, v: (typeof VIEWS)[number], today: string): boolean {
  if (v.statuses && !v.statuses.includes(j.status)) return false;
  if (v.remote && !isRemoteUS(j, today)) return false;
  return true;
}
export function safeUrl(u: string | null | undefined): string | null {
  try {
    const x = new URL(String(u));
    return x.protocol === "https:" || x.protocol === "http:" ? x.href : null;
  } catch {
    return null;
  }
}
