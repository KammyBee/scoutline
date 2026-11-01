# Scoutline

A personal job search pipeline. Scoutline keeps every posting you've seen, every application and its email history in one Postgres database, and shows them as a compact list with a detail panel for each job.

It started as a Claude-run dashboard and is being rebuilt as a regular web app, in five phases:

| Phase | What it adds | Status |
| --- | --- | --- |
| 1. Foundation | App, database, sign-in, import from the old dashboard, pipeline list and job panel | **Done** |
| 2. Job feeds | Nightly pulls from Greenhouse, Lever, Ashby and Adzuna, with dedupe and filters | Next |
| 3. Matching | Skill scoring, feedback buttons, Claude re-ranking, cover letter drafts | |
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

To make a `SESSION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Put it online (Neon + Vercel)

1. **Database.** Create a free project at [neon.tech](https://neon.tech). Copy the **pooled** connection string.
2. **Load your data into it.** Put that string in `.env.local` as `DATABASE_URL`, then run `npm run import -- data/dashboard-export.json`. This creates the tables and imports your jobs.
3. **Deploy.** Import the GitHub repo at [vercel.com/new](https://vercel.com/new). Under Environment Variables add `DATABASE_URL`, `APP_PASSWORD`, `SESSION_SECRET` and `APP_TIMEZONE`, then deploy.
4. Open the site and sign in with your password.

Schema changes later: `npm run db:generate` writes a new migration from `src/db/schema.ts`, and `npm run db:migrate` applies it to whichever database `DATABASE_URL` points at.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js development server, production build, production server |
| `npm run import -- <file> [--update]` | Imports a dashboard export. Safe to run again: it only adds what's missing. `--update` overwrites existing rows from the file instead. |
| `npm run db:generate` | Generates a SQL migration from schema changes |
| `npm run db:migrate` | Applies migrations |
| `npm test` | Unit tests plus an import test against an in-memory Postgres |
| `npm run typecheck` / `lint` | TypeScript and ESLint |

## How it's organized

```
src/
  app/            pages, the sign-in flow and server actions (status changes, notes, dates)
  components/     Pipeline (list, tabs, filters, sidebar) and JobPanel (the detail drawer)
  db/             Drizzle schema, connection (Neon or PGlite) and migrations runner
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
| `resumes`, `settings`, `companies` | Resume links, screening answers, and the employer list for phase 2 |

## Privacy

Your exported data and the local database are git-ignored (`data/`, `.data/`, `.env*`). Keep the export file out of the repo; it holds your application history.

## Changes from the plan

- **Drizzle instead of Prisma.** Drizzle runs on PGlite, so local development and the tests need no Postgres install, and it produces plain SQL migrations.
- **Password sign-in until phase 4.** Google sign-in arrives with Gmail access in phase 4. Until then, one password from `APP_PASSWORD` and a signed 30-day cookie protect the app.
