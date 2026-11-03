import { addDays } from "../dates";
import type { MailIn } from "./parse";

export type MailKind = "applied" | "rejection" | "interview" | "action" | "offer" | "recruiter" | "update";

/** Hiring systems that send application mail on an employer's behalf. */
export const ATS_DOMAINS = [
  "greenhouse.io", "greenhouse-mail.io", "lever.co", "hire.lever.co", "ashbyhq.com", "myworkday.com", "myworkdayjobs.com", "workday.com",
  "icims.com", "smartrecruiters.com", "jobvite.com", "workablemail.com", "workable.com", "bamboohr.com", "successfactors.com", "taleo.net",
  "oraclecloud.com", "breezy.hr", "recruitee.com", "jazzhr.com", "applytojob.com", "paylocity.com", "ultipro.com", "ukg.com", "rippling.com",
  "dayforcehcm.com", "adp.com", "pinpointhq.com", "teamtailor.com", "gem.com", "goodtime.io", "calendly.com", "hackerrank.com",
  "codesignal.com", "codility.com", "hirevue.com", "indeed.com", "dice.com", "ziprecruiter.com",
];

/** Newsletters and job-alert digests: never about one of your applications. */
const ALERT_SENDER = /(jobalerts?|job-alerts?|alerts?|digest|newsletter|marketing|noreply-jobs|jobs-listings|recommendations?)@|@(e\.|em\.|mail\.)?(linkedin|glassdoor|monster|simplyhired|builtin|wellfound)\./i;
const ALERT_TEXT = /\b(job alert|jobs? (you may|you might|for you|picked for you|recommended)|new jobs? (matching|for|near)|recommended jobs|people are hiring|unsubscribe from (these|job) alerts?|similar jobs)\b/i;

const RX = {
  offer: /\b(offer letter|pleased to (extend|offer)|extend (you )?an? (formal |verbal )?offer|offer of employment|your offer (details|package)|we('d| would) like to offer you)\b/i,
  rejection:
    /\b(unfortunately|not (to )?(be )?mov(e|ing) forward|decided (not to|to (move|go|proceed|pursue) (forward )?with (other|another|a different))|other candidates|another candidate|no longer (being )?consider|not (been )?selected|position has been filled|filled the (position|role)|will not be (proceeding|moving)|regret to inform|not a (fit|match) at this time|decided to pursue other)\b/i,
  interview:
    /\b(schedul(e|ing) (an?|your|a time for)? ?(interview|phone screen|call|chat|conversation|meeting)|interview (invitation|request|confirmation|scheduled|availability)|invite you to (an? )?(interview|call|chat)|phone screen|next round|your availability|times that work|book a time|onsite interview|virtual interview|video interview|meet with (our|the) (team|hiring manager))\b/i,
  action:
    /\b(assessment|coding (challenge|exercise|test)|take[- ]home|hackerrank|codesignal|codility|questionnaire|complete (the|your|this|a) (form|application|survey|profile|test|task)|please (provide|submit|complete|confirm|upload)|action required|background check|references? (request|check)|e-?sign|sign (the|your) (document|offer))\b/i,
  applied:
    /\b(thank(s| you) for (applying|your application|submitting|your interest in)|application (has been )?(received|submitted|confirmation|complete)|we('ve| have) received your (application|resume)|successfully (applied|submitted)|your application (to|for) .{0,80} (was|has been) (received|submitted))\b/i,
  recruiter:
    /\b(recruit(er|ing)|talent (acquisition|partner)|sourcer|came across your (profile|resume|background)|(open|new) (role|position|opportunity)|would you be (open|interested)|are you (open|interested) (to|in)|reach(ing)? out about)\b/i,
  job: /\b(application|applied|applying|candidate|candidacy|position|role|opportunit|interview|recruit|hiring|resume|job)\b/i,
};

const NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10, fourteen: 14 };

/** "within 3 days" / "in the next five business days" → a due date. */
export function dueFrom(text: string, sentIso: string): string | null {
  const m = text.match(/\b(?:within|in the next|in)\s+(\d{1,2}|one|two|three|four|five|six|seven|ten|fourteen)\s+(business\s+)?days?\b/i);
  if (!m) return null;
  const n = /\d/.test(m[1]) ? Number(m[1]) : NUM[m[1].toLowerCase()];
  if (!n || n > 30) return null;
  return addDays(sentIso.slice(0, 10), m[2] ? Math.ceil((n * 7) / 5) : n);
}

export function senderDomain(address: string): string {
  return (address.split("@")[1] ?? "").toLowerCase();
}

export function viaAts(address: string): boolean {
  const d = senderDomain(address);
  return ATS_DOMAINS.some((a) => d === a || d.endsWith("." + a));
}

export function isNoReply(address: string): boolean {
  return /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|notifications?|mailer|careers?|jobs|talent|recruiting|hiring|team|hr)[^@]*@/i.test(address);
}

export type Classified = { kind: MailKind; actionText: string | null; due: string | null } | null;

/**
 * Decides what a message is about from its sender, subject and text. Returns null for anything
 * that isn't about a job application (those are never saved). Order matters: a rejection usually
 * also says "thank you for applying", so it's checked first.
 */
export function classify(m: MailIn): Classified {
  if (m.labels.includes("SENT") || m.labels.includes("DRAFT") || m.labels.includes("SPAM")) return null;
  const head = m.subject + "\n" + m.text.slice(0, 2500);
  if (ALERT_SENDER.test(m.fromAddress) || ALERT_TEXT.test(m.subject) || (ALERT_TEXT.test(head) && !RX.applied.test(head))) return null;
  // Calendar invitations for interviews
  if (/^(updated )?invitation:/i.test(m.subject) && RX.job.test(head + " interview")) {
    if (/interview|screen|call|chat/i.test(m.subject)) return { kind: "interview", actionText: "Interview invitation: check the time and accept it", due: null };
  }
  if (RX.offer.test(head)) return { kind: "offer", actionText: "Review the offer", due: dueFrom(head, m.date) };
  if (RX.rejection.test(head) && RX.job.test(head)) return { kind: "rejection", actionText: null, due: null };
  if (RX.interview.test(head)) return { kind: "interview", actionText: "Reply with your availability", due: dueFrom(head, m.date) };
  if (RX.action.test(head) && (RX.job.test(head) || viaAts(m.fromAddress))) {
    const a = head.match(RX.action)?.[0]?.toLowerCase() ?? "";
    const actionText = /assessment|challenge|exercise|test|hackerrank|codesignal|codility|take/.test(a)
      ? "Complete the assessment"
      : /background|reference/.test(a)
        ? "Complete the background or reference check"
        : /sign/.test(a)
          ? "Sign the document"
          : "Complete what they asked for";
    return { kind: "action", actionText, due: dueFrom(head, m.date) };
  }
  if (RX.applied.test(head)) return { kind: "applied", actionText: null, due: null };
  if (!isNoReply(m.fromAddress) && !viaAts(m.fromAddress) && RX.recruiter.test(head) && RX.job.test(head)) return { kind: "recruiter", actionText: null, due: null };
  if (viaAts(m.fromAddress) && RX.job.test(head)) return { kind: "update", actionText: null, due: null };
  return null;
}

/** A message that isn't clearly one of the kinds above, but may still be from an employer you applied to. */
export function looksJobRelated(m: MailIn): boolean {
  return RX.job.test(m.subject) && !ALERT_TEXT.test(m.subject) && !ALERT_SENDER.test(m.fromAddress);
}

/** Gmail search used to fetch candidate messages: received mail only, no promos or social, job-ish words or hiring systems. */
export function gmailQuery(afterEpochSec: number): string {
  const froms = ATS_DOMAINS.filter((d) => !["indeed.com", "dice.com", "ziprecruiter.com", "calendly.com", "adp.com"].includes(d)).map((d) => "from:" + d);
  const words = ['"your application"', '"thank you for applying"', '"thanks for applying"', "subject:interview", "subject:application", "subject:applying", '"next steps"', "subject:offer", "subject:assessment", "subject:candidate", "subject:position", "subject:opportunity", "subject:role", "recruiter", "unfortunately"];
  return `after:${afterEpochSec} -in:sent -in:drafts -in:chats -category:promotions -category:social {${[...froms, ...words].join(" ")}}`;
}
