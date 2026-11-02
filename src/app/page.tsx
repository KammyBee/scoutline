import { connection } from "next/server";
import { Suspense } from "react";
import { Header } from "@/components/Header";
import { Pipeline } from "@/components/Pipeline";
import { getPipeline } from "@/lib/queries";

// "Check for new jobs" reads every watched board, which can take a minute.
export const maxDuration = 300;

async function PipelineLoader() {
  await connection(); // always read fresh data at request time
  const data = await getPipeline();
  return <Pipeline data={data} />;
}

export default function Home() {
  return (
    <div className="wrap">
      <Header current="pipeline" />
      <Suspense fallback={<div className="panel empty skeleton"><h2>Loading your jobs</h2><p>Your roles and application statuses appear here.</p></div>}>
        <PipelineLoader />
      </Suspense>
    </div>
  );
}
