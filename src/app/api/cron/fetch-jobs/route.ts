import { getDb } from "@/db/client";
import { runFeeds } from "@/lib/feeds/ingest";

// Vercel Cron calls this once a day (see vercel.json) with "Authorization: Bearer <CRON_SECRET>".
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = await getDb();
  const summary = await runFeeds(db, { trigger: "cron" });
  return Response.json({ ok: true, ...summary, newJobs: summary.newJobs.length });
}
