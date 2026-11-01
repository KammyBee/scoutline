"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { archiveJob, loadJob, markActionDone, saveDate, saveText, setFit, setStatus } from "@/app/actions";
import { addDays, fmtDate } from "@/lib/dates";
import { KINDS, PASS_REASONS, answersText, cap, kindLabel, openAction, payText, safeUrl, statusLabel } from "@/lib/jobView";
import type { JobDetail, Status } from "@/lib/types";
import { FitBars } from "./FitBars";

type Tab = "overview" | "apply" | "prep" | "posting";

function utcStamp(d: Date) {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
function gcalLink(title: string, details: string, opts: { start?: string | null; end?: string | null; day?: string | null }) {
  let dates = "";
  if (opts.start) {
    const s = new Date(opts.start);
    if (isNaN(+s)) return null;
    const e = opts.end ? new Date(opts.end) : new Date(+s + 30 * 60000);
    dates = utcStamp(s) + "/" + utcStamp(isNaN(+e) ? new Date(+s + 30 * 60000) : e);
  } else if (opts.day) {
    dates = opts.day.replace(/-/g, "") + "/" + addDays(opts.day, 1).replace(/-/g, "");
  } else return null;
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${dates}&details=${encodeURIComponent(details)}`;
}
function when(iso: string) {
  const d = new Date(iso);
  return isNaN(+d) ? iso : d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function JobPanel(props: { id: string; answers: Record<string, string>; today: string; onClose: () => void; toast: (m: string) => void }) {
  const { id, answers, today, onClose, toast } = props;
  const [j, setJ] = useState<JobDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [passing, setPassing] = useState(false);
  const [pending, start] = useTransition();
  const closeRef = useRef<HTMLButtonElement>(null);

  const reload = () => loadJob(id).then((d) => (d ? setJ(d) : setFailed(true)), () => setFailed(true));
  useEffect(() => {
    let live = true;
    loadJob(id).then((d) => { if (live) { if (d) setJ(d); else setFailed(true); } }, () => live && setFailed(true));
    closeRef.current?.focus({ preventScroll: true });
    document.body.classList.add("drawer-open");
    return () => { live = false; document.body.classList.remove("drawer-open"); };
  }, [id]);

  const run = (fn: () => Promise<unknown>, ok?: string) =>
    start(async () => {
      try { await fn(); if (ok) toast(ok); } catch { toast("That didn't save. Try again in a moment."); }
    });
  const changeStatus = (s: Status, reason?: string, ok?: string) =>
    run(async () => { const d = await setStatus(id, s, reason); if (d) setJ(d); setPassing(false); }, ok ?? "Status: " + statusLabel(s));

  const copy = (text: string | null | undefined, ok: string) => {
    if (!text) { toast("Nothing to copy yet"); return; }
    navigator.clipboard?.writeText(text).then(() => toast(ok), () => toast("Select the text and copy it manually"));
  };

  const tabs: [Tab, string][] = [["overview", "Overview"], ["apply", "Apply"]];
  if (j?.prep?.text) tabs.push(["prep", "Interview prep"]);
  tabs.push(["posting", "Posting"]);

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="dr-title" aria-busy={pending}>
        <header className="dr-head">
          <div className="dr-top">
            <span className="dr-ref">
              {j ? <><span className="req">REQ-{String(j.num ?? 0).padStart(4, "0")}</span><FitBars fit={j.fit} /><span className={"status st-" + j.status}>{statusLabel(j.status)}</span></> : <span className="req">Loading…</span>}
            </span>
            <button ref={closeRef} type="button" className="dr-close" aria-label="Close details" onClick={onClose}>×</button>
          </div>
          {failed ? <p className="meta-row">This job couldn&apos;t be loaded. It may have been removed.</p> : null}
          {j ? (
            <>
              <h2 id="dr-title">{j.title}</h2>
              <div className="co"><b>{j.company}</b>{j.location ? " · " + j.location : ""}</div>
              <div className="tags">
                {j.mode ? <span className="pill">{cap(j.mode)}</span> : null}
                {j.employmentType ? <span className="pill">{j.employmentType}</span> : null}
                {payText(j) ? <span className="pill pay">{payText(j)}</span> : null}
                {j.tags.slice(0, 4).map((t) => <span key={t} className="pill">{t}</span>)}
              </div>
              <div className="dr-actions">
                {j.status === "new" || j.status === "saved" ? (
                  <>
                    <button type="button" className="btn primary" disabled={pending} onClick={() => changeStatus("applied", undefined, "Marked applied. Follow-up set for " + fmtDate(addDays(today, 7)))}>I applied</button>
                    {j.status === "new" ? <button type="button" className="btn" disabled={pending} onClick={() => changeStatus("saved", undefined, "Saved for later")}>Save for later</button> : null}
                    <button type="button" className="btn" disabled={pending} onClick={() => setPassing(!passing)}>Pass</button>
                  </>
                ) : ["applied", "interviewing", "offer", "noresponse"].includes(j.status) ? (
                  <select className="select" aria-label="Application status" value={j.status} disabled={pending} onChange={(e) => changeStatus(e.target.value as Status)}>
                    {(["applied", "interviewing", "offer", "rejected", "noresponse"] as Status[]).map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                  </select>
                ) : (
                  <button type="button" className="btn" disabled={pending} onClick={() => changeStatus("new", undefined, "Back in your review list")}>Move back to review</button>
                )}
                {safeUrl(j.url) ? <a className="btn" href={safeUrl(j.url)!} target="_blank" rel="noopener noreferrer">Open posting ↗</a> : null}
              </div>
              {passing ? (
                <div className="passbox">
                  <p>Why are you passing? This steers what gets suggested later.</p>
                  <div className="reasons">
                    {PASS_REASONS.map((r) => <button key={r} type="button" className="chip" disabled={pending} onClick={() => changeStatus("passed", r, "Passed: " + r)}>{r}</button>)}
                    <button type="button" className="btn quiet" onClick={() => setPassing(false)}>Cancel</button>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </header>
        {j ? (
          <>
            <div className="dr-tabs" role="tablist">
              {tabs.map(([k, label]) => (
                <button key={k} type="button" role="tab" className="dr-tab" aria-selected={tab === k} onClick={() => setTab(k)}>
                  {label}{k === "prep" && (j.status === "interviewing" || j.status === "offer") ? <span className="dot" /> : null}
                </button>
              ))}
            </div>
            <div className="dr-body" role="tabpanel">
              {tab === "overview" ? <Overview j={j} pending={pending} run={run} reload={reload} onArchived={onClose} openPrep={() => setTab("prep")} /> : null}
              {tab === "apply" ? <Apply j={j} answers={answers} copy={copy} run={run} /> : null}
              {tab === "prep" ? <PrepTab j={j} copy={copy} /> : null}
              {tab === "posting" ? <Posting j={j} copy={copy} /> : null}
            </div>
          </>
        ) : null}
      </aside>
    </>
  );
}

type Run = (fn: () => Promise<unknown>, ok?: string) => void;

function Overview({ j, pending, run, reload, onArchived, openPrep }: { j: JobDetail; pending: boolean; run: Run; reload: () => void; onArchived: () => void; openPrep: () => void }) {
  const act = openAction(j);
  const [notes, setNotes] = useState(j.notes ?? "");
  const [confirm, setConfirm] = useState(false);
  const bits = [
    j.posted && "Posted " + fmtDate(j.posted),
    j.found && "Found " + fmtDate(j.found),
    j.appliedAt && "Applied " + fmtDate(j.appliedAt),
    j.source && "Source: " + j.source,
    j.passReason && "Passed: " + j.passReason,
  ].filter(Boolean);
  const cal = act?.due ? gcalLink(`Due: ${act.text} (${j.company})`, `${j.title} at ${j.company}${act.link ? "\n" + act.link : ""}`, { day: act.due }) : null;
  return (
    <>
      {j.why ? <p className="why">{j.why}</p> : null}
      {bits.length ? <p className="meta-row">{bits.join(" · ")}</p> : null}
      {act ? (
        <div className="action-box">
          <span>Action needed: {act.text}{act.due ? ` (due ${fmtDate(act.due)})` : ""}</span>
          {safeUrl(act.link) ? <a className="btn" href={safeUrl(act.link)!} target="_blank" rel="noopener noreferrer">Open email ↗</a> : null}
          {cal ? <a className="btn" href={cal} target="_blank" rel="noopener noreferrer">Add to calendar ↗</a> : null}
          <button type="button" className="btn" disabled={pending} onClick={() => run(async () => { await markActionDone(j.id); reload(); }, "Marked done")}>Mark done</button>
        </div>
      ) : null}
      {j.interviewAt && (j.status === "interviewing" || j.status === "offer") ? (
        <div className="action-box">
          <span>{new Date(j.interviewAt) < new Date() ? "Interviewed " : "Interview: "}{when(j.interviewAt)}</span>
          {j.prep?.text ? <button type="button" className="btn" onClick={openPrep}>Open prep</button> : null}
        </div>
      ) : null}
      <div className="field wide">
        <span className="lab">Email history</span>
        {j.events.length ? (
          <ul className="timeline">
            {j.events.map((e) => (
              <li key={e.id}>
                <span className="when">{fmtDate(e.date)}</span>
                <div className="what">
                  <div className="mail-last"><span className={"kind k-" + (e.kind in KINDS ? e.kind : "update")}>{kindLabel(e.kind)}</span>{e.summary}</div>
                  {safeUrl(e.link) ? <a className="gm-link" href={safeUrl(e.link)!} target="_blank" rel="noopener noreferrer">Open in Gmail ↗</a> : null}
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="meta-row">No emails about this job yet.</p>}
      </div>
      <div className="field wide">
        <label htmlFor={"nt-" + j.id}>Notes</label>
        <textarea id={"nt-" + j.id} value={notes} placeholder="Recruiter name, interview dates, questions to ask…" onChange={(e) => setNotes(e.target.value)}
          onBlur={() => { if (notes !== (j.notes ?? "")) run(() => saveText(j.id, "notes", notes), "Notes saved"); }} />
      </div>
      <div className="detail-grid">
        <div className="field">
          <label htmlFor={"ap-" + j.id}>Applied on</label>
          <input id={"ap-" + j.id} type="date" defaultValue={j.appliedAt ?? ""} onChange={(e) => run(async () => { await saveDate(j.id, "appliedAt", e.target.value || null); reload(); }, "Saved")} />
        </div>
        <div className="field">
          <label htmlFor={"fu-" + j.id}>Follow up on</label>
          <input id={"fu-" + j.id} type="date" defaultValue={j.followUpAt ?? ""} onChange={(e) => run(async () => { await saveDate(j.id, "followUpAt", e.target.value || null); reload(); }, "Follow-up saved")} />
        </div>
        <div className="field">
          <label htmlFor={"fit-" + j.id}>Fit (1–5)</label>
          <select id={"fit-" + j.id} defaultValue={String(j.fit)} onChange={(e) => run(async () => { await setFit(j.id, Number(e.target.value)); reload(); }, "Fit saved")}>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>
      <div className="detail-actions">
        <button type="button" className="btn quiet danger" disabled={pending} onClick={() => {
          if (!confirm) { setConfirm(true); setTimeout(() => setConfirm(false), 3500); return; }
          run(async () => { await archiveJob(j.id); onArchived(); }, "Removed. It won't be suggested again.");
        }}>{confirm ? "Click again to remove" : "Remove from list"}</button>
      </div>
    </>
  );
}

function Apply({ j, answers, copy, run }: { j: JobDetail; answers: Record<string, string>; copy: (t: string | null | undefined, ok: string) => void; run: Run }) {
  const [letter, setLetter] = useState(j.coverLetter ?? "");
  return (
    <>
      <div className="kit">
        <h3>Resume</h3>
        <div className="row-btns">
          {safeUrl(j.resumeUrl) ? <a className="btn primary" href={safeUrl(j.resumeUrl)!} target="_blank" rel="noopener noreferrer">Open {j.resumeName ?? "best-fit"} resume ↗</a> : <span className="meta-row">No resume picked yet for this job.</span>}
          <button type="button" className="btn" onClick={() => { const t = answersText(answers); if (!t) copy("", ""); else copy(t, "Screening answers copied"); }}>Copy my screening answers</button>
        </div>
        {j.kitTips.length ? (<><span className="meta-row">Lead with:</span><ul>{j.kitTips.map((t) => <li key={t}>{t}</li>)}</ul></>) : null}
      </div>
      <div className="field wide">
        <label htmlFor={"cl-" + j.id}>Cover letter</label>
        <textarea className="cl" id={"cl-" + j.id} value={letter} placeholder="No cover letter yet for this job." onChange={(e) => setLetter(e.target.value)}
          onBlur={() => { if (letter !== (j.coverLetter ?? "")) run(() => saveText(j.id, "coverLetter", letter), "Cover letter saved"); }} />
        <div className="detail-actions"><button type="button" className="btn primary" onClick={() => copy(letter, "Cover letter copied")}>Copy cover letter</button></div>
      </div>
    </>
  );
}

function PrepTab({ j, copy }: { j: JobDetail; copy: (t: string | null | undefined, ok: string) => void }) {
  const cal = j.interviewAt ? gcalLink(`Interview: ${j.company} · ${j.title}`, "Prep notes are in Scoutline.", { start: j.interviewAt, end: j.interviewEnd }) : null;
  return (
    <>
      <p className="meta-row">{[j.interviewAt && "Interview " + when(j.interviewAt), j.prep?.createdAt && "written " + fmtDate(j.prep.createdAt)].filter(Boolean).join(" · ")}</p>
      <div className="row-btns">
        <button type="button" className="btn" onClick={() => copy(j.prep?.text, "Prep notes copied")}>Copy prep notes</button>
        {cal ? <a className="btn" href={cal} target="_blank" rel="noopener noreferrer">Add interview to calendar ↗</a> : null}
        {safeUrl(j.thankYou?.draftUrl) ? <a className="btn primary" href={safeUrl(j.thankYou?.draftUrl)!} target="_blank" rel="noopener noreferrer">Open thank-you draft in Gmail ↗</a> : null}
      </div>
      <pre className="doc-text">{j.prep?.text}</pre>
    </>
  );
}

function Posting({ j, copy }: { j: JobDetail; copy: (t: string | null | undefined, ok: string) => void }) {
  return (
    <>
      <div className="row-btns">
        {safeUrl(j.url) ? <a className="btn primary" href={safeUrl(j.url)!} target="_blank" rel="noopener noreferrer">Open posting ↗</a> : null}
        {j.description ? <button type="button" className="btn" onClick={() => copy(j.description, "Description copied")}>Copy description</button> : null}
      </div>
      {j.description ? (
        <>
          <p className="meta-row">Saved copy of the posting{j.descriptionSavedAt ? ", " + fmtDate(j.descriptionSavedAt) : ""}. It stays here even if the listing comes down.</p>
          <pre className="doc-text">{j.description}</pre>
        </>
      ) : j.descriptionUnavailable ? (
        <p className="meta-row">The posting was already gone when it was checked, so there&apos;s no saved copy.</p>
      ) : (
        <p className="meta-row">{safeUrl(j.url) ? "No saved copy yet. Use Open posting." : "No posting link for this job yet."}</p>
      )}
    </>
  );
}
