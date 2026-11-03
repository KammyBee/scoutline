import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { eq } from "drizzle-orm";
import { logout } from "@/app/login/actions";
import { getDb, schema } from "@/db/client";
import { lastRun } from "@/lib/feeds/ingest";
import { CheckJobsButton } from "./CheckJobsButton";

async function FeedStatus() {
  await connection();
  const db = await getDb();
  const [run, active] = await Promise.all([lastRun(db), db.select({ id: schema.companies.id }).from(schema.companies).where(eq(schema.companies.active, true))]);
  const last = run ? { finishedAt: run.finishedAt, added: run.added, companiesChecked: run.companiesChecked, failed: run.failed, trigger: run.trigger } : null;
  return <CheckJobsButton last={last} watching={active.length} />;
}

export function Header({ current }: { current: "pipeline" | "inbox" | "companies" | "stats" }) {
  return (
    <header className="head">
      <div>
        <p className="eyebrow">Job search · ERP, SAP &amp; business systems · Bay Area + remote</p>
        <h1>Scoutline</h1>
        <nav className="nav" aria-label="Sections">
          <Link href="/" aria-current={current === "pipeline" ? "page" : undefined}>Pipeline</Link>
          <Link href="/inbox" aria-current={current === "inbox" ? "page" : undefined}>Inbox</Link>
          <Link href="/companies" aria-current={current === "companies" ? "page" : undefined}>Watch list</Link>
          <Link href="/stats" aria-current={current === "stats" ? "page" : undefined}>Stats</Link>
        </nav>
      </div>
      <div className="head-actions">
        <Suspense fallback={<span className="scout-line">Loading…</span>}>
          <FeedStatus />
        </Suspense>
        <form action={logout}>
          <button type="submit" className="linkish">Sign out</button>
        </form>
      </div>
    </header>
  );
}
