"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { addDays, daysBetween, fmtDate } from "@/lib/dates";
import { STAGES, VIEWS, cap, inView, isDue, isSideGig, kindLabel, openAction, payText, statusLabel, type ViewId } from "@/lib/jobView";
import type { JobRow, PipelineData, Status } from "@/lib/types";
import { FitBars } from "./FitBars";
import { JobPanel } from "./JobPanel";
import { Toast, useToast } from "./Toast";

type Sort = "fit" | "found" | "pay";
type Mode = "remote" | "hybrid" | "onsite";

export function Pipeline({ data }: { data: PipelineData }) {
  const { jobs, today, answers, aiReady } = data;
  const [view, setView] = useState<ViewId>("review");
  const [stage, setStage] = useState<Status | null>(null);
  const [q, setQ] = useState("");
  const [modes, setModes] = useState<Set<Mode>>(new Set());
  const [side, setSide] = useState(false);
  const [sort, setSort] = useState<Sort>("fit");
  const [openId, setOpenId] = useState<string | null>(null);
  const toast = useToast();

  const counts = useMemo(() => {
    const c = Object.fromEntries(STAGES.map((s) => [s.id, 0])) as Record<Status, number>;
    jobs.forEach((j) => (c[j.status] = (c[j.status] ?? 0) + 1));
    return c;
  }, [jobs]);

  const visible = useMemo(() => {
    const v = VIEWS.find((x) => x.id === view)!;
    const needle = q.trim().toLowerCase();
    const list = jobs.filter((j) => {
      if (stage ? j.status !== stage : !inView(j, v, today)) return false;
      if (modes.size && !modes.has(j.mode as Mode)) return false;
      if (side && !isSideGig(j)) return false;
      if (needle && ![j.title, j.company, j.location, j.tags.join(" ")].join(" ").toLowerCase().includes(needle)) return false;
      return true;
    });
    list.sort((a, b) => {
      if (view === "applied" && !stage) {
        const d = Number(!isDue(a, today)) - Number(!isDue(b, today));
        if (d) return d;
      }
      if (sort === "found") return String(b.found ?? "").localeCompare(String(a.found ?? "")) || (b.num ?? 0) - (a.num ?? 0);
      if (sort === "pay") return (b.payMax ?? b.payMin ?? 0) - (a.payMax ?? a.payMin ?? 0);
      return b.fit - a.fit || String(b.found ?? "").localeCompare(String(a.found ?? ""));
    });
    return list;
  }, [jobs, view, stage, q, modes, side, sort, today]);

  const close = useCallback(() => {
    const id = openId;
    setOpenId(null);
    if (id) requestAnimationFrame(() => document.getElementById("job-" + id)?.focus({ preventScroll: true }));
  }, [openId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && openId) close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openId, close]);

  const goTo = (j: JobRow) => {
    setStage(null);
    setView(["applied", "interviewing", "offer"].includes(j.status) ? "applied" : ["passed", "rejected", "noresponse"].includes(j.status) ? "closed" : "review");
    setOpenId(j.id);
  };

  const weekAgo = addDays(today, -7);
  const due = jobs.filter((j) => isDue(j, today));
  const appliedTotal = jobs.filter((j) => j.appliedAt).length;
  const heard = jobs.filter((j) => j.appliedAt && ["interviewing", "offer", "rejected"].includes(j.status)).length;
  const toggleMode = (m: Mode) => setModes((s) => { const n = new Set(s); if (n.has(m)) n.delete(m); else n.add(m); return n; });

  return (
    <>
      <section className="summary" aria-label="Pipeline summary">
        <div className="panel pipe">
          <h2 className="panel-title">Pipeline</h2>
          <div className="pipe-bar" aria-hidden="true">
            {STAGES.filter((s) => counts[s.id]).map((s) => (
              <span key={s.id} style={{ background: s.color, flexGrow: counts[s.id] }} title={`${s.label}: ${counts[s.id]}`} />
            ))}
          </div>
          <div className="stages">
            {STAGES.map((s) => (
              <button key={s.id} type="button" className="stage" aria-pressed={stage === s.id} onClick={() => { setStage(stage === s.id ? null : s.id); if (stage !== s.id) setView("all"); }}>
                <span className="n">{counts[s.id]}</span>
                <span className="l"><span className="swatch" style={{ background: s.color }} />{s.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="panel kpis">
          <div className="kpi"><div className="v mono">{counts.new + counts.saved}</div><div className="k">Waiting for your review</div></div>
          <div className="kpi"><div className="v mono">{jobs.filter((j) => j.appliedAt && j.appliedAt >= weekAgo).length}</div><div className="k">Applied in the last 7 days</div></div>
          <div className={"kpi" + (due.length ? " alert" : "")}><div className="v mono">{due.length}</div><div className="k">Follow-ups due</div></div>
          <div className="kpi"><div className="v mono">{appliedTotal ? Math.round((heard / appliedTotal) * 100) + "%" : "—"}</div><div className="k">Response rate on applications</div></div>
        </div>
      </section>

      <div className="toolbar">
        <div className="tabs" role="tablist" aria-label="Job views">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" role="tab" className="tab" aria-selected={view === v.id && !stage} onClick={() => { setView(v.id); setStage(null); }}>
              {v.label}
              <span className="c">{jobs.filter((j) => inView(j, v, today)).length}</span>
            </button>
          ))}
        </div>
        <div className="filters">
          <input className="search" type="search" placeholder="Search title, company, skill" aria-label="Search jobs" value={q} onChange={(e) => setQ(e.target.value)} />
          {(["remote", "hybrid", "onsite"] as Mode[]).map((m) => (
            <button key={m} type="button" className="chip" aria-pressed={modes.has(m)} onClick={() => toggleMode(m)}>{cap(m)}</button>
          ))}
          <button type="button" className="chip" aria-pressed={side} onClick={() => setSide(!side)}>Side gigs</button>
          <select className="select" aria-label="Sort jobs" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="fit">Best fit</option>
            <option value="found">Newest found</option>
            <option value="pay">Highest pay</option>
          </select>
        </div>
      </div>

      <div className="main">
        <section className="list" aria-live="polite">
          {view === "remote" && !stage ? <p className="view-note">Fully remote roles open to candidates anywhere in the US. Roles you haven&apos;t applied to drop off once the posting is more than 30 days old.</p> : null}
          {visible.length ? (
            <div className="panel jlist">
              {visible.map((j) => <Row key={j.id} j={j} today={today} on={openId === j.id} onOpen={() => setOpenId(j.id)} />)}
            </div>
          ) : (
            <div className="panel empty">
              <h2>Nothing here</h2>
              <p>{jobs.length ? "No jobs match these filters." : "No jobs yet. Import your dashboard export to get started (see the README)."}</p>
            </div>
          )}
        </section>
        <Aside jobs={jobs} today={today} onOpen={goTo} />
      </div>

      {openId ? <JobPanel key={openId} id={openId} answers={answers} today={today} aiReady={aiReady} onClose={close} toast={toast.show} /> : null}
      <Toast state={toast.state} />
    </>
  );
}

function Row({ j, today, on, onOpen }: { j: JobRow; today: string; on: boolean; onOpen: () => void }) {
  const act = openAction(j);
  const due = isDue(j, today);
  const bits = [j.location || cap(j.mode), payText(j)].filter(Boolean);
  const la = j.lastEvent;
  return (
    <button type="button" id={"job-" + j.id} className={"jrow" + (on ? " on" : "") + (act || due ? " flag" : "")} aria-haspopup="dialog" onClick={onOpen}>
      <FitBars fit={j.fit} />
      <span className="jr-main">
        <span className="jr-title">{j.title}</span>
        <span className="jr-sub"><b>{j.company}</b>{bits.length ? " · " + bits.join(" · ") : ""}</span>
      </span>
      <span className="jr-flags">
        {act ? <span className="pill act">Action needed</span> : due ? <span className="pill due">Follow up</span> : null}
        {j.hasPrep && (j.status === "interviewing" || j.status === "offer") ? <span className="pill prep">Prep ready</span> : null}
        {isSideGig(j) ? <span className="pill side-gig">Side gig</span> : null}
      </span>
      <span className="jr-when">
        {la ? (
          <>
            {la.kind === "action" && !act ? <span className="kind">Action done</span> : <span className={"kind k-" + (la.kind in { applied: 1, rejection: 1, interview: 1, action: 1, recruiter: 1, offer: 1 } ? la.kind : "update")}>{kindLabel(la.kind)}</span>}
            {fmtDate(la.date)}
          </>
        ) : j.status === "new" || j.status === "saved" ? (
          j.posted ? "Posted " + fmtDate(j.posted) : j.found ? "Found " + fmtDate(j.found) : ""
        ) : j.appliedAt ? (
          "Applied " + fmtDate(j.appliedAt)
        ) : null}
      </span>
      <span className={"status st-" + j.status}>{statusLabel(j.status)}</span>
    </button>
  );
}

function Aside({ jobs, today, onOpen }: { jobs: JobRow[]; today: string; onOpen: (j: JobRow) => void }) {
  const actions = jobs
    .filter((j) => openAction(j))
    .sort((a, b) => String(a.actionNeeded?.due ?? a.actionNeeded?.date ?? "").localeCompare(String(b.actionNeeded?.due ?? b.actionNeeded?.date ?? "")));
  const due = jobs.filter((j) => isDue(j, today)).sort((a, b) => String(a.followUpAt).localeCompare(String(b.followUpAt)));
  const tally: Record<string, number> = {};
  jobs.forEach((j) => { if (j.status === "passed" && j.passReason) tally[j.passReason] = (tally[j.passReason] ?? 0) + 1; });
  const reasons = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  return (
    <aside className="aside">
      <div className="panel">
        <h2 className="panel-title">Needs your action</h2>
        <div className="followups">
          {actions.length ? actions.map((j) => {
            const a = j.actionNeeded!;
            const past = !!a.due && a.due < today;
            return (
              <button key={j.id} type="button" className="fu" style={past ? { opacity: 0.7 } : undefined} onClick={() => onOpen(j)}>
                <b>{j.title} · {j.company}</b>
                <span>{a.text}{a.due ? (past ? " · deadline passed " : " · due ") + fmtDate(a.due) : ""}</span>
              </button>
            );
          }) : <p>Nothing waiting on you. Emails that ask for a form, a reply or a time slot show up here.</p>}
        </div>
      </div>
      <div className="panel">
        <h2 className="panel-title">Follow up</h2>
        <div className="followups">
          {due.length ? due.map((j) => (
            <button key={j.id} type="button" className="fu" onClick={() => onOpen(j)}>
              <b>{j.title} · {j.company}</b>
              <span>{j.appliedAt ? `Applied ${daysBetween(j.appliedAt, today)} days ago` : "Follow-up due"}</span>
            </button>
          )) : <p>Nothing due. Applications you haven&apos;t heard back on after a week show up here.</p>}
        </div>
      </div>
      <div className="panel">
        <h2 className="panel-title">Why you passed</h2>
        {reasons.length ? reasons.map(([r, n]) => (
          <div key={r} className="reason-row">
            <span>{r}</span><span className="mono">{n}</span>
            <div className="reason-bar"><span style={{ width: Math.round((n / reasons[0][1]) * 100) + "%" }} /></div>
          </div>
        )) : <p>No passes yet. When you pass on a role, pick a reason and it&apos;s tallied here.</p>}
      </div>
    </aside>
  );
}
