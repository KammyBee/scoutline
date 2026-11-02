CREATE TABLE "ai_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"day" date NOT NULL,
	"purpose" text NOT NULL,
	"model" text NOT NULL,
	"posting_id" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" real DEFAULT 0 NOT NULL,
	"ok" boolean DEFAULT true NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE INDEX "ai_calls_day_idx" ON "ai_calls" USING btree ("day");