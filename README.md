# Agentic Sales Team

The command center for an **AI sales workforce**. Instead of a CRM you operate by hand, you create autonomous **agents** that find leads on the public web, research and qualify them, match them to your product catalog, write personalized outreach and proposals, and book meetings — individually, as **teams** that hand work off to each other, or by chatting with a team in plain English.

A single **Next.js** app: web UI, server actions, and the job/scrape runners all deploy as one piece. No seed data — every agent, team, lead, and product is real data you (or your agents) create.

---

## Features

- **Typed agents & teams** — create agents from presets (SDR, Closer, Matchmaker, Assessor, Meeting Booker, …); each has a set of **capabilities**. Group them into **teams** with a shared lead book.
- **Leads with a review gate** — add by hand, import a CSV, or scrape from the web. Scraped leads land in a **Pending** queue until you (or an Assessor agent) accept them.
- **Products catalog + RAG** — load what you sell (manually or CSV). Products are embedded so agents ground their outreach, matches, and proposals in your real catalog (semantic search over pgvector).
- **The engines** — `scrape`, `research`, `qualify`, `assess`, `match`, `outreach`, `proposal`, and `book-meeting`, each backed by an LLM through OpenRouter.
- **Pods (work-the-book)** — a team auto-runs the full funnel (`scrape → assess → research → qualify → match → outreach → proposal`), chaining stage to stage with per-capability Auto/Ask approval gates.
- **Team group chat** — `@mention` an agent in plain language; intent is detected, routed to a capable teammate if needed, and the acting agent runs the real job and reports back in-thread.
- **Meetings & calendar** — book from a lead or via chat (natural-language time parsing); the calendar shows only real booked meetings.
- **Live activity & notifications** — a real event log with live "who's working which lead right now" indicators.

## Tech stack

- **Next.js `14.2.15`** (App Router) · **React `18.3.1`** · **TypeScript `5.5.3`**
- **Neon Postgres** (`@neondatabase/serverless`) via **Drizzle ORM**, with the **pgvector** extension for catalog embeddings
- **Auth**: `jose` (HS256 JWT session cookie) + `bcryptjs`
- **AI**: **OpenRouter** (`google/gemini-2.5-flash` for text/JSON, `google/gemini-embedding-001` at 768 dims for embeddings) via raw `fetch` — no SDK
- **Lead scraping**: **Firecrawl** (`/v2/search`) + LLM extraction, inside a Node route
- **Landing hero**: **GSAP** + **anime.js**
- Package manager **`pnpm@11.3.0`**

## Quick start

**Prerequisites**
- Node 18.17+ (or 20+)
- pnpm `11.3.0` — `corepack enable && corepack prepare pnpm@11.3.0 --activate`
- A [Neon](https://neon.tech) Postgres database (free tier is fine; pgvector is available)
- *(Optional)* an OpenRouter API key — for real AI (the app runs with canned fallbacks without it)
- *(Optional)* a Firecrawl API key — only for the lead-scraping capability

**Setup**
```bash
pnpm install
cp .env.example .env.local        # then fill in the values (see below)
pnpm db:migrate                   # apply migrations to your Neon database
pnpm dev                          # http://localhost:3000
```

Sign up, create an agent, load a product catalog, and start working leads.

## Environment variables

Create `.env.local` (git-ignored):

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | ✅ | Neon connection string (use the **pooled** URL) |
| `AUTH_SECRET` | ✅ | Signs session cookies (any long random string, e.g. `openssl rand -hex 32`). A dev fallback is used when `NODE_ENV !== "production"`; **required in production.** |
| `OPENROUTER_API_KEY` | optional | Enables all AI features. Without it, engines return canned output. |
| `FIRECRAWL_API_KEY` | optional | Enables the `scrape` capability (find leads from the public web). |
| `OPENROUTER_MODEL` | optional | Override the chat/JSON model (default `google/gemini-2.5-flash`). |

The app **degrades gracefully**: it boots and is usable with no database, no OpenRouter key, and no Firecrawl key.

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Dev server (Turbopack) at `http://localhost:3000` |
| `pnpm build` / `pnpm start` | Production build / serve |
| `pnpm lint` | ESLint (`next lint`) |
| `pnpm db:generate` | Generate a migration from a `lib/db/schema.ts` diff |
| `pnpm db:migrate` | Apply migrations (**custom runner** — see below) |
| `pnpm db:studio` | Drizzle Studio |

## Project structure

```
app/                 App Router pages + two API routes
  api/jobs/run/        Node job runner (research/qualify/assess/match/outreach/proposal)
  api/scrape/          Node scrape runner (Firecrawl + LLM)
  page.tsx / *Client   Server pages fetch initial data → client components render it
components/          UI primitives + Shell, Landing, Constellation, bells, modals
lib/
  db/                  Drizzle schema, Neon client, SQL migrations
  auth/                JWT (edge-safe) + cookie session + form actions
  ai/                  OpenRouter transport + the engines (research, outreach, qualify,
                       assess, match, proposal, meetingTime, intent, resolveLeads)
  scrape/              Firecrawl search + prospect extraction
  jobs/                enqueueJob / getJob
  leads/ products/ proposals/ matches/ meetings/   domain stores + "use server" actions
  pod/                 full-funnel pod pipeline (chaining, approvals)
  chat/                team group-chat orchestration
  workspace/ agents/   aggregates + persistence
  store.tsx            the React Context store (useApp)
scripts/             migrate.mjs (custom migration runner)
worker/              OPTIONAL legacy Python scrape worker (not used by the app)
```

The backend uses a **`server-only` / `"use server"` split**: real logic lives in `server-only` modules that take an explicit `userId`; thin `"use server"` action modules resolve the session and delegate. Client components import only the actions.

## Database & migrations

Migrations use a **custom runner** — apply with `pnpm db:migrate` (`node scripts/migrate.mjs`), **not** `drizzle-kit migrate`. Neon's HTTP driver runs one statement per call, so the runner splits each `.sql` file on the `--> statement-breakpoint` marker and executes statements individually (tracked in a `_migrations` table; idempotent).

Migration `0012` runs `CREATE EXTENSION IF NOT EXISTS vector` and creates the products HNSW cosine index — **pgvector must be enabled** on your database (it is on Neon).

Workflow: edit `lib/db/schema.ts` → `pnpm db:generate` → `pnpm db:migrate`. #redeploy trigger

## Deployment

**Single deploy** to Vercel (or any Node host) — including scraping. Set `DATABASE_URL`, `AUTH_SECRET`, `OPENROUTER_API_KEY`, `FIRECRAWL_API_KEY` and `CRON_SECRET` in the project environment. The scrape route caps at `maxDuration = 60`; the job runner at `300`. No persistent process, no browser: Vercel Cron (`vercel.json`, every minute, needs the Pro plan) calls `/api/cron/jobs` and `/api/cron/scrape` with `CRON_SECRET` to run queued jobs and scrapes for every user, so they finish with no tab open. Ensure pgvector is enabled on your Neon database.
