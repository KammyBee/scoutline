/** Normalizes a company name: lowercase, no legal suffixes or punctuation. */
export function normCompany(s: string | null | undefined): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|co|corp|corporation|company)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Normalizes a job title the same way. */
export function normTitle(s: string | null | undefined): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9#+]+/g, " ")
    .trim();
}

/** The key the database uses to refuse a second copy of the same role. */
export function dedupeKey(company: string | null | undefined, title: string | null | undefined): string {
  return normCompany(company) + "|" + normTitle(title);
}

/** "acme-erp-developer"-style id. */
export function slugify(s: string, max = 60): string {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, max)
    .replace(/-$/, "");
}

/**
 * A looser company name for spotting the same employer across sites: "Cadence Design Systems, Inc."
 * and "Cadence" both become "cadence". Only used in memory to compare jobs, never stored.
 */
export function looseCompany(s: string | null | undefined): string {
  return normCompany(s)
    .replace(/\b(the|group|holdings?|technologies|technology|systems|labs|software|incorporated|limited|usa|us|na|plc|gmbh|ag|sa|lp|llp)\b/g, " ")
    .replace(/\b(design|industries|international|global)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim() || normCompany(s);
}

/**
 * A looser title: drops work-mode and location tags, requisition numbers and bracketed notes, so
 * "ERP Analyst (Remote)", "ERP Analyst - Remote, US" and "ERP Analyst [R12345]" all match "erp analyst".
 * Levels like I / II stay, since those are different jobs.
 */
export function looseTitle(s: string | null | undefined): string {
  return normTitle(
    String(s ?? "")
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/\((?:[^)]*\b(remote|hybrid|on-?site|contract|full[- ]?time|part[- ]?time|us|usa|united states|[a-z ]+, [a-z]{2})\b[^)]*)\)/gi, " ")
      .replace(/\s[-–—|:]\s*(remote|hybrid|on-?site|us|usa|united states|[a-z .]+, [a-z]{2})\b.*$/i, " ")
      .replace(/\b(j?r|req|job)[- #]?\d{3,}\b/gi, " ")
      .replace(/\b(remote|hybrid)\b\s*$/i, " "),
  );
}

export function looseKey(company: string | null | undefined, title: string | null | undefined): string {
  return looseCompany(company) + "|" + looseTitle(title);
}

/** The same posting link with tracking bits removed, for comparing. */
export function normUrl(u: string | null | undefined): string {
  if (!u) return "";
  try {
    const x = new URL(u);
    for (const k of [...x.searchParams.keys()]) if (/^(utm_|gh_src|source|src|ref|lever-source|ashby_)/i.test(k)) x.searchParams.delete(k);
    return (x.hostname.replace(/^www\./, "") + x.pathname.replace(/\/+$/, "") + (x.searchParams.toString() ? "?" + x.searchParams : "")).toLowerCase();
  } catch {
    return String(u).trim().toLowerCase();
  }
}
