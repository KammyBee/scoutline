"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { addCompany, addSmallerCompanies, addStarterList, checkCompany, removeCompany, setCompanyActive, type AddState } from "@/app/companies/actions";
import { boardPublicUrl } from "@/lib/feeds/boards";
import { ATS_LABEL, ATS_LIST, type Ats } from "@/lib/feeds/types";
import type { CompanyRow } from "@/lib/companies";
import { Toast, useToast } from "./Toast";

function when(iso: string | null) {
  if (!iso) return "Never";
  const d = new Date(iso);
  return isNaN(+d) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + ", " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function CompanyList({ companies, missingStarter, missingSmaller }: { companies: CompanyRow[]; missingStarter: number; missingSmaller: number }) {
  const [state, action, adding] = useActionState<AddState, FormData>(addCompany, {});
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<number | null>(null);
  const [filter, setFilter] = useState<"all" | "problems" | "off">("all");
  const toast = useToast();

  const shown = useMemo(
    () =>
      companies
        .filter((c) => (filter === "problems" ? c.lastStatus && c.lastStatus !== "ok" : filter === "off" ? !c.active : true))
        // working boards first, then ones not checked yet, then problems, then switched off
        .sort((a, b) => {
          const rank = (c: CompanyRow) => (!c.active ? 3 : c.lastStatus === "ok" ? 0 : !c.lastStatus ? 1 : 2);
          return rank(a) - rank(b) || a.name.localeCompare(b.name);
        }),
    [companies, filter],
  );
  const problems = companies.filter((c) => c.lastStatus && c.lastStatus !== "ok").length;
  const off = companies.filter((c) => !c.active).length;
  const run = (id: number | null, fn: () => Promise<void>) => { setBusy(id); start(async () => { try { await fn(); } catch { toast.show("That didn't work. Try again in a moment."); } finally { setBusy(null); } }); };

  return (
    <div className="main companies">
      <section className="list">
        <div className="panel">
          <div className="res-head">
            <span>
              {companies.length} compan{companies.length === 1 ? "y" : "ies"} on your watch list · {companies.length - off} active. Every active board is checked once a day and whenever you press &ldquo;Check for new jobs&rdquo;.
            </span>
            <span className="tabs" role="tablist" aria-label="Filter companies">
              <button type="button" role="tab" className="tab" aria-selected={filter === "all"} onClick={() => setFilter("all")}>All<span className="c">{companies.length}</span></button>
              <button type="button" role="tab" className="tab" aria-selected={filter === "problems"} onClick={() => setFilter("problems")}>Problems<span className="c">{problems}</span></button>
              <button type="button" role="tab" className="tab" aria-selected={filter === "off"} onClick={() => setFilter("off")}>Switched off<span className="c">{off}</span></button>
            </span>
          </div>
          {companies.length === 0 ? (
            <div className="empty">
              <h2>Your watch list is empty</h2>
              <p>Start with {missingStarter} Bay Area and remote-friendly employers that hire business systems, ERP, integration and R&amp;D software people. The first check tests each job board and switches off any that don&apos;t exist.</p>
              <button type="button" className="btn primary" disabled={pending} onClick={() => run(null, async () => { const n = await addStarterList(); toast.show(`Added ${n} companies. Press "Check for new jobs" to bring in their openings.`); })}>Add the starter list</button>
            </div>
          ) : (
            <table className="ctable">
              <thead>
                <tr><th>Company</th><th>Job board</th><th>Last check</th><th className="r">Actions</th></tr>
              </thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={c.id} className={c.active ? "" : "off"}>
                    <td><b>{c.name}</b>{c.category ? <span className="sub">{c.category}</span> : null}</td>
                    <td>
                      {c.ats && c.board ? <a href={boardPublicUrl(c.ats as Ats, c.board)} target="_blank" rel="noopener noreferrer">{ATS_LABEL[c.ats as Ats]} · {c.board} ↗</a> : "—"}
                    </td>
                    <td>
                      {c.lastStatus === "ok" ? <span className="ok">{c.lastJobCount ?? 0} open · {c.lastMatchCount ?? 0} match</span> : c.lastStatus ? <span className="bad">{c.lastError ?? "Problem"}</span> : <span className="sub">Not checked yet</span>}
                      <span className="sub">{when(c.lastCheckedAt)}</span>
                    </td>
                    <td className="r">
                      <span className="row-btns">
                        <button type="button" className="btn" disabled={pending} onClick={() => run(c.id, async () => { const r = await checkCompany(c.id); toast.show(r.error ? `${c.name}: ${r.error}` : `${c.name}: ${r.added} new job${r.added === 1 ? "" : "s"} added`); })}>{busy === c.id ? "Checking…" : "Check now"}</button>
                        <button type="button" className="btn quiet" disabled={pending} onClick={() => run(c.id, () => setCompanyActive(c.id, !c.active))}>{c.active ? "Switch off" : "Switch on"}</button>
                        <button type="button" className="btn quiet danger" disabled={pending} onClick={() => run(c.id, () => removeCompany(c.id))}>Remove</button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
      <aside className="aside">
        <div className="panel">
          <h2 className="panel-title">Add a company</h2>
          <p>Paste a link to the company&apos;s job board or any of its job postings on Greenhouse, Lever, Ashby, SmartRecruiters, Workable or Workday. It&apos;s checked before it&apos;s added.</p>
          <form action={action} className="add-form">
            <input name="name" placeholder="Company name" aria-label="Company name" required />
            <input name="link" placeholder="e.g. https://jobs.lever.co/zoox" aria-label="Job board link" />
            <details>
              <summary>No link? Enter the board name</summary>
              <div className="row">
                <select name="ats" aria-label="Job board system" defaultValue="greenhouse">
                  {ATS_LIST.map((a) => <option key={a} value={a}>{ATS_LABEL[a]}</option>)}
                </select>
                <input name="board" placeholder="board name" aria-label="Board name" />
              </div>
            </details>
            {state.error ? <p className="err" role="alert">{state.error}</p> : null}
            {state.ok ? <p className="okmsg" role="status">{state.ok}</p> : null}
            <button className="btn primary" type="submit" disabled={adding}>{adding ? "Checking the board…" : "Add to watch list"}</button>
          </form>
        </div>
        {companies.length > 0 && missingSmaller > 0 ? (
          <div className="panel">
            <h2 className="panel-title">Smaller companies</h2>
            <p>{missingSmaller} smaller and mid-size companies aren&apos;t on your watch list yet: Bay Area and remote-friendly manufacturers, plus companies that make ERP, manufacturing, integration and procurement software.</p>
            <button type="button" className="btn" disabled={pending} onClick={() => run(null, async () => { const n = await addSmallerCompanies(); toast.show(`Added ${n} companies. Press "Check for new jobs" to bring in their openings.`); })}>Add them</button>
          </div>
        ) : null}
        {companies.length > 0 && missingStarter > missingSmaller ? (
          <div className="panel">
            <h2 className="panel-title">Starter list</h2>
            <p>{missingStarter - missingSmaller} other companies from the starter list aren&apos;t on your watch list.</p>
            <button type="button" className="btn" disabled={pending} onClick={() => run(null, async () => { const n = await addStarterList(); toast.show(`Added ${n} companies.`); })}>Add them</button>
          </div>
        ) : null}
        <div className="panel">
          <h2 className="panel-title">What gets added</h2>
          <p>Jobs posted in the last 30 days, remote in the US or in the Bay Area, whose titles fit your work: ERP and business systems first, then application, integration, BI and .NET roles, then general software roles. Senior, lead and manager roles are skipped, and anything already in your pipeline is never added twice.</p>
        </div>
      </aside>
      <Toast state={toast.state} />
    </div>
  );
}
