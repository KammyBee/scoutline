import { normCompany, normTitle } from "../dedupe";
import { senderDomain, viaAts } from "./classify";
import type { MailIn } from "./parse";

export type Candidate = { id: string; company: string; title: string; status: string; appliedAt: string | null };

const GENERIC = new Set(["the", "global", "american", "united", "first", "general", "national", "international", "group", "systems", "technologies", "solutions", "software", "labs", "health", "bank", "data", "cloud", "energy", "digital"]);
const MAIL_DOMAINS = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com"]);

const norm = (s: string) => " " + s.toLowerCase().replace(/[^a-z0-9#+]+/g, " ").trim() + " ";
const has = (hay: string, needle: string) => needle.trim().length > 1 && hay.includes(" " + needle.trim() + " ");

/** How strongly a message points at one job. 4 or more is a match. */
export function scoreCandidate(m: MailIn, c: Candidate): number {
  const co = normCompany(c.company);
  if (!co) return 0;
  const compact = co.replace(/ /g, "");
  const first = co.split(" ")[0];
  const subj = norm(m.subject), name = norm(m.fromName), text = norm(m.text.slice(0, 3000));
  let s = 0;
  if (has(subj, co) || has(name, co)) s += 4;
  else if (has(text, co)) s += 2;
  else if (first.length >= 4 && !GENERIC.has(first) && (has(subj, first) || has(name, first))) s += 2;
  const domain = senderDomain(m.fromAddress);
  if (domain && !viaAts(m.fromAddress) && !MAIL_DOMAINS.has(domain)) {
    const labels = domain.split(".");
    const root = labels.length >= 2 ? labels[labels.length - 2] : labels[0];
    if (root.length >= 3 && (root === compact || (root.length >= 4 && (compact.startsWith(root) || root.startsWith(compact))))) s += 4;
  }
  if (s === 0) return 0;
  const t = normTitle(c.title);
  if (t && (has(subj, t) || has(text, t))) s += 2;
  if (["applied", "interviewing", "offer", "noresponse"].includes(c.status)) s += 1;
  if (["passed", "rejected"].includes(c.status)) s -= 1;
  return s;
}

/**
 * Picks the job a message is about, or null when it's unclear. A reply in a thread that's already
 * linked to a job stays with that job. Otherwise the company has to show up in the sender, the
 * subject or the text, and two different companies scoring about the same counts as unclear.
 */
export function linkMessage(m: MailIn, candidates: Candidate[], threadJob?: string | null): { postingId: string; score: number } | null {
  if (threadJob && candidates.some((c) => c.id === threadJob)) return { postingId: threadJob, score: 10 };
  const scored = candidates
    .map((c) => ({ c, score: scoreCandidate(m, c) }))
    .filter((x) => x.score >= 4)
    .sort((a, b) => b.score - a.score || String(b.c.appliedAt ?? "").localeCompare(String(a.c.appliedAt ?? "")));
  if (!scored.length) return null;
  const best = scored[0];
  const rival = scored.find((x) => normCompany(x.c.company) !== normCompany(best.c.company));
  if (rival && rival.score >= best.score - 1) return null;
  return { postingId: best.c.id, score: best.score };
}
