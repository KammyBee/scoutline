import { addDays, todayIn } from "../dates";
import { titleTier } from "./rules";
import { fetchSearch } from "./search";
import { isSearchSource } from "./types";
import { htmlToText, isoDay } from "./text";
import type { Ats, BoardResult, FeedJob, Fetcher } from "./types";

const UA = { "User-Agent": "Scoutline (personal job search; github.com/KammyBee/scoutline)", Accept: "application/json" };
const TIMEOUT_MS = 20000;

type Obj = Record<string, unknown>;
export const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
export const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);

export type JsonResult = { ok: true; data: unknown } | { ok: false; status: "not_found" | "error"; error: string };

export async function getJson(fetcher: Fetcher, url: string, post?: unknown, headers?: Record<string, string>): Promise<JsonResult> {
  try {
    const res = await fetcher(
      url,
      post === undefined
        ? { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { ...UA, ...headers } }
        : { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { ...UA, ...headers, "Content-Type": "application/json" }, method: "POST", body: JSON.stringify(post) },
    );
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

// ---------- SmartRecruiters: https://api.smartrecruiters.com/v1/companies/{id}/postings ----------
export function parseSmartRecruitersList(board: string, data: unknown): FeedJob[] {
  return arr(obj(data).content).map((raw) => {
    const j = obj(raw);
    const loc = obj(j.location);
    const country = str(loc.country).toUpperCase();
    const place = str(loc.fullLocation) || [str(loc.city), str(loc.region)].filter(Boolean).join(", ");
    return {
      ats: "smartrecruiters" as const,
      board,
      externalId: str(j.id),
      title: str(j.name).trim(),
      location: [place, loc.remote === true ? "Remote" : ""].filter(Boolean).join("; "),
      workplace: loc.remote === true ? ("remote" as const) : loc.hybrid === true ? ("hybrid" as const) : null,
      country: country || null,
      url: `https://jobs.smartrecruiters.com/${encodeURIComponent(board)}/${encodeURIComponent(str(j.id))}`,
      posted: isoDay(j.releasedDate),
      description: null,
      employmentType: str(obj(j.typeOfEmployment).label) || null,
      payMin: null,
      payMax: null,
      payText: null,
    };
  }).filter((j) => j.externalId && j.title);
}

// ---------- Workable: https://apply.workable.com/api/v1/widget/accounts/{subdomain}?details=true ----------
export function parseWorkableList(board: string, data: unknown): FeedJob[] {
  return arr(obj(data).jobs).map((raw) => {
    const j = obj(raw);
    const locs = arr(j.locations).map(obj);
    const first = locs[0] ?? {};
    const places = (locs.length ? locs : [j]).map((l) => [str(l.city), str(l.region ?? l.state)].filter(Boolean).join(", ")).filter(Boolean);
    const remote = j.telecommuting === true;
    const code = str(first.countryCode) || (/united states|^usa?$/i.test(str(j.country)) ? "US" : str(j.country));
    return {
      ats: "workable" as const,
      board,
      externalId: str(j.shortcode),
      title: str(j.title).trim(),
      location: [...places, remote ? "Remote" : ""].filter(Boolean).join("; "),
      workplace: remote ? ("remote" as const) : null,
      country: code || null,
      url: str(j.url) || str(j.shortlink) || `https://apply.workable.com/${encodeURIComponent(board)}/j/${encodeURIComponent(str(j.shortcode))}/`,
      posted: isoDay(j.published_on) ?? isoDay(j.created_at),
      description: j.description ? htmlToText(str(j.description)) : null,
      employmentType: str(j.employment_type) || null,
      payMin: null,
      payMax: null,
      payText: null,
    };
  }).filter((j) => j.externalId && j.title);
}

// ---------- Workday: POST https://{tenant}.{wdN}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs ----------
/** Workday boards are stored as "tenant.wdN/site", e.g. "acme.wd5/External". */
export function workdayParts(board: string): { tenant: string; wd: string; site: string; host: string } | null {
  const m = board.match(/^([a-z0-9-]+)\.(wd\d+)\/([A-Za-z0-9_-]+)$/i);
  if (!m) return null;
  const [, tenant, wd, site] = m;
  return { tenant: tenant.toLowerCase(), wd: wd.toLowerCase(), site, host: `${tenant.toLowerCase()}.${wd.toLowerCase()}.myworkdayjobs.com` };
}

/** "Posted Today", "Posted Yesterday", "Posted 3 Days Ago", "Posted 30+ Days Ago" → a date. */
export function workdayPostedOn(text: string, today: string): string | null {
  const s = text.toLowerCase();
  if (/today|just posted/.test(s)) return today;
  if (/yesterday/.test(s)) return addDays(today, -1);
  const m = s.match(/(\d+)(\+)?\s*days?/);
  if (m) return addDays(today, -(Number(m[1]) + (m[2] ? 1 : 0)));
  return isoDay(text);
}

/**
 * Big employers can have thousands of Workday openings, so instead of reading them all,
 * the board is searched for the kinds of work you do. Titles are filtered again afterwards.
 */
export const WORKDAY_SEARCHES = ["ERP", "SAP", "NetSuite", "Oracle", "Epicor", "business systems", "business analyst", "systems analyst", "integration", "application developer", "software engineer"];
const WORKDAY_PAGE = 20;
const WORKDAY_PAGES_PER_SEARCH = 2;
const WORKDAY_MAX_DETAILS = 40;

export function parseWorkdayList(board: string, data: unknown, today: string): FeedJob[] {
  const p = workdayParts(board);
  return arr(obj(data).jobPostings).map((raw) => {
    const j = obj(raw);
    const path = str(j.externalPath);
    const loc = str(j.locationsText);
    return {
      ats: "workday" as const,
      board,
      externalId: path,
      title: str(j.title).trim(),
      location: /^\d+ locations?$/i.test(loc) ? "" : loc,
      workplace: workplaceFrom(j.remoteType),
      country: null,
      url: p && path ? `https://${p.host}/${p.site}${path}` : "",
      posted: workdayPostedOn(str(j.postedOn), today),
      description: null,
      employmentType: null,
      payMin: null,
      payMax: null,
      payText: null,
    };
  }).filter((j) => j.externalId && j.title);
}

/** Fills in a Workday job from its detail page: full location list, country, work mode, date and description. */
export function mergeWorkdayDetail(job: FeedJob, data: unknown): FeedJob {
  const i = obj(obj(data).jobPostingInfo);
  if (!Object.keys(i).length) return job;
  const locs = [str(i.location), ...arr(i.additionalLocations).map(str)].filter(Boolean);
  const country = str(obj(i.country).descriptor);
  const desc = htmlToText(str(i.jobDescription));
  const pay = parseMoneyRange(desc.match(/\$\s*[\d,.]+\s*[kK]?\s*(?:-|–|to)\s*\$\s*[\d,.]+\s*[kK]?/)?.[0] ?? "");
  return {
    ...job,
    location: locs.join("; ") || job.location,
    workplace: workplaceFrom(i.remoteType) ?? job.workplace,
    country: /united states/i.test(country) ? "US" : country || job.country,
    url: str(i.externalUrl) || job.url,
    posted: isoDay(i.startDate) ?? job.posted,
    description: desc || job.description,
    employmentType: str(i.timeType) || job.employmentType,
    payMin: pay?.min ?? job.payMin,
    payMax: pay?.max ?? job.payMax,
  };
}

async function fetchWorkday(fetcher: Fetcher, board: string, today: string): Promise<BoardResult> {
  const p = workdayParts(board);
  if (!p) return { ok: false, status: "not_found", error: 'Workday boards look like "tenant.wd5/SiteName". Paste the careers page link instead.' };
  const api = `https://${p.host}/wday/cxs/${p.tenant}/${p.site}`;
  const seen = new Map<string, FeedJob>();
  let reached = false;
  let lastError: Extract<JsonResult, { ok: false }> | null = null;
  for (const searchText of WORKDAY_SEARCHES) {
    for (let page = 0; page < WORKDAY_PAGES_PER_SEARCH; page++) {
      const r = await getJson(fetcher, `${api}/jobs`, { appliedFacets: {}, limit: WORKDAY_PAGE, offset: page * WORKDAY_PAGE, searchText });
      if (!r.ok) {
        lastError = r;
        if (r.status === "not_found" && !reached) return r;
        break;
      }
      if (!Array.isArray(obj(r.data).jobPostings)) return { ok: false, status: "error", error: "Unexpected response from Workday" };
      reached = true;
      const jobs = parseWorkdayList(board, r.data, today);
      for (const j of jobs) if (!seen.has(j.externalId)) seen.set(j.externalId, j);
      const total = Number(obj(r.data).total ?? 0);
      if (jobs.length < WORKDAY_PAGE || (total && (page + 1) * WORKDAY_PAGE >= total)) break;
    }
  }
  if (!reached) return lastError ?? { ok: false, status: "error", error: "Workday didn't answer" };
  // Only titles worth a look get the extra detail request (it has the location list and description).
  const jobs = [...seen.values()];
  const worth = jobs.filter((j) => titleTier(j.title)).sort((a, b) => String(b.posted ?? "").localeCompare(String(a.posted ?? ""))).slice(0, WORKDAY_MAX_DETAILS);
  const detailed = new Map<string, FeedJob>();
  for (const j of worth) {
    const d = await getJson(fetcher, `${api}${j.externalId}`);
    detailed.set(j.externalId, d.ok ? mergeWorkdayDetail(j, d.data) : j);
  }
  return { ok: true, jobs: jobs.map((j) => detailed.get(j.externalId) ?? j) };
}

const SR_PAGE = 100;
const SR_MAX_PAGES = 10;

async function fetchSmartRecruiters(fetcher: Fetcher, board: string): Promise<BoardResult> {
  const jobs: FeedJob[] = [];
  for (let page = 0; page < SR_MAX_PAGES; page++) {
    const r = await getJson(fetcher, `${boardApiUrl("smartrecruiters", board)}?limit=${SR_PAGE}&offset=${page * SR_PAGE}`);
    if (!r.ok) {
      if (page === 0) return r;
      break;
    }
    const content = obj(r.data).content;
    if (!Array.isArray(content)) return { ok: false, status: "error", error: "Unexpected response from SmartRecruiters" };
    jobs.push(...parseSmartRecruitersList(board, r.data));
    const total = Number(obj(r.data).totalFound ?? 0);
    if (content.length < SR_PAGE || (page + 1) * SR_PAGE >= total) break;
  }
  return { ok: true, jobs };
}

export function boardApiUrl(ats: Ats, board: string): string {
  const b = encodeURIComponent(board);
  if (ats === "greenhouse") return `https://boards-api.greenhouse.io/v1/boards/${b}/jobs`;
  if (ats === "lever") return `https://api.lever.co/v0/postings/${b}?mode=json`;
  if (ats === "smartrecruiters") return `https://api.smartrecruiters.com/v1/companies/${b}/postings`;
  if (ats === "workable") return `https://apply.workable.com/api/v1/widget/accounts/${b}?details=true`;
  if (ats === "workday") {
    const p = workdayParts(board);
    return p ? `https://${p.host}/wday/cxs/${p.tenant}/${p.site}/jobs` : "";
  }
  return `https://api.ashbyhq.com/posting-api/job-board/${b}?includeCompensation=true`;
}

export function boardPublicUrl(ats: Ats, board: string): string {
  if (ats === "usajobs") return "https://www.usajobs.gov/";
  if (ats === "remotive") return "https://remotive.com/";
  if (ats === "jobicy") return "https://jobicy.com/";
  if (ats === "greenhouse") return `https://job-boards.greenhouse.io/${board}`;
  if (ats === "lever") return `https://jobs.lever.co/${board}`;
  if (ats === "smartrecruiters") return `https://careers.smartrecruiters.com/${board}`;
  if (ats === "workable") return `https://apply.workable.com/${board}/`;
  if (ats === "workday") {
    const p = workdayParts(board);
    return p ? `https://${p.host}/${p.site}` : "";
  }
  return `https://jobs.ashbyhq.com/${board}`;
}

/** Reads every open job on one company's board (for Workday, every job matching your kinds of work). */
export async function fetchBoard(fetcher: Fetcher, ats: Ats, board: string, today = todayIn()): Promise<BoardResult> {
  if (isSearchSource(ats)) return fetchSearch(fetcher, ats);
  if (ats === "workday") return fetchWorkday(fetcher, board, today);
  if (ats === "smartrecruiters") return fetchSmartRecruiters(fetcher, board);
  const r = await getJson(fetcher, boardApiUrl(ats, board));
  if (!r.ok) return r;
  try {
    if (ats === "lever" && !Array.isArray(r.data)) return { ok: false, status: "error", error: "Unexpected response from Lever" };
    if (ats !== "lever" && !Array.isArray(obj(r.data).jobs)) return { ok: false, status: "error", error: "Unexpected response" };
    const jobs =
      ats === "greenhouse" ? parseGreenhouseList(board, r.data)
      : ats === "lever" ? parseLeverList(board, r.data)
      : ats === "workable" ? parseWorkableList(board, r.data)
      : parseAshbyList(board, r.data);
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

/** SmartRecruiters lists don't include descriptions either; the posting splits it into sections. */
export async function fetchSmartRecruitersDescription(fetcher: Fetcher, board: string, id: string): Promise<string | null> {
  const r = await getJson(fetcher, `${boardApiUrl("smartrecruiters", board)}/${encodeURIComponent(id)}`);
  if (!r.ok) return null;
  const sections = obj(obj(obj(r.data).jobAd).sections);
  const text = ["jobDescription", "qualifications", "additionalInformation"]
    .map((k) => htmlToText(str(obj(sections[k]).text), 3000))
    .filter(Boolean)
    .join("\n\n");
  return text || null;
}

/** The posting text, for boards whose lists leave it out. */
export async function fetchDescription(fetcher: Fetcher, ats: Ats, board: string, id: string): Promise<string | null> {
  if (ats === "greenhouse") return fetchGreenhouseDescription(fetcher, board, id);
  if (ats === "smartrecruiters") return fetchSmartRecruitersDescription(fetcher, board, id);
  return null;
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
  if (host === "jobs.smartrecruiters.com" || host === "careers.smartrecruiters.com") return seg[0] && seg[0] !== "oneclick-ui" ? { ats: "smartrecruiters", board: clean(seg[0]) } : null;
  if (host === "api.smartrecruiters.com" && seg[1] === "companies" && seg[2]) return { ats: "smartrecruiters", board: clean(seg[2]) };
  if (host === "apply.workable.com") {
    if (seg[0] === "api" && seg[3] === "accounts" && seg[4]) return { ats: "workable", board: clean(seg[4]) };
    return seg[0] && seg[0] !== "j" && seg[0] !== "api" ? { ats: "workable", board: clean(seg[0]) } : null;
  }
  const wd = host.match(/^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/);
  if (wd) {
    const rest = seg[0] === "wday" && seg[1] === "cxs" ? seg.slice(3) : seg;
    const site = /^[a-z]{2}(-[a-z]{2})?$/i.test(rest[0] ?? "") ? rest[1] : rest[0];
    return site ? { ats: "workday", board: `${wd[1]}.${wd[2]}/${clean(site)}` } : null;
  }
  return null;
}
