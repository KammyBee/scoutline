/** Kam's resume versions. The links point at the styled resumes he already has. */
export const RESUMES: { name: string; url: string; bestFor: string }[] = [
  { name: "SAP", url: "https://claude.ai/artifact/NH5nFAjiVoyaHkvoSQ2q3A", bestFor: "SAP ECC/S4 analyst, ABAP developer, SAP support" },
  { name: "SAP BI", url: "https://claude.ai/artifact/F2DDjA4zwjoAaxH8QfaXSX", bestFor: "SAP reporting, BusinessObjects/BODS, BI in SAP shops" },
  { name: "Epicor", url: "https://claude.ai/artifact/FvdjPGBJdaqSg7EwsNYqUM", bestFor: "Epicor Kinetic, Prophet 21, Eclipse" },
  { name: "ERP Analyst", url: "https://claude.ai/artifact/SsELSC2mroDw8YgStXFQT6", bestFor: "ERP or business systems analyst, government IT analyst" },
  { name: "ERP Support", url: "https://claude.ai/artifact/CgiAU7yKuVywUFcDw28h9P", bestFor: "ERP application support, ERP admin" },
  { name: "App & ERP Dev", url: "https://claude.ai/artifact/KWSQjqTFKbfATomAC4M7rH", bestFor: "ERP developer" },
  { name: "Integrations", url: "https://claude.ai/artifact/Lfe6LgmRyhurYotQd3TJxw", bestFor: "Integration/API/EDI, data migration, SQL, Power BI" },
  { name: "Full Stack v2", url: "https://claude.ai/artifact/PEogwFonZgxqKaSogejWSL", bestFor: "Full-stack TypeScript/React/Node/C#" },
  { name: "App Dev", url: "https://claude.ai/artifact/2zhDd5y2CSGFt7rFcDVfTd", bestFor: ".NET/C# application developer" },
  { name: "Software Dev", url: "https://claude.ai/artifact/RU2oePWezwdkjpGBHLhEqN", bestFor: "General or R&D software engineer" },
  { name: "Service Ops", url: "https://claude.ai/artifact/Bkp5qb4TWwEieDhcUTn6ka", bestFor: "Service operations systems, inventory/parts" },
  { name: "General", url: "https://claude.ai/artifact/DQkC9PW541cL2FQ7kQ53vE", bestFor: "Anything else" },
];

export type ResumePick = { name: string; url: string };

const byName = (name: string): ResumePick => {
  const r = RESUMES.find((x) => x.name === name) ?? RESUMES[RESUMES.length - 1];
  return { name: r.name, url: r.url };
};

export function resumeNamed(name: unknown): ResumePick | null {
  const n = String(name ?? "").trim().toLowerCase();
  const r = RESUMES.find((x) => x.name.toLowerCase() === n);
  return r ? { name: r.name, url: r.url } : null;
}

const count = (text: string, rx: RegExp) => (text.match(new RegExp(rx.source, "gi")) ?? []).length;

/**
 * Picks the best-fit resume from the job title (and, for generic ERP titles, which ERP the posting names).
 * Claude's scoring replaces this guess with its own pick; your own pick is never replaced.
 */
export function pickResume(title: string, description?: string | null): ResumePick {
  const t = title.toLowerCase();
  const d = (description ?? "").toLowerCase();
  if (/businessobjects|\bbods\b|\bwebi\b|sap (bi|bw|analytics)|\bbw\/4/.test(t)) return byName("SAP BI");
  if (/\bsap\b|\babap\b|s\/?4 ?hana/.test(t)) return byName("SAP");
  if (/epicor|prophet ?21|\bp21\b|kinetic/.test(t)) return byName("Epicor");
  if (/integration|\bedi\b|\bapis?\b|data migration|\betl\b|power bi|\bbi (developer|engineer|analyst)|\bsql (developer|engineer)|reporting (developer|engineer|analyst)/.test(t)) return byName("Integrations");
  const erp = /\berp\b|netsuite|business (systems|applications)|enterprise (applications|systems)|dynamics|\bd365\b|oracle|workday|infor\b|acumatica|odoo|(finance|financial|revenue|supply chain|manufacturing|gtm) systems|\bmes\b/.test(t);
  if (erp) {
    if (count(d, /\bsap\b|\babap\b|s\/4/) >= 2) return byName("SAP");
    if (count(d, /epicor|prophet 21/) >= 1) return byName("Epicor");
    if (/support|administrator|\badmin\b|help ?desk/.test(t)) return byName("ERP Support");
    if (/developer|engineer|programmer/.test(t)) return byName("App & ERP Dev");
    return byName("ERP Analyst");
  }
  if (/service (operations|systems)|inventory|\bparts\b|field service/.test(t)) return byName("Service Ops");
  if (/(application|systems|business|it) analyst|implementation|technical (analyst|consultant)/.test(t)) return byName("ERP Analyst");
  if (/application(s)? (support|administrator)|help ?desk/.test(t)) return byName("ERP Support");
  if (/full[- ]?stack|react|typescript|node|front[- ]?end|web (developer|engineer)/.test(t)) return byName("Full Stack v2");
  if (/\.net\b|c#|application(s)? (developer|engineer)/.test(t)) return byName("App Dev");
  if (/software|developer|programmer|engineer/.test(t)) return byName("Software Dev");
  return byName("General");
}

/** One line per resume, for Claude's prompt. */
export const resumeMenu = () => RESUMES.map((r) => `- ${r.name}: ${r.bestFor}`).join("\n");
