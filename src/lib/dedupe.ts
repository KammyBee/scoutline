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
