import { htmlToText, isoDay } from "./text";
import type { Ats, BoardResult, FeedJob, Fetcher } from "./types";

const UA = { "User-Agent": "Scoutline (personal job search; github.com/KammyBee/scoutline)", Accept: "application/json" };
const TIMEOUT_MS = 20000;

type Obj = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);

async function getJson(fetcher: Fetcher, url: string): Promise<{ ok: true; data: unknown } | { ok: false; status: "not_found" | "error"; error: string }> {
  try {
    const res = await fetcher(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: UA });
    if (res.status === 404) return { ok: false, status: "not_found", error: "Board not found (404)" };
    if (!res.ok) return { ok: false, status: "error", error: `HTTP ${res.status}` };
    return { ok: true, data: await res.json() };
  } catch (e) {
    return { ok: false, status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

function workplaceFrom(v: unknown): FeedJob["workplace"] {
  const s = str(v).toLowerCase().replace(/[^a-z]/g, "");
  if (s === "remote") return "remote";
  if (s === "hybrid") return "hybrid";
  if (s === "onsite" || s === "inoffice" || s === "office") return "onsite";
  return null;
}

// ---------- Greenhouse: https://boards-api.greenhouse.io/v1/boards/{token}/jobs ----------
export function parseGreenhouseList(board: string, data: unknown): FeedJob[] {
  return arr(obj(data).jobs).map((raw) => {
    const j = obj(raw);
    return {
      ats: "greenhouse" as const,
      board,
      externalId: str(j.id),
      title: str(j.title).trim(),
      location: str(obj(j.location).name).trim(),
      workplace: null,
      country: null,
      url: str(j.absolute_url),
      posted: isoDay(j.first_published) ?? isoDay(j.updated_at),
      description: j.content ? htmlToText(str(j.content)) : null,
      employmentType: null,
      payMin: null,
      payMax: null,
      payText: null,
    };
  }).filter((j) => j.externalId && j.title);
}

// ---------- Lever: https://api.lever.co/v0/postings/{site}?mode=json ----------
export function parseLeverList(board: string, data: unknown): FeedJob[] {
  return arr(data).map((raw) => {
    const j = obj(raw);
    const cat = obj(j.categories);
    const lists = arr(j.lists).map((l) => `${str(obj(l).text)}\n${htmlToText(str(obj(l).content), 3000)}`).join("\n\n");
    const desc = [str(j.descriptionPlain).trim(), lists.trim(), str(j.additionalPlain).trim()].filter(Boolean).join("\n\n");
    const sal = obj(j.salaryRange);
    const yearly = !sal.interval || /year|annual/i.test(str(sal.interval));
    return {
      ats: "lever" as const,
      board,
      externalId: str(j.id),
      title: str(j.text).trim(),
      location: str(cat.location).trim() || arr(cat.allLocations).map(str).join("; "),
      workplace: workplaceFrom(j.workplaceType),
      country: str(j.country) || null,
      url: str(j.hostedUrl),
      posted: isoDay(j.createdAt),
      description: desc ? htmlToText(desc) : null,
      employmentType: str(cat.commitment) || null,
      payMin: yearly ? num(sal.min) : null,
      payMax: yearly ? num(sal.max) : null,
      payText: !yearly && sal.min ? `$${sal.min}–$${sal.max ?? sal.min} ${str(sal.interval)}` : null,
    };
  }).filter((j) => j.externalId && j.title);
}

// ---------- Ashby: https://api.ashbyhq.com/posting-api/job-board/{name}?includeCompensation=true ----------
export function parseAshbyList(board: string, data: unknown): FeedJob[] {
  return arr(obj(data).jobs)
    .map((raw) => obj(raw))
    .filter((j) => j.isListed !== false)
    .map((j) => {
      const addr = obj(obj(j.address).postalAddress);
      const locs = [str(j.location), ...arr(j.secondaryLocations).map((s) => str(obj(s).location))].filter(Boolean);
      const comp = obj(j.compensation);
      const summary = str(comp.compensationTierSummary) || str(comp.scrapeableCompensationSalarySummary);
      const range = parseMoneyRange(summary);
      return {
        ats: "ashby" as const,
        board,
        externalId: str(j.id),
        title: str(j.title).trim(),
        location: locs.join("; "),
        workplace: workplaceFrom(j.workplaceType) ?? (j.isRemote === true ? "remote" : null),
        country: str(addr.addressCountry) || null,
        url: str(j.jobUrl),
        posted: isoDay(j.publishedAt),
        description: str(j.descriptionPlain).trim() ? htmlToText(str(j.descriptionPlain)) : j.descriptionHtml ? htmlToText(str(j.descriptionHtml)) : null,
        employmentType: str(j.employmentType).replace(/([a-z])([A-Z])/g, "$1-$2") || null,
        payMin: range?.min ?? null,
        payMax: range?.max ?? null,
        payText: range ? null : summary || null,
      };
    })
    .filter((j) => j.externalId && j.title);
}

/** "$120K – $150K" or "$120,000 - $150,000" → yearly numbers; null for hourly or unparseable. */
export function parseMoneyRange(s: string): { min: number; max: number } | null {
  if (!s || /hour|hr\b/i.test(s)) return null;
  const vals = [...s.matchAll(/\$\s*([\d,.]+)\s*([kK])?/g)].map((m) => Number(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1)).filter((n) => n >= 10000);
  if (!vals.length) return null;
  return { min: Math.min(...vals), max: Math.max(...vals) };
}

export function boardApiUrl(ats: Ats, board: string): string {
  const b = encodeURIComponent(board);
  if (ats === "greenhouse") return `https://boards-api.greenhouse.io/v1/boards/${b}/jobs`;
  if (ats === "lever") return `https://api.lever.co/v0/postings/${b}?mode=json`;
  return `https://api.ashbyhq.com/posting-api/job-board/${b}?includeCompensation=true`;
}

export function boardPublicUrl(ats: Ats, board: string): string {
  if (ats === "greenhouse") return `https://job-boards.greenhouse.io/${board}`;
  if (ats === "lever") return `https://jobs.lever.co/${board}`;
  return `https://jobs.ashbyhq.com/${board}`;
}

/** Reads every open job on one company's board. */
export async function fetchBoard(fetcher: Fetcher, ats: Ats, board: string): Promise<BoardResult> {
  const r = await getJson(fetcher, boardApiUrl(ats, board));
  if (!r.ok) return r;
  try {
    const jobs = ats === "greenhouse" ? parseGreenhouseList(board, r.data) : ats === "lever" ? parseLeverList(board, r.data) : parseAshbyList(board, r.data);
    if (ats === "lever" && !Array.isArray(r.data)) return { ok: false, status: "error", error: "Unexpected response from Lever" };
    if (ats !== "lever" && !Array.isArray(obj(r.data).jobs)) return { ok: false, status: "error", error: "Unexpected response" };
    return { ok: true, jobs };
  } catch (e) {
    return { ok: false, status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

/** Greenhouse lists don't include descriptions; this reads one job's full posting. */
export async function fetchGreenhouseDescription(fetcher: Fetcher, board: string, id: string): Promise<string | null> {
  const r = await getJson(fetcher, `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs/${encodeURIComponent(id)}`);
  if (!r.ok) return null;
  const text = htmlToText(str(obj(r.data).content));
  return text || null;
}

/** Works out the job board from a careers page or job link someone pastes in. */
export function parseBoardUrl(input: string): { ats: Ats; board: string } | null {
  let u: URL;
  try {
    u = new URL(input.trim().startsWith("http") ? input.trim() : "https://" + input.trim());
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  const seg = u.pathname.split("/").filter(Boolean);
  const clean = (s: string | undefined | null) => (s ? decodeURIComponent(s).trim() : "");
  if (/(^|\.)greenhouse\.io$/.test(host)) {
    const forParam = u.searchParams.get("for");
    if (forParam) return { ats: "greenhouse", board: clean(forParam) };
    if (host.startsWith("boards-api.") && seg[0] === "v1" && seg[1] === "boards" && seg[2]) return { ats: "greenhouse", board: clean(seg[2]) };
    if (seg[0] && seg[0] !== "embed") return { ats: "greenhouse", board: clean(seg[0]) };
    return null;
  }
  if (host === "jobs.lever.co" || host === "jobs.eu.lever.co") return seg[0] ? { ats: "lever", board: clean(seg[0]) } : null;
  if (host === "api.lever.co" && seg[0] === "v0" && seg[1] === "postings" && seg[2]) return { ats: "lever", board: clean(seg[2]) };
  if (host === "jobs.ashbyhq.com") return seg[0] ? { ats: "ashby", board: clean(seg[0]) } : null;
  if (host === "api.ashbyhq.com" && seg[2] === "job-board" && seg[3]) return { ats: "ashby", board: clean(seg[3]) };
  return null;
}
