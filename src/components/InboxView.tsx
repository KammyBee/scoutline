"use client";

import { useState, useTransition } from "react";
import { attachEmail, createFollowUpDraft, disconnectGmail, ignoreEmail, markFollowedUp, snooze, syncNow } from "@/app/inbox/actions";
import { fmtDate } from "@/lib/dates";
import { KINDS, kindLabel, safeUrl } from "@/lib/jobView";
import type { DueRow, GmailStatus, InboxData, JobOption, MailRow } from "@/lib/inbox";
import { Toast, useToast } from "./Toast";

function when(iso: string | null) {
  if (!iso) return "never";
  const d = new Date(iso);
  return isNaN(+d) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + ", " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

const CONNECTED: Record<string, string> = { connect: "Gmail connected (read-only).", signin: "Signed in with Google.", drafts: "Drafts turned on. Scoutline can save drafts, never send." };
const ERRORS: Record<string, string> = {
  wrong_account: "That Google account isn't the one set in GOOGLE_ALLOWED_EMAIL.",
  denied: "Google access was cancelled.",
  state: "The Google link expired. Try again.",
  unverified: "Google says that email address isn't verified.",
  google_error: "Google didn't connect. Try again in a moment.",
  scope_read: "Gmail wasn't connected: the \"Read your email\" box on Google's screen was left unticked. Connect again and tick it.",
  scope_drafts: "Drafts weren't turned on: the drafts box on Google's screen was left unticked. Try again and tick it.",
};

export function InboxView({ data, connected, error }: { data: InboxData; connected: string | null; error: string | null }) {
  const toast = useToast();
  const { gmail, due, unmatched, recent, jobs } = data;
  return (
    <div className="inbox">
      {connected && CONNECTED[connected] ? <p className="notice ok">{CONNECTED[connected]}</p> : null}
      {error ? <p className="notice bad">{ERRORS[error] ?? ERRORS.google_error}</p> : null}
      <GmailCard g={gmail} toast={toast.show} />
      <section className="panel inbox-panel">
        <h2 className="panel-title">Follow-ups due <span className="count">{due.length}</span></h2>
        {due.length ? (
          <ul className="inbox-list">
            {due.map((d) => <DueItem key={d.postingId} d={d} canDraft={gmail.canDraft} toast={toast.show} />)}
          </ul>
        ) : (
          <p className="meta-row">Nothing to follow up on today. A follow-up comes due a week after you apply if you haven&apos;t heard back.</p>
        )}
      </section>
      {unmatched.length ? (
        <section className="panel inbox-panel">
          <h2 className="panel-title">Pick a job for these <span className="count">{unmatched.length}</span></h2>
          <p className="meta-row">Job emails Scoutline couldn&apos;t place. Choose the job they belong to, or hide them.</p>
          <ul className="inbox-list">
            {unmatched.map((m) => <UnmatchedItem key={m.id} m={m} jobs={jobs} toast={toast.show} />)}
          </ul>
        </section>
      ) : null}
      <section className="panel inbox-panel">
        <h2 className="panel-title">Recent job email</h2>
        {recent.length ? (
          <ul className="inbox-list">
            {recent.map((m) => (
              <li key={m.id} className="mail-row">
                <span className="when">{fmtDate(m.date)}</span>
                <span className={"kind k-" + (m.kind && m.kind in KINDS ? m.kind : "update")}>{kindLabel(m.kind ?? "update")}</span>
                <span className="mail-what">
                  <b>{m.company}</b> · {m.title}
                  <span className="meta-row"> {m.summary}</span>
                </span>
                {safeUrl(m.link) ? <a className="gm-link" href={safeUrl(m.link)!} target="_blank" rel="noopener noreferrer">Open in Gmail ↗</a> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="meta-row">{gmail.canRead ? "No job email filed yet. Press Sync now to read the last few weeks." : "Connect Gmail to see job email here."}</p>
        )}
      </section>
      <Toast state={toast.state} />
    </div>
  );
}

function GmailCard({ g, toast }: { g: GmailStatus; toast: (m: string) => void }) {
  const [pending, start] = useTransition();
  const [line, setLine] = useState<string | null>(null);
  const sync = () =>
    start(async () => {
      setLine("Reading Gmail…");
      try {
        const r = await syncNow();
        if (!r.ok) { setLine(r.error); return; }
        const s = r.value;
        setLine(`Read ${s.read} new message${s.read === 1 ? "" : "s"} · filed ${s.matched} · ${s.unmatched} need a job · ${s.statusChanges} status change${s.statusChanges === 1 ? "" : "s"}` + (s.markedNoResponse ? ` · ${s.markedNoResponse} marked No response` : "") + (s.more ? " · more left, sync again" : ""));
      } catch {
        setLine("The Gmail sync didn't finish. Try again in a moment.");
      }
    });
  if (!g.configured) {
    return (
      <section className="panel inbox-panel">
        <h2 className="panel-title">Gmail</h2>
        <p className="meta-row">Gmail tracking isn&apos;t set up. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_ALLOWED_EMAIL (see the README), then come back here. Follow-up rules still run without it.</p>
      </section>
    );
  }
  const needsReconnect = g.status === "reconnect" || (!!g.email && !g.canRead);
  return (
    <section className="panel inbox-panel gmail-card">
      <h2 className="panel-title">Gmail</h2>
      {g.canRead && !needsReconnect ? (
        <>
          <p className="meta-row">
            Connected as <b>{g.email}</b>, read-only{g.canDraft ? " plus drafts" : ""}. Last sync {when(g.lastSyncAt)}
            {g.summary && g.status === "ok" ? ` · ${g.summary.matched} filed, ${g.summary.unmatched} to place` : ""}.
          </p>
          {g.status === "error" && g.error ? <p className="err" role="alert">Last sync failed: {g.error}</p> : null}
          {line ? <p className="meta-row" role="status">{line}</p> : null}
          <div className="row-btns">
            <button type="button" className="btn primary" disabled={pending} onClick={sync}>{pending ? "Syncing…" : "Sync now"}</button>
            {!g.canDraft ? <a className="btn" href="/auth/google?purpose=drafts">Allow follow-up drafts</a> : null}
            <button type="button" className="btn quiet danger" disabled={pending} onClick={() => start(async () => { await disconnectGmail(); toast("Gmail disconnected"); })}>Disconnect</button>
          </div>
          <p className="meta-row small">Scoutline reads job email only, keeps a one-line summary (never the message), and never sends, replies, labels, archives or deletes anything.</p>
        </>
      ) : (
        <>
          <p className="meta-row">{needsReconnect ? "Google access expired or was removed. Connect again to keep syncing." : "Connect Gmail so applications, interviews and rejections update your jobs on their own."}</p>
          <div className="row-btns">
            <a className="btn primary" href="/auth/google?purpose=connect">{needsReconnect ? "Reconnect Gmail" : "Connect Gmail (read-only)"}</a>
          </div>
        </>
      )}
    </section>
  );
}

function DueItem({ d, canDraft, toast }: { d: DueRow; canDraft: boolean; toast: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(d.to);
  const [subject, setSubject] = useState(d.subject);
  const [body, setBody] = useState(d.body);
  const [draftUrl, setDraftUrl] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<void>, ok: string) => start(async () => { try { await fn(); toast(ok); } catch { toast("That didn't save. Try again in a moment."); } });
  const draft = () =>
    start(async () => {
      setErr("");
      try {
        const r = await createFollowUpDraft(to, subject, body);
        if (r.ok) { setDraftUrl(r.value); toast("Draft saved in Gmail"); } else setErr(r.error);
      } catch { setErr("Gmail didn't save the draft. Try again in a moment."); }
    });
  const copy = () => navigator.clipboard?.writeText(`Subject: ${subject}\n\n${body}`).then(() => toast("Follow-up copied"), () => toast("Select the text and copy it manually"));
  return (
    <li className="due-item">
      <div className="due-head">
        <span className="due-what"><b>{d.company}</b> · {d.title}<span className="meta-row"> {d.reason}{d.appliedAt ? ` · applied ${fmtDate(d.appliedAt)}` : ""}</span></span>
        <span className="row-btns">
          <button type="button" className="btn" onClick={() => setOpen(!open)}>{open ? "Close" : "Write follow-up"}</button>
          <button type="button" className="btn" disabled={pending} onClick={() => act(() => markFollowedUp(d.postingId), "Logged. Next check-in in a week.")}>I followed up</button>
          <button type="button" className="btn quiet" disabled={pending} onClick={() => act(() => snooze(d.postingId), "Snoozed for a week")}>Snooze a week</button>
        </span>
      </div>
      {open ? (
        <div className="due-draft">
          <div className="field"><label htmlFor={"to-" + d.postingId}>To</label><input id={"to-" + d.postingId} value={to} placeholder="recruiter@company.com (optional)" onChange={(e) => setTo(e.target.value)} /></div>
          <div className="field"><label htmlFor={"sj-" + d.postingId}>Subject</label><input id={"sj-" + d.postingId} value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
          <div className="field"><label htmlFor={"bd-" + d.postingId}>Message</label><textarea id={"bd-" + d.postingId} rows={7} value={body} onChange={(e) => setBody(e.target.value)} /></div>
          <div className="row-btns">
            {canDraft ? <button type="button" className="btn primary" disabled={pending} onClick={draft}>{pending ? "Saving…" : "Save as Gmail draft"}</button> : <a className="btn" href="/auth/google?purpose=drafts">Allow Gmail drafts</a>}
            <button type="button" className="btn" onClick={copy}>Copy</button>
            {draftUrl && safeUrl(draftUrl) ? <a className="btn" href={safeUrl(draftUrl)!} target="_blank" rel="noopener noreferrer">Open draft in Gmail ↗</a> : null}
          </div>
          {draftUrl ? <p className="meta-row">Saved to your Gmail drafts, not sent. Send it from Gmail when it reads right, then press I followed up.</p> : null}
          {err ? <p className="ai-err" role="alert">{err}</p> : null}
        </div>
      ) : null}
    </li>
  );
}

function UnmatchedItem({ m, jobs, toast }: { m: MailRow; jobs: JobOption[]; toast: (m: string) => void }) {
  const [pick, setPick] = useState("");
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<void>, ok: string) => start(async () => { try { await fn(); toast(ok); } catch { toast("That didn't save. Try again in a moment."); } });
  return (
    <li className="mail-row unmatched">
      <span className="when">{fmtDate(m.date)}</span>
      <span className={"kind k-" + (m.kind && m.kind in KINDS ? m.kind : "update")}>{kindLabel(m.kind ?? "update")}</span>
      <span className="mail-what">
        <b>{m.sender}</b>
        <span className="meta-row"> {m.subject}</span>
      </span>
      <span className="row-btns">
        <select className="select" aria-label="Job this email is about" value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">Pick a job…</option>
          {jobs.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}
        </select>
        <button type="button" className="btn" disabled={!pick || pending} onClick={() => act(() => attachEmail(m.id, pick), "Filed under that job")}>File it</button>
        <button type="button" className="btn quiet" disabled={pending} onClick={() => act(() => ignoreEmail(m.id), "Hidden")}>Not a job</button>
        {safeUrl(m.link) ? <a className="gm-link" href={safeUrl(m.link)!} target="_blank" rel="noopener noreferrer">Open ↗</a> : null}
      </span>
    </li>
  );
}
