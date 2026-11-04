import { connection } from "next/server";
import { Suspense } from "react";
import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { Header } from "@/components/Header";
import { aiConfigured, callsToday, dailyLimit, SCORE_MODEL, usageThisMonth, WRITE_MODEL } from "@/lib/ai/claude";
import { pct, replyStats, type StatLine } from "@/lib/stats";

export const metadata = { title: "Stats · Scoutline" };

const PURPOSE: Record<string, string> = { score: "Scoring new jobs", cover_letter: "Cover letters", auto_letter: "Cover letters drafted after checks", answer: "Screening answers" };
const usd = (n: number) => (n < 0.01 && n > 0 ? "under $0.01" : "$" + n.toFixed(2));

function Line({ l }: { l: StatLine }) {
  return (
    <tr>
      <td>{l.label}</td>
      <td className="n">{l.applied}</td>
      <td className="n">{pct(l.replies, l.applied)}</td>
      <td className="n">{pct(l.interviews, l.applied)}</td>
    </tr>
  );
}

async function Replies() {
  await connection();
  const db = await getDb();
  const { postings, applications, matches, events } = schema;
  const rows = await db
    .select({ id: postings.id, status: applications.status, resumeName: applications.resumeName, source: postings.source, mode: postings.mode, fit: matches.fit })
    .from(postings)
    .innerJoin(applications, eq(applications.postingId, postings.id))
    .leftJoin(matches, eq(matches.postingId, postings.id));
  const heard = await db.select({ id: events.postingId }).from(events).where(inArray(events.kind, ["interview", "rejection", "recruiter", "offer", "action"]));
  const replied = new Set(heard.map((h) => h.id));
  const { total, groups } = replyStats(rows.map((r) => ({ ...r, replied: replied.has(r.id) })));
  if (!total.applied) {
    return <section className="panel empty"><h2>No applications yet</h2><p>Reply rates show up here once you mark jobs as applied.</p></section>;
  }
  return (
    <section className="panel stats-panel">
      <h2 className="panel-title">What gets replies</h2>
      <p className="meta-row">{total.applied} applications · {pct(total.replies, total.applied)} heard back · {pct(total.interviews, total.applied)} reached an interview</p>
      <table className="stats">
        <thead><tr><th>Group</th><th className="n">Sent</th><th className="n">Reply</th><th className="n">Intvw</th></tr></thead>
        <tbody>
          {groups.map((g) => [
            <tr key={g.title} className="grp"><td colSpan={4}>{g.title}</td></tr>,
            ...g.lines.map((l) => <Line key={g.title + l.label} l={l} />),
          ])}
        </tbody>
      </table>
    </section>
  );
}

async function Usage() {
  await connection();
  const db = await getDb();
  const [rows, today] = await Promise.all([usageThisMonth(db), callsToday(db)]);
  const calls = rows.reduce((s, r) => s + r.calls, 0);
  const cost = rows.reduce((s, r) => s + r.cost, 0);
  return (
    <section className="panel stats-panel">
      <h2 className="panel-title">Claude this month</h2>
      {aiConfigured() ? (
        <p className="meta-row">{calls} calls · about {usd(cost)} · {today} of {dailyLimit()} calls used today</p>
      ) : (
        <p className="meta-row">Claude features are off. Add ANTHROPIC_API_KEY to .env.local (or Vercel) to turn them on.</p>
      )}
      {rows.length ? (
        <table className="stats">
          <thead><tr><th>Used for</th><th className="n">Calls</th><th className="cost">Cost</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.purpose}><td>{PURPOSE[r.purpose] ?? r.purpose}{r.failed ? ` (${r.failed} failed)` : ""}</td><td className="n">{r.calls}</td><td className="cost">{usd(r.cost)}</td></tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <p className="meta-row">Scoring uses {SCORE_MODEL()}; writing uses {WRITE_MODEL()}. Costs are estimates from token counts; your Anthropic console has the exact bill.</p>
    </section>
  );
}

export default function StatsPage() {
  return (
    <div className="wrap">
      <Header current="stats" />
      <div className="stats-grid">
        <Suspense fallback={<div className="panel empty skeleton"><h2>Loading reply rates</h2></div>}><Replies /></Suspense>
        <Suspense fallback={<div className="panel empty skeleton"><h2>Loading Claude usage</h2></div>}><Usage /></Suspense>
      </div>
    </div>
  );
}
