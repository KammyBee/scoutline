# Scoutline

A personal job search pipeline. Scoutline keeps every posting you've seen, every application and its email history in one Postgres database, and shows them as a compact list with a detail panel for each job. It reads your job email from Gmail (read-only) to keep each application's status up to date, and tells you when to follow up.

It started as a Claude-run dashboard and is being rebuilt as a regular web app, in five phases:

| Phase | What it adds | Status |
| --- | --- | --- |
| 1. Foundation | App, database, sign-in, import from the old dashboard, pipeline list and job panel | **Done** |
| 2. Job feeds | Daily checks of company job boards on Greenhouse, Lever, Ashby, SmartRecruiters, Workable and Workday, with filters and dedupe | **Done** |
| 3. Matching | Skill scoring, feedback buttons, Claude scoring, cover letters and screening answers, stats | **Done** |
| 4. Gmail tracking | Google sign-in, Gmail sync, follow-up and no-response rules | **Done** |
| 5. Portfolio polish | Demo mode, architecture diagram, public deploy | Next |

## Stack

- **Next.js 16** (App Router, Server Components, Server Actions) with React 19 and TypeScript
- **PostgreSQL** on Neon in production; **PGlite** (Postgres compiled to WebAssembly) locally and in tests, so nothing needs installing
- **Drizzle ORM** for typed queries and versioned SQL migrations (`drizzle/`)
- **Claude API** (`@anthropic-ai/sdk`) for scoring and writing, optional
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

Scoutline watches a list of companies and reads their public job boards on **Greenhouse, Lever, Ashby, SmartRecruiters, Workable and Workday**. These are free and need no API keys.

Startups mostly use the first three. Bigger employers with SAP, Oracle and other ERP teams (manufacturers, chipmakers, biotech, energy) mostly use Workday. A big Workday board can list thousands of jobs, so instead of reading all of them Scoutline searches it for your kinds of work (ERP, SAP, NetSuite, Oracle, Epicor, business systems, business/systems analyst, integration, application developer, software engineer; the list is `WORKDAY_SEARCHES` in `src/lib/feeds/boards.ts`) and then opens only the postings whose titles pass the filters.

1. Open **Watch list** and press **Add the starter list** (59 Bay Area and remote-friendly employers that hire business systems, ERP, integration and R&D software people), or add companies one at a time by pasting a link to their job board or any of their postings. If you already added the starter list, press it again to add only the new ones. For Workday, paste the careers page link (it looks like `https://acme.wd5.myworkdayjobs.com/External`).
2. Press **Check for new jobs** in the header, or run `npm run fetch-jobs`. Online, Vercel runs the same check every morning.
3. New matches land in **To review** with the posting saved, a fit score, and the source (for example "Greenhouse · Samsara").

### Broad search

Besides company boards, three free job sites are searched for your kinds of work (terms in `SEARCH_TERMS`, `src/lib/feeds/search.ts`), so you also see employers you haven't added:

- **USAJOBS**: federal jobs (IT specialist, systems analyst, ERP/SAP roles). Needs a free key: request one at [developer.usajobs.gov](https://developer.usajobs.gov/APIRequest/Index), then add `USAJOBS_API_KEY` and `USAJOBS_EMAIL` (the email you registered with) to `.env.local` and Vercel.
- **Remotive** and **Jobicy**: remote jobs open to the US. No key needed.

They appear on Watch list under "Broad search" (switch any off there), and their jobs are tagged **Broad search** with the real employer's name, for example "Jobicy · Plantline".

### Duplicates

The same job is never added twice. Before adding anything, Scoutline compares it with every job already in the database, including ones you removed. It counts as the same job when any of these match:
- the same board posting
- the same link, ignoring tracking bits like `utm_source`
- the same company and title, ignoring legal suffixes ("Inc.", "Systems"), location or remote tags ("(Remote)", "- San Jose, CA"), and requisition numbers. Levels like I and II still count as different jobs.

Every check also clears second copies already in To review or Saved. The copy you applied to, or saved, is the one kept. `npm run dedupe` lists any duplicates, and `npm run dedupe -- --apply` removes them.

What gets added: jobs posted in the last 30 days, remote in the US or in the Bay Area, whose titles fit the work: ERP and business systems roles first (fit 4), then application, integration, BI and .NET roles (fit 3), then general software roles (fit 2). Senior, lead, manager, intern and non-technical roles are skipped. Anything already in your pipeline, or seen before and removed, is never added again (see Duplicates above).

The first check tests every board. A board name that doesn't exist is switched off and shown under **Problems**, so you can fix the name or remove it. The filters live in `src/lib/feeds/rules.ts`.

## Matching and Claude

Every job gets a **skill match**: the skills from your resume that show up in the posting (green chips) and things it asks for that you don't have (amber chips). It comes from the lists in `src/lib/match.ts` and costs nothing.

Two buttons teach it what you like:

- **More like this** (Overview tab) remembers the skills in that job. Jobs with the same skills get a small boost.
- **Pass → Not for me** (or "Wrong stack") remembers the title. Jobs with similar titles get pushed down.

Fits you set by hand are never changed.

### Claude features (optional, a few dollars a month)

Add `ANTHROPIC_API_KEY` to `.env.local` (and to Vercel later) to turn these on:

| Feature | Model | Rough cost |
| --- | --- | --- |
| Scores new jobs after each check (fit 1–5 and a one-line reason), up to 30 per check | Haiku 5.5 | well under 1¢ per check |
| **Score with Claude** button on any job | Haiku 5.5 | under 1¢ |
| **Write with Claude** cover letter (Apply tab) | Sonnet 5.5 | about 1¢ |
| Picks the best-fit resume for each new job, in the same call as scoring | Haiku 5.5 | free (same call) |
| Drafts cover letters after each check for jobs Claude scored 4 or 5, up to `AUTO_LETTERS_PER_DAY` (default 8) a day | Sonnet 5.5 | about 1¢ each |
| **Draft an answer** to a screening question (Apply tab) | Sonnet 5.5 | about 1¢ |

A busy month is usually $1–3. Every call is logged in the `ai_calls` table and totalled on the **Stats** page. `CLAUDE_DAILY_LIMIT` (default 60 calls) stops all Claude calls for the rest of the day once reached, so a bug can't run up a bill. You can also set a monthly spend limit in the Anthropic console.

**Recommended resume.** Every new job gets a resume picked from its title right away (rules in `src/lib/resumes.ts`), and Claude replaces that with its own pick when it scores the job. Choose a different one on the Apply tab and it stays yours; Claude never changes it.

**Automatic cover letters.** After each check, Claude drafts letters for the best new matches (scored 4 or 5, still in To review or Saved, found in the last week, no letter yet). They show a **Letter ready** tag in the list. They're drafts for you to read and edit; Scoutline never submits anything. Automatic letters always leave at least 10 of the day's Claude calls free for things you ask for. Set `AUTO_LETTERS_PER_DAY=0` to turn them off.

Claude only sees the posting and the true facts in `src/lib/profile.ts`, and is told to use nothing else. Your current employer is never mentioned. Read every draft before you send it.

Without a key, everything else works and the Claude buttons are hidden.

### Stats

The **Stats** page shows how many applications got a reply or an interview, broken down by resume, source, work mode and fit score, plus Claude usage this month.

Not covered: employers whose careers sites run on Workday, iCIMS or their own systems (many large hardware companies), and broad keyword search across Indeed, LinkedIn or Dice, none of which offer a free public API.

## Gmail tracking

Connect Gmail and Scoutline reads your job email, files each message under the job it's about, and keeps statuses current:

| Email | What happens |
| --- | --- |
| "Thanks for applying" | Logged; a New or Saved job moves to **Applied**, with a follow-up date a week out |
| Interview request | **Interviewing**, plus "Action needed: reply with your availability" |
| Assessment, form, background check | **Action needed**, with a due date when the email gives one ("within 3 days") |
| Rejection | **Rejected** |
| Offer | **Offer**, plus "Review the offer" |
| Recruiter or other update | Logged in the job's email history |

Statuses only move forward, and a job you passed on is never changed. Replies in a thread stay with the job the thread started on. Messages Scoutline can't place (say, a recruiter writing about a role you don't track) land on the **Inbox** page, where you pick the job or hide them. Job alerts and newsletters are skipped.

**What it reads and keeps.** Gmail access is read-only (`gmail.readonly`). Scoutline searches only received mail with hiring-system senders or job words in it, skipping Promotions and Social. For each job email it keeps the sender, the subject, the kind, dates, a link to open it in Gmail, and a one-line summary written from a template. It never stores message bodies or attachments (attachments aren't even downloaded), and it strips phone numbers and money amounts from anything it saves, so offer numbers never reach the database. Senders in `GMAIL_SKIP_DOMAINS` are ignored completely; put your current employer's domain there. The code can't send, reply, label, archive or delete: every Gmail call goes through one allow-list (`src/lib/gmail/api.ts`) that permits listing messages, reading a message, and saving a draft, and the tests check it.

**Follow-up rules** (Inbox page, and on every sync):

- A follow-up comes due `FOLLOW_UP_DAYS` (7) after you apply. **Write follow-up** opens a short editable note; **I followed up** logs it and sets the next date; **Snooze a week** just moves the date.
- No reply for `NO_RESPONSE_DAYS` (30) after applying, or after your last follow-up: the job is marked **No response**. Set it to 0 to turn this off.
- Interviewing and no email either way for `QUIET_INTERVIEW_DAYS` (14): it shows up as worth a check-in.

**Follow-up drafts (optional).** Press **Allow follow-up drafts** to grant `gmail.compose`, and **Save as Gmail draft** puts the note in your Gmail Drafts folder. It is never sent; you open it in Gmail and send it yourself.

**Syncing.** Press **Sync now** on the Inbox page. Online, Vercel also runs it daily at 15:42 UTC (about 7:42 AM Pacific) and applies the follow-up rules, even if Gmail isn't connected. The first sync reads the last `GMAIL_FIRST_SYNC_DAYS` (45) days.

### Set up Google (one time, about 10 minutes)

1. In [Google Cloud Console](https://console.cloud.google.com), create a project (e.g. "Scoutline").
2. **APIs & Services → Library**: enable the **Gmail API**.
3. **APIs & Services → OAuth consent screen**: choose **External**, fill in the app name and your email, and add yourself under **Test users**. Add the scopes `openid`, `email`, `.../auth/gmail.readonly` and `.../auth/gmail.compose`.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**, type **Web application**. Under **Authorized redirect URIs** add `http://localhost:3000/auth/google/callback`, and later your Vercel address plus `/auth/google/callback`.
5. Put the client ID and secret in `.env.local` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, set `GOOGLE_ALLOWED_EMAIL` to your Gmail address, and set `GMAIL_SKIP_DOMAINS`.
6. Restart `npm run dev`, choose **Sign in with Google**, then open **Inbox** and press **Sync now**.

While the consent screen is in **Testing**, Google expires the connection after 7 days and the Inbox page asks you to reconnect. To avoid that, set the publishing status to **In production**. Google then shows an "unverified app" warning on the consent screen, which is expected for a personal app that only you use.

The Google refresh token is stored encrypted with a key derived from `SESSION_SECRET`; if you change that secret, connect Gmail again. **Disconnect** on the Inbox page deletes the token and asks Google to revoke it.

Once Google sign-in works you can remove `APP_PASSWORD`; only `GOOGLE_ALLOWED_EMAIL` can sign in. Leaving it set keeps the password as a backup.

## Use it from your phone (Tailscale)

Tailscale puts your PC and phone on a private network only your devices can join, so the phone can open the dev server without putting it on the public internet. Don't turn on Tailscale Funnel; that would make it public.

1. Install Tailscale on the PC ([tailscale.com/download](https://tailscale.com/download)) and on the phone (App Store or Play Store). Sign in to the same account on both.
2. On the PC, find its Tailscale address: click the Tailscale icon in the system tray, or run `tailscale ip -4` in PowerShell. It looks like `100.x.y.z`.
3. Let the phone through Windows Firewall, only from Tailscale addresses. In PowerShell **as administrator**:

   ```powershell
   New-NetFirewallRule -DisplayName "Scoutline (Tailscale only)" -Direction Inbound -Protocol TCP -LocalPort 3000 -RemoteAddress 100.64.0.0/10 -Action Allow
   ```

   If Windows also pops up a firewall prompt for Node.js the first time, tick **Private networks** only and click Allow.
4. Start the server with `npm run dev:phone` instead of `npm run dev`. It's the same dev server, listening on all network connections instead of only this PC. `http://localhost:3000` keeps working on the PC.
5. With Tailscale on, open `http://100.x.y.z:3000` on the phone (your address from step 2) and sign in with your password. With MagicDNS on, `http://<pc-name>.<tailnet>.ts.net:3000` works too.

The PC has to be on, awake and running `npm run dev:phone`. Tailscale addresses and `.ts.net` names are allowed in `next.config.ts`; if you use another name, such as the short MagicDNS name, add it to `DEV_ORIGINS` in `.env.local`.

Google sign-in and "Connect Gmail" only work on the PC, because Google sends you back to `localhost`. Use your password on the phone. Gmail syncing keeps running on the PC and the results show on the phone.

## Put it online (Neon + Vercel)

1. **Database.** Create a free project at [neon.tech](https://neon.tech). Copy the **pooled** connection string.
2. **Load your data into it.** Put that string in `.env.local` as `DATABASE_URL`, then run `npm run import -- data/dashboard-export.json`. This creates the tables and imports your jobs.
3. **Deploy.** Import the GitHub repo at [vercel.com/new](https://vercel.com/new). Under Environment Variables add `DATABASE_URL`, `APP_PASSWORD`, `SESSION_SECRET`, `APP_TIMEZONE`, `CRON_SECRET` (any long random string) and, for Claude features, `ANTHROPIC_API_KEY`, then deploy. For Gmail tracking also add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_ALLOWED_EMAIL`, `GMAIL_SKIP_DOMAINS` and `APP_URL` (your site's address), and add the site's `/auth/google/callback` address to the OAuth client's redirect URIs. `vercel.json` schedules the daily job-board check at 13:17 UTC (about 5–6 AM Pacific) and the Gmail sync at 15:42 UTC; Vercel sends `CRON_SECRET` with both, and the endpoints refuse calls without it.
4. Open the site and sign in with your password.

Schema changes later: `npm run db:generate` writes a new migration from `src/db/schema.ts`, and `npm run db:migrate` applies it to whichever database `DATABASE_URL` points at.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js development server, production build, production server |
| `npm run import -- <file> [--update]` | Imports a dashboard export. Safe to run again: it only adds what's missing. `--update` overwrites existing rows from the file instead. |
| `npm run fetch-jobs [-- --seed]` | Checks every active company's job board now. `--seed` adds the starter watch list first if yours is empty. |
| `npm run db:generate` | Generates a SQL migration from schema changes |
| `npm run db:migrate` | Applies migrations and refreshes skill matches |
| `npm run rescore` | Recomputes every job's skill match and your feedback boosts |
| `npm run dedupe` | Lists duplicate jobs in To review or Saved (`-- --apply` removes them) |
| `npm test` | Unit and database tests against an in-memory Postgres, with a fake Claude |
| `npm run typecheck` / `lint` | TypeScript and ESLint |

## How it's organized

```
src/
  app/            pages (pipeline, inbox, watch list, stats, sign-in), server actions, Google sign-in routes, and the cron routes
  components/     Pipeline (list, tabs, filters, sidebar) and JobPanel (the detail drawer)
  db/             Drizzle schema, connection (Neon or PGlite) and migrations runner
  lib/ai/         Claude client with cost log and daily cap; scoring, cover letters, screening answers
  lib/feeds/      job board readers (Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Workday), filters, the ingest run, starter watch list
  lib/google/     Google OAuth (PKCE), the encrypted token store
  lib/gmail/      allow-listed Gmail client, message parsing and redaction, classifier, job matching, sync, drafts
  lib/            follow-up rules, inbox queries, skill match, rescoring, your profile facts, stats, queries, import mapping, dedupe keys, dates, session signing
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
| `emails` | Job email summaries from Gmail (never full bodies), and whether each was filed, needs a job, or was hidden |
| `feedback` | Pass reasons and "More like this" picks |
| `ai_calls` | One row per Claude call: purpose, model, tokens, estimated cost, errors |
| `companies` | Your watch list: each employer's job board, and how the last check went |
| `feed_runs` | One row per job-board check: boards checked, jobs seen, matched and added, errors |
| `google_account` | Your Google connection: email, granted scopes, the encrypted refresh token, and how the last sync went |
| `resumes`, `settings` | Resume links and screening answers |

## Privacy

Your exported data and the local database are git-ignored (`data/`, `.data/`, `.env*`). Keep the export file out of the repo; it holds your application history.

## Changes from the plan

- **Drizzle instead of Prisma.** Drizzle runs on PGlite, so local development and the tests need no Postgres install, and it produces plain SQL migrations.
- **No Adzuna.** Its free tier is meant for evaluation, so phase 2 uses only the free company job boards. Workday boards are searched by keyword instead of read in full, to keep each check quick. Broad keyword search stays in the Claude dashboard for now.
- **Google sign-in, password as a backup.** Sign-in is limited to one Google account (`GOOGLE_ALLOWED_EMAIL`). The phase 1 password still works if `APP_PASSWORD` is set. Either way you get the same signed 30-day cookie.
- **OAuth by hand, not a library.** The Google flow is about 150 lines (`src/lib/google/`, `src/app/auth/google/`) with PKCE and a state check, which keeps it easy to read and adds no dependencies.
- **Rules, not Claude, for email.** Classifying job email with patterns is free, instant, and keeps email text away from any other service. Summaries come from templates, so nothing from a message body is ever saved.
- **Claude scoring is optional.** The free skill match always runs; Claude scores on top only when a key is set.
