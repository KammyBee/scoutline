import { getDb } from "@/db/client";
import { applyFollowUpRules } from "@/lib/followups";
import { canRead, getAccount } from "@/lib/google/account";
import { syncGmail } from "@/lib/gmail/sync";

// Vercel Cron calls this (see vercel.json) with "Authorization: Bearer <CRON_SECRET>".
// Reads new job mail if Gmail is connected, then runs the follow-up and no-response rules either way.
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = await getDb();
  if (canRead(await getAccount(db))) {
    try {
      return Response.json({ ok: true, ...(await syncGmail(db)) });
    } catch (e) {
      const plan = await applyFollowUpRules(db);
      return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e), markedNoResponse: plan.markNoResponse.length }, { status: 500 });
    }
  }
  const plan = await applyFollowUpRules(db);
  return Response.json({ ok: true, gmail: "not connected", markedNoResponse: plan.markNoResponse.length, due: plan.due.length });
}
