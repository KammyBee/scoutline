import { arr, getJson, obj, parseMoneyRange, str } from "./boards";
import { htmlToText, isoDay } from "./text";
import type { BoardResult, FeedJob, Fetcher, SearchSource } from "./types";

/**
 * Broad search: free job sites that list many employers. Each is searched for the kinds of work you do,
 * then the same title, location and age filters as company boards apply. Change the terms here.
 */
export const SEARCH_TERMS = ["ERP", "SAP", "NetSuite", "Epicor", "business systems analyst", "systems analyst", "integration developer", "application developer", "IT specialist"];

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n >= 10000 ? Math.round(n) : null;
};

// ---------- USAJOBS (federal jobs): https://data.usajobs.gov/api/search, free key from developer.usajobs.gov ----------
export function parseUsajobs(data: unknown): FeedJob[] {
  return arr(obj(obj(data).SearchResult).SearchResultItems).map((raw) => {
    const item = obj(raw);
    const d = obj(item.MatchedObjectDescriptor);
    const details = obj(obj(d.UserArea).Details);
    const locs = arr(d.PositionLocation).map(obj);
    const countries = locs.map((l) => str(l.CountryCode));
    const pay = obj(arr(d.PositionRemuneration)[0]);
    const yearly = /pa|year|annual/i.test(str(pay.RateIntervalCode) || str(pay.Description) || "PA");
    const remote = details.RemoteIndicator === true || /remote/i.test(str(d.PositionLocationDisplay));
    return {
      ats: "usajobs" as const,
      board: "search",
      externalId: str(item.MatchedObjectId || d.PositionID),
      title: str(d.PositionTitle).trim(),
      company: [str(d.OrganizationName), str(d.DepartmentName)].filter(Boolean)[0] || "US Government",
      location: (locs.map((l) => str(l.LocationName)).filter(Boolean).join("; ") || str(d.PositionLocationDisplay)) + (remote ? "; Remote" : ""),
      workplace: remote ? ("remote" as const) : null,
      country: countries.length && countries.every((c) => /united states|^us$/i.test(c)) ? "US" : null,
      url: str(d.PositionURI),
      posted: isoDay(d.PublicationStartDate),
      description: htmlToText([str(details.JobSummary), arr(details.MajorDuties).map(str).join("\n")].filter(Boolean).join("\n\n")) || null,
      employmentType: str(obj(arr(d.PositionSchedule)[0]).Name) || null,
      payMin: yearly ? num(pay.MinimumRange) : null,
      payMax: yearly ? num(pay.MaximumRange) : null,
      payText: null,
    };
  }).filter((j) => j.externalId && j.title);
}

// ---------- Remotive (remote jobs): https://remotive.com/api/remote-jobs ----------
export function parseRemotive(data: unknown): FeedJob[] {
  return arr(obj(data).jobs).map((raw) => {
    const j = obj(raw);
    const range = parseMoneyRange(str(j.salary));
    return {
      ats: "remotive" as const,
      board: "search",
      externalId: str(j.id),
      title: str(j.title).trim(),
      company: str(j.company_name).trim(),
      location: str(j.candidate_required_location) || "Remote",
      workplace: "remote" as const,
      country: null,
      url: str(j.url),
      posted: isoDay(j.publication_date),
      description: j.description ? htmlToText(str(j.description)) : null,
      employmentType: str(j.job_type).replace(/_/g, "-") || null,
      payMin: range?.min ?? null,
      payMax: range?.max ?? null,
      payText: range ? null : str(j.salary) || null,
    };
  }).filter((j) => j.externalId && j.title && j.company);
}

// ---------- Jobicy (remote jobs): https://jobicy.com/api/v2/remote-jobs?geo=usa&tag=... ----------
export function parseJobicy(data: unknown): FeedJob[] {
  return arr(obj(data).jobs).map((raw) => {
    const j = obj(raw);
    const min = num(j.annualSalaryMin), max = num(j.annualSalaryMax);
    const usd = !j.salaryCurrency || /usd/i.test(str(j.salaryCurrency));
    return {
      ats: "jobicy" as const,
      board: "search",
      externalId: str(j.id),
      title: htmlToText(str(j.jobTitle)).trim(),
      company: htmlToText(str(j.companyName)).trim(),
      location: str(j.jobGeo) || "Remote",
      workplace: "remote" as const,
      country: null,
      url: str(j.url),
      posted: isoDay(str(j.pubDate).replace(" ", "T")),
      description: j.jobDescription ? htmlToText(str(j.jobDescription)) : j.jobExcerpt ? htmlToText(str(j.jobExcerpt)) : null,
      employmentType: arr(j.jobType).map(str).join(", ") || null,
      payMin: usd ? min : null,
      payMax: usd ? max : null,
      payText: null,
    };
  }).filter((j) => j.externalId && j.title && j.company);
}

function merge(into: Map<string, FeedJob>, jobs: FeedJob[]) {
  for (const j of jobs) if (!into.has(j.externalId)) into.set(j.externalId, j);
}

/** Runs one search source for every term; the same posting found by two terms is kept once. */
export async function fetchSearch(fetcher: Fetcher, source: SearchSource, env: Record<string, string | undefined> = process.env): Promise<BoardResult> {
  const found = new Map<string, FeedJob>();
  if (source === "remotive") {
    // Remotive asks for only a few requests a day, so its whole (small) list is read once and filtered here.
    const r = await getJson(fetcher, "https://remotive.com/api/remote-jobs");
    if (!r.ok) return r;
    if (!Array.isArray(obj(r.data).jobs)) return { ok: false, status: "error", error: "Unexpected response from Remotive" };
    return { ok: true, jobs: parseRemotive(r.data) };
  }
  let reached = false;
  let lastError = "";
  for (const term of SEARCH_TERMS) {
    let r;
    if (source === "usajobs") {
      const key = env.USAJOBS_API_KEY, email = env.USAJOBS_EMAIL;
      if (!key || !email) return { ok: false, status: "error", error: "Add USAJOBS_API_KEY and USAJOBS_EMAIL (free from developer.usajobs.gov) to turn on federal job search." };
      r = await getJson(fetcher, `https://data.usajobs.gov/api/search?Keyword=${encodeURIComponent(term)}&ResultsPerPage=100&DatePosted=30`, undefined, { Host: "data.usajobs.gov", "User-Agent": email, "Authorization-Key": key });
      if (r.ok) merge(found, parseUsajobs(r.data));
    } else {
      r = await getJson(fetcher, `https://jobicy.com/api/v2/remote-jobs?count=50&geo=usa&tag=${encodeURIComponent(term)}`);
      if (r.ok) merge(found, parseJobicy(r.data));
    }
    if (r.ok) reached = true;
    else lastError = r.error;
  }
  if (!reached) return { ok: false, status: "error", error: lastError || "No answer" };
  return { ok: true, jobs: [...found.values()] };
}
