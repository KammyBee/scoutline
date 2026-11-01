import { connection } from "next/server";
import { Suspense } from "react";
import { Pipeline } from "@/components/Pipeline";
import { getPipeline } from "@/lib/queries";
import { logout } from "./login/actions";

async function PipelineLoader() {
  await connection(); // always read fresh data at request time
  const data = await getPipeline();
  return <Pipeline data={data} />;
}

export default function Home() {
  return (
    <div className="wrap">
      <header className="head">
        <div>
          <p className="eyebrow">Job search · ERP, SAP &amp; business systems · Bay Area + remote</p>
          <h1>Scoutline</h1>
        </div>
        <div className="head-actions">
          <form action={logout}>
            <button type="submit" className="linkish">Sign out</button>
          </form>
        </div>
      </header>
      <Suspense fallback={<div className="panel empty skeleton"><h2>Loading your jobs</h2><p>Your roles and application statuses appear here.</p></div>}>
        <PipelineLoader />
      </Suspense>
    </div>
  );
}
