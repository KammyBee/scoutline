const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", bull: "•", middot: "·" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Turns job-posting HTML (possibly HTML-escaped, as Greenhouse sends it) into readable plain text. */
export function htmlToText(input: string | null | undefined, max = 5000): string {
  if (!input) return "";
  let s = String(input);
  if (/&lt;\/?[a-z]/i.test(s)) s = decodeEntities(s); // escaped HTML → HTML
  s = s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/li>/gi, "")
    .replace(/<\/(p|div|h[1-6]|ul|ol|section|tr)>/gi, "\n")
    .replace(/<h[1-6][^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  s = decodeEntities(s)
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return s.length > max ? s.slice(0, max).replace(/\s+\S*$/, "") + "…" : s;
}

export function isoDay(v: unknown): string | null {
  if (v == null || v === "") return null;
  const d = typeof v === "number" ? new Date(v) : new Date(String(v));
  return isNaN(+d) ? null : d.toISOString().slice(0, 10);
}
