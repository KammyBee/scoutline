CREATE TABLE "applications" (
	"posting_id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"applied_at" date,
	"follow_up_at" date,
	"passed_at" date,
	"pass_reason" text,
	"no_response_at" date,
	"notes" text,
	"cover_letter" text,
	"resume_name" text,
	"resume_url" text,
	"kit_tips" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"action_needed" jsonb,
	"interview_at" timestamp with time zone,
	"interview_end" timestamp with time zone,
	"prep" jsonb,
	"thank_you" jsonb,
	"last_email_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"ats" text,
	"board" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "emails" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text,
	"posting_id" text,
	"date" timestamp with time zone,
	"sender" text,
	"subject" text,
	"kind" text,
	"summary" text,
	"link" text,
	"action_text" text,
	"due" date,
	"state" text DEFAULT 'matched' NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"posting_id" text NOT NULL,
	"date" date NOT NULL,
	"kind" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"link" text,
	"email_id" text
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"posting_id" text,
	"kind" text NOT NULL,
	"reason" text,
	"title" text,
	"company" text,
	"terms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"posting_id" text PRIMARY KEY NOT NULL,
	"fit" integer DEFAULT 3 NOT NULL,
	"why" text,
	"hits" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"gaps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scored_by" text DEFAULT 'import' NOT NULL,
	"scored_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "postings" (
	"id" text PRIMARY KEY NOT NULL,
	"num" integer,
	"title" text NOT NULL,
	"company" text NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"mode" text DEFAULT '' NOT NULL,
	"employment_type" text,
	"pay_text" text,
	"pay_min" integer,
	"pay_max" integer,
	"url" text,
	"source" text,
	"posted" date,
	"found" date,
	"verified" date,
	"description" text,
	"description_saved_at" timestamp with time zone,
	"description_unavailable" boolean DEFAULT false NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resumes" (
	"name" text PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"best_for" text
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_posting_id_postings_id_fk" FOREIGN KEY ("posting_id") REFERENCES "public"."postings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_posting_id_postings_id_fk" FOREIGN KEY ("posting_id") REFERENCES "public"."postings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_posting_id_postings_id_fk" FOREIGN KEY ("posting_id") REFERENCES "public"."postings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_posting_id_postings_id_fk" FOREIGN KEY ("posting_id") REFERENCES "public"."postings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_posting_id_postings_id_fk" FOREIGN KEY ("posting_id") REFERENCES "public"."postings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "applications_status_idx" ON "applications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "emails_posting_idx" ON "emails" USING btree ("posting_id");--> statement-breakpoint
CREATE INDEX "events_posting_idx" ON "events" USING btree ("posting_id");--> statement-breakpoint
CREATE UNIQUE INDEX "events_posting_email_idx" ON "events" USING btree ("posting_id","email_id") WHERE "events"."email_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "postings_dedupe_key_idx" ON "postings" USING btree ("dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "postings_url_idx" ON "postings" USING btree ("url") WHERE "postings"."url" is not null and "postings"."url" <> '';--> statement-breakpoint
CREATE INDEX "postings_found_idx" ON "postings" USING btree ("found");