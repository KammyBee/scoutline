/**
 * Skill matching: which of Kam's skills a posting asks for, which gaps it shows, and a 1–5 fit
 * from that. Free and instant; Claude scoring (src/lib/ai) refines the fit for the best ones.
 */

const SKILLS: [string, RegExp, number][] = [
  ["SAP", /\bsap\b/i, 3], ["SAP ECC", /\becc\b|\br\/3\b/i, 3], ["ABAP", /\babap\b/i, 3], ["SAP MM", /\bsap mm\b|materials management/i, 2],
  ["BAPI / IDoc / RFC", /\bbapis?\b|\bidocs?\b|\brfcs?\b/i, 2], ["BusinessObjects / BODS", /businessobjects|business objects|\bbods\b|data services|web ?intelligence/i, 2],
  ["Epicor", /epicor|\bkinetic\b|prophet ?21|\bp21\b/i, 3], ["BPMs / BAQs", /\bbaqs?\b|\bbpms?\b/i, 2], ["ERP", /\berp\b/i, 3],
  ["SQL Server / T-SQL", /sql server|t-?sql|\bmssql\b/i, 3], ["SQL", /\bsql\b/i, 2], ["SSRS", /\bssrs\b|reporting services/i, 2], ["Power BI", /power ?bi/i, 2],
  ["C# / .NET", /c#|\.net\b|asp\.net/i, 2], ["TypeScript / JavaScript", /typescript|javascript|\bnode(\.js)?\b/i, 2], ["React / Vue", /\breact\b|\bvue/i, 1],
  ["REST APIs", /\brest(ful)?\b|\bapis?\b|web services/i, 2], ["Integrations", /integrat/i, 2], ["JSON / XML", /\bjson\b|\bxml\b/i, 1],
  ["Data migration", /data migration|data conversion|migrat/i, 2], ["Business systems", /business systems|business analyst|systems analyst|requirements gathering/i, 2],
  ["PostgreSQL", /postgres/i, 1], ["Manufacturing", /manufactur|production planning|shop floor|\bmes\b/i, 2], ["Inventory / supply chain", /inventory|supply chain|procure|purchasing|warehouse/i, 1],
  ["Reports / dashboards", /\breport(s|ing)?\b|dashboard/i, 1], ["App support", /application support|help ?desk|end.user support|troubleshoot/i, 1], ["Active Directory / Intune", /active directory|intune/i, 1],
];

const GAPS: [string, RegExp][] = [
  ["S/4HANA", /s\/?4 ?hana|\bs4\b/i], ["SAP FICO", /\bfico\b|\bfi\/co\b/i], ["SAP SD", /\bsap sd\b|sales and distribution/i], ["SAP BTP / CPI", /\bbtp\b|\bcpi\b|integration suite/i],
  ["SSIS", /\bssis\b/i], ["Dynamics 365", /dynamics 365|\bd365\b|business central/i], ["NetSuite", /netsuite/i], ["Oracle ERP", /oracle (ebs|e-business|fusion|erp|cloud)/i],
  ["Workday", /workday/i], ["Salesforce", /salesforce/i], ["Snowflake", /snowflake/i], ["Tableau", /tableau/i], ["Python", /python/i], ["AWS", /\baws\b/i], ["Azure", /\bazure\b/i],
  ["Kubernetes", /kubernetes|\bk8s\b/i], ["Boomi / MuleSoft", /boomi|mulesoft/i], ["Security clearance", /clearance|public trust/i],
];

const SENIOR_RE = /\b(senior|sr\.?|lead|principal|staff|architect|manager|director|head of|vice president|vp)\b/i;
const CORE_RE = /\b(erp|sap|epicor|abap|business systems|systems analyst|integration|application support|power bi|bi developer|sql developer|\.net|c#|full[- ]?stack|software engineer|developer|programmer)\b/i;
const ERP_RE = /\b(erp|sap|epicor|abap|kinetic|prophet ?21)\b/i;
const STOP = new Set(["and", "the", "for", "with", "remote", "hybrid", "onsite", "job", "role", "full", "time", "part", "contract", "senior", "junior", "level", "usa", "us", "ii", "iii"]);

export type Prefs = { likedTerms: Set<string>; dislikedTitles: string[][] };
export const NO_PREFS: Prefs = { likedTerms: new Set(), dislikedTitles: [] };

export function titleWords(t: string): string[] {
  return String(t || "").toLowerCase().split(/[^a-z0-9#+.]+/).filter((w) => w.length > 2 && !STOP.has(w));
}

export type MatchResult = { hits: string[]; gaps: string[]; points: number; fit: number };

/** Scores one posting from its title and full text. */
export function computeMatch(title: string, text: string | null | undefined, prefs: Prefs = NO_PREFS): MatchResult {
  const t = String(title || "");
  const all = t + "\n" + String(text || "");
  const hits: string[] = [];
  const gaps: string[] = [];
  let pts = 0;
  for (const [label, re, w] of SKILLS) if (re.test(all)) { hits.push(label); pts += w; }
  for (const [label, re] of GAPS) if (re.test(all)) gaps.push(label);
  pts = Math.min(pts, 16);
  if (CORE_RE.test(t)) pts += 3;
  if (ERP_RE.test(t)) pts += 3;
  if (SENIOR_RE.test(t)) pts -= 4;
  pts -= Math.min(gaps.length, 3);
  if (gaps.includes("Security clearance")) pts -= 5;
  pts += Math.min(3, hits.filter((h) => prefs.likedTerms.has(h)).length);
  const words = titleWords(t);
  if (prefs.dislikedTitles.some((d) => overlap(words, d) >= 2)) pts -= 3;
  const fit = pts >= 18 ? 5 : pts >= 13 ? 4 : pts >= 8 ? 3 : pts >= 4 ? 2 : 1;
  return { hits, gaps, points: pts, fit };
}

function overlap(a: string[], b: string[]): number {
  const s = new Set(b);
  return a.filter((w) => s.has(w)).length;
}

export function whyFromMatch(m: MatchResult): string {
  if (!m.hits.length) return "Few of your skills show up in this posting.";
  const lead = "Matches your " + m.hits.slice(0, 4).join(", ");
  return m.gaps.length ? `${lead}. Gap: ${m.gaps.slice(0, 2).join(", ")}.` : lead + ".";
}

/** Builds preferences from your feedback: "More like this" terms, and titles you passed on as not your kind of work. */
export function prefsFrom(rows: { kind: string; reason: string | null; title: string | null; terms: string[] }[]): Prefs {
  const likedTerms = new Set<string>();
  const dislikedTitles: string[][] = [];
  for (const r of rows) {
    if (r.kind === "like") r.terms.forEach((t) => likedTerms.add(t));
    if (r.kind === "dislike" || (r.kind === "pass" && ["Not for me", "Not interested", "Wrong stack"].includes(r.reason ?? ""))) {
      if (r.title) dislikedTitles.push(titleWords(r.title));
    }
  }
  return { likedTerms, dislikedTitles };
}
