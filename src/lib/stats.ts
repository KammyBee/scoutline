/** Reply-rate tables for the Stats page. Pure so it can be tested without a database. */
export type AppliedRow = { status: string; resumeName: string | null; source: string | null; mode: string | null; fit: number | null; replied: boolean };
export type StatLine = { label: string; applied: number; replies: number; interviews: number };
export type StatGroup = { title: string; lines: StatLine[] };

const SENT = new Set(["applied", "interviewing", "offer", "rejected", "noresponse"]);
export const wasSent = (status: string) => SENT.has(status);

function group(rows: AppliedRow[], title: string, key: (r: AppliedRow) => string, opts: { byLabel?: boolean; rollUpSingles?: boolean } = {}): StatGroup {
  const m = new Map<string, StatLine>();
  for (const r of rows) {
    const k = key(r);
    const line = m.get(k) ?? { label: k, applied: 0, replies: 0, interviews: 0 };
    line.applied++;
    if (r.replied || ["interviewing", "offer", "rejected"].includes(r.status)) line.replies++;
    if (r.status === "interviewing" || r.status === "offer") line.interviews++;
    m.set(k, line);
  }
  let lines = [...m.values()];
  if (opts.rollUpSingles) {
    const singles = lines.filter((l) => l.applied === 1);
    if (singles.length > 1) {
      lines = lines.filter((l) => l.applied > 1);
      lines.push(singles.reduce((o, l) => ({ ...o, applied: o.applied + 1, replies: o.replies + l.replies, interviews: o.interviews + l.interviews }), { label: `${singles.length} other sources`, applied: 0, replies: 0, interviews: 0 }));
    }
  }
  return { title, lines: lines.sort(opts.byLabel ? (a, b) => Number(a.label === "Not scored") - Number(b.label === "Not scored") || b.label.localeCompare(a.label) : (a, b) => (b.label.endsWith("other sources") ? -1 : a.label.endsWith("other sources") ? 1 : b.applied - a.applied || a.label.localeCompare(b.label))) };
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function replyStats(all: AppliedRow[]): { total: StatLine; groups: StatGroup[] } {
  const rows = all.filter((r) => wasSent(r.status));
  const total = group(rows, "", () => "All applications").lines[0] ?? { label: "All applications", applied: 0, replies: 0, interviews: 0 };
  return {
    total,
    groups: [
      group(rows, "By resume", (r) => r.resumeName || "No resume recorded"),
      group(rows, "By source", (r) => r.source || "Unknown", { rollUpSingles: true }),
      group(rows, "By work mode", (r) => cap(r.mode || "unknown")),
      group(rows, "By fit score", (r) => (r.fit ? `Fit ${r.fit} of 5` : "Not scored"), { byLabel: true }),
    ],
  };
}

export const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) + "%" : "–");
