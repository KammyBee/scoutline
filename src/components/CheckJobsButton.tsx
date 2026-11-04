"use client";

import { useState, useTransition } from "react";
import { checkForJobs } from "@/app/actions";

export type LastRunInfo = { finishedAt: string | null; added: number; companiesChecked: number; failed: number; trigger: string } | null;

function ago(iso: string): string {
  const d = new Date(iso);
  if (isNaN(+d)) return "";
  const today = new Date().toDateString() === d.toDateString();
  return (today ? "today " : d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + ", ") + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function CheckJobsButton({ last, watching }: { last: LastRunInfo; watching: number }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const line = last?.finishedAt
    ? `Last check ${ago(last.finishedAt)} · ${last.added} new${last.failed ? ` · ${last.failed} board${last.failed === 1 ? "" : "s"} failed` : ""}`
    : watching
      ? "Not checked yet"
      : "No companies on your watch list yet";
  return (
    <div className="check-jobs">
      <span className="scout-line"><span className="dot-live" aria-hidden="true" />{msg ?? line}</span>
      <button
        type="button"
        className="btn"
        disabled={pending || !watching}
        onClick={() =>
          start(async () => {
            setMsg(`Checking ${watching} job boards…`);
            try {
              const r = await checkForJobs();
              setMsg(
                `Checked ${r.companiesChecked} boards · ${r.added} new job${r.added === 1 ? "" : "s"}` +
                  (r.switchedOff.length ? ` · switched off ${r.switchedOff.length} board${r.switchedOff.length === 1 ? "" : "s"} that don't exist` : r.failed ? ` · ${r.failed} failed` : "") +
                  (r.claudeScored ? ` · Claude scored ${r.claudeScored}` : "") +
                  (r.lettersDrafted ? ` · ${r.lettersDrafted} cover letter${r.lettersDrafted === 1 ? "" : "s"} drafted` : "") +
                  (r.claudeNote ? ` · ${/letters/.test(r.claudeNote) ? "cover letters stopped early" : "Claude scoring skipped"}` : ""),
              );
            } catch {
              setMsg("The check didn't finish. Try again in a moment.");
            }
          })
        }
      >
        {pending ? "Checking…" : "Check for new jobs"}
      </button>
    </div>
  );
}
