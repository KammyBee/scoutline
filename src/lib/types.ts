import type { ActionNeeded, Prep, Status, ThankYou } from "@/db/schema";

export type { ActionNeeded, Prep, Status, ThankYou };

/** One row in the pipeline list. Kept small; the panel loads the rest on demand. */
export type JobRow = {
  id: string;
  num: number | null;
  title: string;
  company: string;
  location: string;
  mode: string;
  employmentType: string | null;
  payText: string | null;
  payMin: number | null;
  payMax: number | null;
  url: string | null;
  source: string | null;
  posted: string | null;
  found: string | null;
  tags: string[];
  status: Status;
  appliedAt: string | null;
  followUpAt: string | null;
  passReason: string | null;
  actionNeeded: ActionNeeded | null;
  interviewAt: string | null;
  hasPrep: boolean;
  fit: number;
  lastEvent: { kind: string; date: string } | null;
};

export type JobEvent = { id: number; date: string; kind: string; summary: string; link: string | null };

export type JobDetail = JobRow & {
  why: string | null;
  hits: string[];
  gaps: string[];
  scoredBy: string | null;
  verified: string | null;
  description: string | null;
  descriptionSavedAt: string | null;
  descriptionUnavailable: boolean;
  notes: string | null;
  coverLetter: string | null;
  resumeName: string | null;
  resumeUrl: string | null;
  kitTips: string[];
  interviewEnd: string | null;
  prep: Prep | null;
  thankYou: ThankYou | null;
  events: JobEvent[];
};

export type PipelineData = {
  jobs: JobRow[];
  aiReady: boolean;
  answers: Record<string, string>;
  today: string;
};
