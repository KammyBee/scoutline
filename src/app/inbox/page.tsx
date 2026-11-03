import { connection } from "next/server";
import { Suspense } from "react";
import { Header } from "@/components/Header";
import { InboxView } from "@/components/InboxView";
import { getInbox } from "@/lib/inbox";

export const metadata = { title: "Inbox · Scoutline" };
export const maxDuration = 300;

async function Loader({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  await connection();
  const [data, sp] = await Promise.all([getInbox(), searchParams]);
  return <InboxView data={data} connected={sp.connected ?? null} error={sp.error ?? null} />;
}

export default function InboxPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  return (
    <div className="wrap">
      <Header current="inbox" />
      <Suspense fallback={<div className="panel empty skeleton"><h2>Loading your inbox</h2><p>Job emails, follow-ups and anything that needs a job picked.</p></div>}>
        <Loader searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
