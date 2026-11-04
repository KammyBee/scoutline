import { daysBetween } from "../dates";
import type { FeedJob } from "./types";

/**
 * Which postings are worth your review. Company boards list every opening (sales, legal, design…),
 * so the title has to match the kind of work you do. Phase 3 replaces the fit tiers with real scoring.
 */

/** Tier A: ERP and business systems work, your core. */
const TIER_A = /\b(erp|sap|abap|s\/?4 ?hana|epicor|netsuite|dynamics 365|d365|business central|oracle (ebs|fusion|erp|cloud)|workday|infor|acumatica|odoo|mes)\b|business systems|business applications|enterprise (applications|systems)|integration(s)? (engineer|developer|analyst|specialist)|\bedi\b|data migration|(finance|financial|revenue|supply chain|manufacturing|gtm) systems/i;
/** Tier B: adjacent roles that use your stack. */
const TIER_B = /application(s)? (developer|engineer|analyst|support|administrator|specialist)|\b(it|information technology) specialist|systems analyst|business analyst|it (analyst|business analyst|systems|applications)|technical (analyst|consultant)|implementation (engineer|consultant|specialist)|solutions engineer|internal tools|sql developer|database (developer|analyst)|\b(bi|power bi|reporting) (developer|engineer|analyst)|\.net\b|\bc#|r&d software|software (engineer|developer)[^,]*\b(i|1|ii|2)\b|full[- ]?stack|(early|new grad|junior|associate)[^,]*(engineer|developer)/i;
/** Tier C: general software roles; kept but ranked low. */
const TIER_C = /software (engineer|developer)|\bdeveloper\b|\bprogrammer\b/i;

/** Too senior, wrong function, or not a regular job. */
const EXCLUDE = /\b(senior|sr\.?|staff|principal|lead|manager|director|supervisory|head|vp|vice president|chief|architect|distinguished|fellow|intern(ship)?|co-?op|apprentice|recruit(er|ing)|sales|account (executive|manager)|marketing|counsel|attorney|designer|machine learning|\bml\b|research (scientist|engineer)|scientist|clearance|ts\/sci|security engineer)\b/i;

const BAY_AREA = /\b(san francisco|sf bay|bay area|south san francisco|oakland|berkeley|emeryville|alameda|san leandro|hayward|fremont|newark|union city|san jose|santa clara|sunnyvale|mountain view|palo alto|menlo park|redwood city|redwood shores|san mateo|burlingame|san bruno|foster city|belmont|san carlos|cupertino|milpitas|los gatos|campbell|pleasanton|livermore|dublin, ca|walnut creek|concord|san ramon|richmond, ca|marin|san rafael|novato|petaluma|santa rosa|napa)\b/i;
const NON_US = /\b(canada|toronto|vancouver|montreal|mexico|brazil|argentina|colombia|uk|united kingdom|england|london|ireland|dublin(?!, ca)|germany|berlin|munich|france|paris|spain|madrid|barcelona|portugal|lisbon|netherlands|amsterdam|poland|warsaw|sweden|stockholm|switzerland|zurich|israel|tel aviv|india|bangalore|bengaluru|hyderabad|pune|singapore|japan|tokyo|korea|seoul|china|shanghai|australia|sydney|melbourne|new zealand|philippines|emea|apac|latam|europe)\b/i;
const US = /\b(united states|usa|u\.s\.?|us|us-remote|remote[ -]us|north america)\b|,\s*(ca|wa|or|nv|az|tx|co|ny|ma|il|ga|nc|fl|va|ut|mn|pa|nj|oh|mi|wi|mo|tn|md|dc)\b/i;

export type Tier = "A" | "B" | "C";
export type Verdict = { keep: true; tier: Tier; mode: "remote" | "hybrid" | "onsite"; reason: string } | { keep: false; reason: string };

export function titleTier(title: string): Tier | null {
  if (EXCLUDE.test(title)) return null;
  if (TIER_A.test(title)) return "A";
  if (TIER_B.test(title)) return "B";
  if (TIER_C.test(title)) return "C";
  return null;
}

/** Remote in the US, or hybrid/onsite in the Bay Area. */
export function placeFor(job: Pick<FeedJob, "location" | "workplace" | "country">): "remote" | "hybrid" | "onsite" | null {
  const loc = job.location || "";
  const country = (job.country || "").toUpperCase();
  const saysRemote = job.workplace === "remote" || /\bremote\b|anywhere|distributed/i.test(loc);
  const foreign = (country && !["US", "USA", "UNITED STATES"].includes(country)) || (NON_US.test(loc) && !US.test(loc));
  if (saysRemote && !foreign) return "remote";
  if (BAY_AREA.test(loc)) return job.workplace === "hybrid" || /hybrid/i.test(loc) ? "hybrid" : job.workplace === "remote" ? "remote" : "onsite";
  return null;
}

export function judge(job: FeedJob, today: string, maxAgeDays = 30): Verdict {
  const tier = titleTier(job.title);
  if (!tier) return { keep: false, reason: "title" };
  const mode = placeFor(job);
  if (!mode) return { keep: false, reason: "location" };
  if (job.posted && daysBetween(job.posted, today) > maxAgeDays) return { keep: false, reason: "age" };
  return { keep: true, tier, mode, reason: tier === "A" ? "ERP / business systems title" : tier === "B" ? "Adjacent role using your stack" : "General software role" };
}

export const TIER_FIT: Record<Tier, number> = { A: 4, B: 3, C: 2 };
