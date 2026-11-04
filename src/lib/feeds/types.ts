export type Ats = "greenhouse" | "lever" | "ashby" | "smartrecruiters" | "workable" | "workday";
export const ATS_LIST: Ats[] = ["greenhouse", "lever", "ashby", "smartrecruiters", "workable", "workday"];
export const ATS_LABEL: Record<Ats, string> = { greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", smartrecruiters: "SmartRecruiters", workable: "Workable", workday: "Workday" };

/** One job as read from a company's public job board, before filtering. */
export type FeedJob = {
  ats: Ats;
  board: string;
  externalId: string;
  title: string;
  location: string;
  /** what the board says about work mode, if anything */
  workplace: "remote" | "hybrid" | "onsite" | null;
  /** ISO country code when the board gives one */
  country: string | null;
  url: string;
  posted: string | null; // YYYY-MM-DD
  description: string | null; // plain text; Greenhouse, SmartRecruiters and Workday lists don't include it
  employmentType: string | null;
  payMin: number | null;
  payMax: number | null;
  payText: string | null;
};

export type BoardResult =
  | { ok: true; jobs: FeedJob[] }
  | { ok: false; status: "not_found" | "error"; error: string };

/** fetch with the shape we need, injectable for tests */
export type Fetcher = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string>; method?: "GET" | "POST"; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;
