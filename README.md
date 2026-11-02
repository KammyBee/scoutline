# Scoutline

A personal job search pipeline. Scoutline keeps every posting you've seen, every application and its email history in one Postgres database, and shows them as a compact list with a detail panel for each job.

It started as a Claude-run dashboard and is being rebuilt as a regular web app, in five phases:

| Phase | What it adds | Status |
| --- | --- | --- |
| 1. Foundation | App, database, sign-in, import from the old dashboard, pipeline list and job panel | **Done** |
| 2. Job feeds | Daily checks of company job boards on Greenhouse, Lever and Ashby, with filters and dedupe | **Done** |
| 3. Matching | Skill scoring, feedback buttons, Claude re-ranking, cover letter drafts | Next |
| 4. Gmail tracking | Google sign-in, Gmail sync, follow-up and no-response rules | |
| 5. Portfolio polish | Demo mode, architecture diagram, public deploy | |

## Stack

- **Next.js 16** (App Router, Server Components, Server Actions) with React 19 and TypeScript
- **PostgreSQL** on Neon in production; **PGlite** (Postgres compiled to WebAssembly) locally and in tests, so nothing needs installing
- **Drizzle ORM** for typed queries and versioned SQL migrations (`drizzle/`)
- **Vitest** for unit and database tests

## Run it locally

Requires Node 20.9 or newer.

```bash
npm install
cp .env.example .env.local     # then set APP_PASSWORD and SESSION_SECRET
npm run import -- data/dashboard-export.json   # creates the local database and loads your jobs
npm run dev                    # http://localhost:3000
```

With `DATABASE_URL` unset, the database lives in `.data/pglite` and is created on first use. Delete that folder to start over.

The local database can be open in only one program at a time. Stop `npm run dev` (Ctrl+C) before running `npm run import`, `npm run db:migrate` or `npm run fetch-jobs`, then start it again. The app applies any pending database updates by itself when it starts locally.

To make a `SESSION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Job feeds

Scoutline watches a list of companies and reads their public job boards on **Greenhouse, Lever and Ashby**. These are free, need no API keys, and return every open role with its full description.

1. Open **Watch list** and press **Add the starter list** (48 Bay Area and remote-friendly employers that hire business systems, ERP, integration and R&D software people), or add companies one at a time by pasting a link to their job board or any of their postings.
2. Press **Check for new jobs** in the header, or run `npm run fetch-jobs`. Online, Vercel runs the same check every morning.
3. New matches land in **To review** with the posting saved, a fit score, and the source (for example "Greenhouse · Samsara").

What gets added: jobs posted in the last 30 days, remote in the US or in the Bay Area, whose titles fit the work: ERP and business systems roles first (fit 4), then application, integration, BI and .NET roles (fit 3), then general software roles (fit 2). Senior, lead, manager, intern and non-technical roles are skipped. Anything already in your pipeline, or seen before and removed, is never added again (same company and title, same link, or same board posting).

The first check tests every board. A board name that doesn't exist is switched off and shown under **Problems**, so you can fix the name or remove it. The filters live in `src/lib/feeds/rules.ts`.

Not covered: employers whose careers sites run on Workday, iCIMS or their own systems (many large hardware companies), and broad keyword search across Indeed, LinkedIn or Dice, none of which offer a free public API.

## Put it online (Neon + Vercel)

1. **Database.** Create a free project at [neon.tech](https://neon.tech). Copy the **pooled** connection string.
2. **Load your data into it.** Put that string in `.env.local` as `DATABASE_URL`, then run `npm run import -- data/dashboard-export.json`. This creates the tables and imports your jobs.
3. **Deploy.** Import the GitHub repo at [vercel.com/new](https://vercel.com/new). Under Environment Variables add `DATABASE_URL`, `APP_PASSWORD`, `SESSION_SECRET`, `APP_TIMEZONE` and `CRON_SECRET` (any long random string), then deploy. `vercel.json` schedules the daily job-board check at 13:17 UTC (about 5–6 AM Pacific); Vercel sends `CRON_SECRET` with it, and the endpoint refuses calls without it.
4. Open the site and sign in with your password.

Schema changes later: `npm run db:generate` writes a new migration from `src/db/schema.ts`, and `npm run db:migrate` applies it to whichever database `DATABASE_URL` points at.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js development server, production build, production server |
| `npm run import -- <file> [--update]` | Imports a dashboard export. Safe to run again: it only adds what's missing. `--update` overwrites existing rows from the file instead. |
| `npm run fetch-jobs [-- --seed]` | Checks every active company's job board now. `--seed` adds the starter watch list first if yours is empty. |
| `npm run db:generate` | Generates a SQL migration from schema changes |
| `npm run db:migrate` | Applies migrations |
| `npm test` | Unit tests plus an import test against an in-memory Postgres |
| `npm run typecheck` / `lint` | TypeScript and ESLint |

## How it's organized

```
src/
  app/            pages (pipeline, watch list, sign-in), server actions, and the daily cron route
  components/     Pipeline (list, tabs, filters, sidebar) and JobPanel (the detail drawer)
  db/             Drizzle schema, connection (Neon or PGlite) and migrations runner
  lib/feeds/      job board readers (Greenhouse, Lever, Ashby), filters, the ingest run, starter watch list
  lib/            queries, import mapping, dedupe keys, dates, session signing
  proxy.ts        sends anyone without a valid session to /login
drizzle/          generated SQL migrations
scripts/          migrate and import commands
tests/            Vitest tests with a made-up fixture (no real data)
```

### Data model

| Table | Holds |
| --- | --- |
| `postings` | Every role ever seen. A unique key on normalized company + title, and another on the posting link, keep duplicates out at the database level. Removed roles are archived, not deleted, so they're never suggested again. |
| `applications` | Your status, dates, notes, cover letter, resume pick, action items and interview prep for a posting |
| `matches` | Fit score (1 to 5), the reason, matched skills and gaps |
| `events` | Each application's history: confirmations, interviews, rejections |
| `emails` | Job email summaries from Gmail (never full bodies) |
| `feedback` | Pass reasons and, later, "More like this" / "Not for me" |
| `companies` | Your watch list: each employer's job board, and how the last check went |
| `feed_runs` | One row per job-board check: boards checked, jobs seen, matched and added, errors |
| `resumes`, `settings` | Resume links and screening answers |

## Privacy

Your exported data and the local database are git-ignored (`data/`, `.data/`, `.env*`). Keep the export file out of the repo; it holds your application history.

## Changes from the plan

- **Drizzle instead of Prisma.** Drizzle runs on PGlite, so local development and the tests need no Postgres install, and it produces plain SQL migrations.
- **No Adzuna.** Its free tier is meant for evaluation, so phase 2 uses only the free company job boards. Broad keyword search stays in the Claude dashboard for now.
- **Password sign-in until phase 4.** Google sign-in arrives with Gmail access in phase 4. Until then, one password from `APP_PASSWORD` and a signed 30-day cookie protect the app.
