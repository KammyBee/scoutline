import { and, eq, gte, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { todayIn } from "../dates";

type Db = NodePgDatabase<typeof schema>;

/** A lighter model for scoring lists of jobs; a stronger one for writing. Override with env vars. */
export const SCORE_MODEL = () => process.env.CLAUDE_SCORE_MODEL || "claude-haiku-5-5";
export const WRITE_MODEL = () => process.env.CLAUDE_WRITE_MODEL || "claude-sonnet-5-5";

/**
 * USD per million tokens (input, output), as published in October 2026. Used only for the estimate on
 * the Stats page; your Anthropic console shows the real bill. Update if prices change.
 */
const PRICES: Record<string, [number, number]> = {
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-sonnet-5-5": [2, 10],
  "claude-opus-5-5": [4, 20],
};

export function estimateCost(model: string, input: number, output: number): number {
  let [pin, pout] = PRICES[model] ?? [2, 10];
  if (model === "claude-haiku-5-5" && input > 100_000) [pin, pout] = [0.5, 2.5];
  return (input * pin + output * pout) / 1_000_000;
}

export const dailyLimit = () => Math.max(0, Number(process.env.CLAUDE_DAILY_LIMIT ?? 60) || 0);

export class AiUnavailable extends Error {
  constructor(public reason: "no_key" | "daily_limit", message: string) {
    super(message);
  }
}

type CreateParams = { model: string; max_tokens: number; system?: string; messages: { role: "user" | "assistant"; content: string }[] };
type CreateResult = { content: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
export type ClaudeLike = { messages: { create: (p: CreateParams) => Promise<CreateResult> } };

let override: ClaudeLike | null = null;
/** Tests swap in a fake client here. */
export function setClaudeForTests(c: ClaudeLike | null) {
  override = c;
}

export function aiConfigured(): boolean {
  return !!override || !!process.env.ANTHROPIC_API_KEY;
}

async function client(): Promise<ClaudeLike> {
  if (override) return override;
  if (!process.env.ANTHROPIC_API_KEY) throw new AiUnavailable("no_key", "Add ANTHROPIC_API_KEY to your environment to use Claude features.");
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) as unknown as ClaudeLike;
}

export async function callsToday(db: Db): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)` }).from(schema.aiCalls).where(eq(schema.aiCalls.day, todayIn()));
  return Number(r?.n ?? 0);
}

/**
 * Sends one prompt to Claude and logs it. Refuses once today's call count reaches CLAUDE_DAILY_LIMIT
 * (default 60), so a bug or a busy day can't run up a bill.
 */
export async function askClaude(
  db: Db,
  opts: { purpose: "score" | "cover_letter" | "answer"; model: string; prompt: string; system?: string; maxTokens: number; postingId?: string },
): Promise<string> {
  const c = await client();
  const limit = dailyLimit();
  if ((await callsToday(db)) >= limit) throw new AiUnavailable("daily_limit", `Today's Claude limit (${limit} calls) is used up. It resets tomorrow, or raise CLAUDE_DAILY_LIMIT.`);
  const day = todayIn();
  try {
    const res = await c.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens,
      ...(opts.system ? { system: opts.system } : {}),
      messages: [{ role: "user", content: opts.prompt }],
    });
    const text = res.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
    const input = res.usage?.input_tokens ?? 0;
    const output = res.usage?.output_tokens ?? 0;
    await db.insert(schema.aiCalls).values({ day, purpose: opts.purpose, model: opts.model, postingId: opts.postingId, inputTokens: input, outputTokens: output, costUsd: estimateCost(opts.model, input, output) });
    if (!text) throw new Error("Claude returned an empty answer");
    return text;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!(e instanceof AiUnavailable)) {
      await db.insert(schema.aiCalls).values({ day, purpose: opts.purpose, model: opts.model, postingId: opts.postingId, ok: false, error: msg.slice(0, 500) });
    }
    throw e;
  }
}

/** Month-to-date usage for the Stats page. */
export async function usageThisMonth(db: Db) {
  const first = todayIn().slice(0, 8) + "01";
  const rows = await db
    .select({ purpose: schema.aiCalls.purpose, calls: sql<number>`count(*)`, cost: sql<number>`coalesce(sum(${schema.aiCalls.costUsd}), 0)`, failed: sql<number>`sum(case when ${schema.aiCalls.ok} then 0 else 1 end)` })
    .from(schema.aiCalls)
    .where(and(gte(schema.aiCalls.day, first)))
    .groupBy(schema.aiCalls.purpose);
  return rows.map((r) => ({ purpose: r.purpose, calls: Number(r.calls), cost: Number(r.cost), failed: Number(r.failed) }));
}

/** Pulls the first JSON array out of a reply, tolerating a sentence or code fence around it. */
export function extractJsonArray(text: string): unknown[] {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const start = body.indexOf("["), end = body.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("No JSON list in Claude's answer");
  const v = JSON.parse(body.slice(start, end + 1));
  if (!Array.isArray(v)) throw new Error("Claude's answer wasn't a list");
  return v;
}
