CREATE TABLE "feed_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"trigger" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"companies_checked" integer DEFAULT 0 NOT NULL,
	"jobs_seen" integer DEFAULT 0 NOT NULL,
	"jobs_matched" integer DEFAULT 0 NOT NULL,
	"added" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "last_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "last_status" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "last_job_count" integer;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "last_match_count" integer;--> statement-breakpoint
ALTER TABLE "postings" ADD COLUMN "ats_ref" text;--> statement-breakpoint
CREATE UNIQUE INDEX "postings_ats_ref_idx" ON "postings" USING btree ("ats_ref") WHERE "postings"."ats_ref" is not null;