import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const STATUSES = ["new", "saved", "applied", "interviewing", "offer", "rejected", "noresponse", "passed"] as const;
export type Status = (typeof STATUSES)[number];

export type ActionNeeded = { text: string; link?: string; date?: string; due?: string | null; done: boolean };
export type Prep = { text: string; createdAt?: string };
export type ThankYou = { draftUrl?: string; createdAt?: string; to?: string };

/** Employers whose public job boards phase 2 will poll. */
export const companies = pgTable("companies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  ats: text("ats"), // greenhouse | lever | ashby | smartrecruiters | workable | workday | null
  board: text("board"), // the board token / site name on that ATS
  active: boolean("active").notNull().default(true),
  /** why it's on the list, e.g. "R&D hardware" */
  category: text("category"),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true, mode: "string" }),
  /** ok | not_found | error */
  lastStatus: text("last_status"),
  lastError: text("last_error"),
  /** open jobs on the board at the last check */
  lastJobCount: integer("last_job_count"),
  /** how many of those matched your filters */
  lastMatchCount: integer("last_match_count"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One check of all watched job boards. */
export const feedRuns = pgTable("feed_runs", {
  id: serial("id").primaryKey(),
  trigger: text("trigger").notNull(), // cron | manual | script
  startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true, mode: "string" }),
  companiesChecked: integer("companies_checked").notNull().default(0),
  jobsSeen: integer("jobs_seen").notNull().default(0),
  jobsMatched: integer("jobs_matched").notNull().default(0),
  added: integer("added").notNull().default(0),
  failed: integer("failed").notNull().default(0),
  errors: jsonb("errors").$type<{ company: string; error: string }[]>().notNull().default([]),
});

/** Every job posting the app has ever seen, from any source. */
export const postings = pgTable(
  "postings",
  {
    id: text("id").primaryKey(),
    num: integer("num"),
    title: text("title").notNull(),
    company: text("company").notNull(),
    location: text("location").notNull().default(""),
    mode: text("mode").notNull().default(""), // remote | hybrid | onsite | ""
    employmentType: text("employment_type"),
    payText: text("pay_text"),
    payMin: integer("pay_min"),
    payMax: integer("pay_max"),
    url: text("url"),
    source: text("source"),
    posted: date("posted", { mode: "string" }),
    found: date("found", { mode: "string" }),
    verified: date("verified", { mode: "string" }),
    description: text("description"),
    descriptionSavedAt: timestamp("description_saved_at", { withTimezone: true, mode: "string" }),
    descriptionUnavailable: boolean("description_unavailable").notNull().default(false),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    /** normalized "company|title" — the database refuses a second copy of the same role */
    dedupeKey: text("dedupe_key").notNull(),
    /** true for roles you saw before and removed: kept only so they never come back */
    archived: boolean("archived").notNull().default(false),
    /** "greenhouse:anthropic:12345" for jobs pulled from a company board */
    atsRef: text("ats_ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("postings_dedupe_key_idx").on(t.dedupeKey),
    uniqueIndex("postings_url_idx").on(t.url).where(sql`${t.url} is not null and ${t.url} <> ''`),
    index("postings_found_idx").on(t.found),
    uniqueIndex("postings_ats_ref_idx").on(t.atsRef).where(sql`${t.atsRef} is not null`),
  ],
);

/** How well a posting fits, and why. */
export const matches = pgTable("matches", {
  postingId: text("posting_id")
    .primaryKey()
    .references(() => postings.id, { onDelete: "cascade" }),
  fit: integer("fit").notNull().default(3),
  why: text("why"),
  hits: jsonb("hits").$type<string[]>().notNull().default([]),
  gaps: jsonb("gaps").$type<string[]>().notNull().default([]),
  scoredBy: text("scored_by").notNull().default("import"), // import | rules | claude | you
  scoredAt: timestamp("scored_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Your status and working notes for a posting (one per posting). */
export const applications = pgTable(
  "applications",
  {
    postingId: text("posting_id")
      .primaryKey()
      .references(() => postings.id, { onDelete: "cascade" }),
    status: text("status").$type<Status>().notNull().default("new"),
    appliedAt: date("applied_at", { mode: "string" }),
    followUpAt: date("follow_up_at", { mode: "string" }),
    passedAt: date("passed_at", { mode: "string" }),
    passReason: text("pass_reason"),
    noResponseAt: date("no_response_at", { mode: "string" }),
    notes: text("notes"),
    coverLetter: text("cover_letter"),
    resumeName: text("resume_name"),
    resumeUrl: text("resume_url"),
    /** who picked the resume: rules | claude | you | import. Claude never replaces your own pick. */
    resumePickedBy: text("resume_picked_by"),
    /** who wrote the cover letter: claude-auto (drafted after a check) | claude | you | import */
    coverLetterBy: text("cover_letter_by"),
    kitTips: jsonb("kit_tips").$type<string[]>().notNull().default([]),
    actionNeeded: jsonb("action_needed").$type<ActionNeeded | null>(),
    interviewAt: timestamp("interview_at", { withTimezone: true, mode: "string" }),
    interviewEnd: timestamp("interview_end", { withTimezone: true, mode: "string" }),
    prep: jsonb("prep").$type<Prep | null>(),
    thankYou: jsonb("thank_you").$type<ThankYou | null>(),
    lastEmailAt: timestamp("last_email_at", { withTimezone: true, mode: "string" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("applications_status_idx").on(t.status)],
);

/** What happened on an application: confirmations, interviews, rejections, notes. */
export const events = pgTable(
  "events",
  {
    id: serial("id").primaryKey(),
    postingId: text("posting_id")
      .notNull()
      .references(() => postings.id, { onDelete: "cascade" }),
    date: date("date", { mode: "string" }).notNull(),
    kind: text("kind").notNull(), // applied | rejection | interview | action | recruiter | offer | update
    summary: text("summary").notNull().default(""),
    link: text("link"),
    emailId: text("email_id"),
  },
  (t) => [
    index("events_posting_idx").on(t.postingId),
    uniqueIndex("events_posting_email_idx").on(t.postingId, t.emailId).where(sql`${t.emailId} is not null`),
  ],
);

/** Job-related Gmail messages (summaries only, never full bodies). */
export const emails = pgTable(
  "emails",
  {
    id: text("id").primaryKey(), // Gmail message id
    threadId: text("thread_id"),
    postingId: text("posting_id").references(() => postings.id, { onDelete: "set null" }),
    date: timestamp("date", { withTimezone: true, mode: "string" }),
    sender: text("sender"),
    subject: text("subject"),
    kind: text("kind"),
    summary: text("summary"),
    link: text("link"),
    actionText: text("action_text"),
    due: date("due", { mode: "string" }),
    state: text("state").notNull().default("matched"),
    processedAt: timestamp("processed_at", { withTimezone: true, mode: "string" }),
  },
  (t) => [index("emails_posting_idx").on(t.postingId), index("emails_thread_idx").on(t.threadId)],
);

/** Every signal you give about what you want: pass reasons, "More like this", "Not for me". */
export const feedback = pgTable("feedback", {
  id: serial("id").primaryKey(),
  postingId: text("posting_id").references(() => postings.id, { onDelete: "set null" }),
  kind: text("kind").notNull(), // pass | like | dislike
  reason: text("reason"),
  title: text("title"),
  company: text("company"),
  terms: jsonb("terms").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const resumes = pgTable("resumes", {
  name: text("name").primaryKey(),
  url: text("url").notNull(),
  bestFor: text("best_for"),
});

/** Small key/value settings, e.g. your screening answers. */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Every Claude API call: what it was for, tokens used and estimated cost. Powers the daily cap and the cost line on Stats. */
export const aiCalls = pgTable(
  "ai_calls",
  {
    id: serial("id").primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    day: date("day", { mode: "string" }).notNull(),
    purpose: text("purpose").notNull(), // score | cover_letter | auto_letter | answer
    model: text("model").notNull(),
    postingId: text("posting_id"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costUsd: real("cost_usd").notNull().default(0),
    ok: boolean("ok").notNull().default(true),
    error: text("error"),
  },
  (t) => [index("ai_calls_day_idx").on(t.day)],
);

/**
 * Your Google connection (one row, id 1). The refresh token is encrypted with a key derived from
 * SESSION_SECRET. Scopes are only ever gmail.readonly, plus gmail.compose if you turn on drafts.
 */
export const googleAccount = pgTable("google_account", {
  id: integer("id").primaryKey().default(1),
  email: text("email").notNull(),
  refreshTokenEnc: text("refresh_token_enc"),
  scopes: text("scopes").notNull().default(""),
  connectedAt: timestamp("connected_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  /** newest message date already read; the next sync starts a day before it */
  syncedThrough: timestamp("synced_through", { withTimezone: true, mode: "string" }),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true, mode: "string" }),
  /** ok | error | reconnect */
  lastSyncStatus: text("last_sync_status"),
  lastSyncError: text("last_sync_error"),
  lastSyncSummary: jsonb("last_sync_summary").$type<{ read: number; saved: number; matched: number; unmatched: number; statusChanges: number } | null>(),
});
