# Agentic Sales Team

The command center for an **AI sales workforce**. Instead of a CRM you operate by hand, you create autonomous **agents** that find leads on the public web, research and qualify them, match them to your product catalog, write personalized outreach and proposals, and book meetings. Agents work alone, as **teams** that hand work to each other, or through a chat with a team in plain English.

A single **Next.js** app: web UI, server actions, and the job/scrape runners all deploy as one piece. There is no seed data. You (or your agents) create every agent, team, lead, and product.

---

## Features

- **Typed agents & teams**: Create agents from presets (SDR, Closer, Matchmaker, Assessor, Meeting Booker, …). Each agent has a set of **capabilities**. Put agents into **teams** with a shared lead book.
- **Leads with a review gate**: Add leads by hand, import a CSV, or scrape them from the web. Scraped leads go into a **Pending** queue. They stay there until you (or an Assessor agent) accept them.
- **Products catalog + RAG**: Load what you sell (by hand or from a CSV). The app embeds each product. Agents then use your real catalog for outreach, matches, and proposals (semantic search over pgvector).
- **The engines**: `scrape`, `research`, `qualify`, `assess`, `match`, `outreach`, `proposal`, and `book-meeting`, each backed by an LLM through OpenRouter.
- **Pods (work-the-book)**: A team runs the full funnel automatically (`scrape → assess → research → qualify → match → outreach → proposal`). Each stage starts the next stage. Each capability has an Auto/Ask approval gate.
- **Team group chat**: `@mention` an agent in plain language. The app finds the intent and sends the request to a teammate that can do it. That agent runs the real job and reports in the thread.
- **Meetings & calendar**: Book a meeting from a lead or through chat (the app reads natural-language times). The calendar shows only real booked meetings.
- **Live activity & notifications**: A real event log. Live indicators show which agent works on which lead now.

## Tech stack

- **Next.js `14.2.35`** (App Router) · **React `18.3.1`** · **TypeScript `5.5.3`**
- **Neon Postgres** (`@neondatabase/serverless`) via **Drizzle ORM**, with the **pgvector** extension for catalog embeddings
- **Auth**: `jose` (HS256 JWT session cookie) + `bcryptjs`
- **AI**: **OpenRouter** (`google/gemini-2.5-flash` for text/JSON, `google/gemini-embedding-001` at 768 dims for embeddings) via raw `fetch` (no SDK)
- **Lead scraping**: **Firecrawl** (`/v2/search`) + LLM extraction, inside a Node route
- **Landing hero**: **GSAP**
- Package manager **`pnpm@11.3.0`**

## Quick start

**Prerequisites**
- Node 18.17+ (or 20+)
- pnpm `11.3.0`: `corepack enable && corepack prepare pnpm@11.3.0 --activate`
- A [Neon](https://neon.tech) Postgres database (free tier is fine; pgvector is available)
- *(Optional)* an OpenRouter API key for real AI. Without it, the app uses canned fallbacks.
- *(Optional)* a Firecrawl API key. Only the lead-scraping capability uses it.

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
| `CRON_SECRET` | ✅ in production | Bearer token Vercel Cron sends to `/api/cron/jobs` and `/api/cron/scrape` (any long random string). While unset, both routes refuse every call, so queued jobs and scrapes only run from an open tab. |

The app **degrades gracefully**: it boots and is usable with no database, no OpenRouter key, and no Firecrawl key.

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Dev server at `http://localhost:3000` |
| `pnpm build` / `pnpm start` | Production build / serve |
| `pnpm lint` | ESLint (`next lint`) |
| `pnpm test` | Unit tests (`vitest run`) |
| `pnpm db:generate` | Generate a migration from a `lib/db/schema.ts` diff |
| `pnpm db:migrate` | Apply migrations (**custom runner**, see below) |
| `pnpm db:studio` | Drizzle Studio |

## Project structure

```
app/                 App Router pages + API routes
  api/jobs/run/        Node job runner (research/qualify/assess/match/outreach/proposal)
  api/scrape/          Node scrape runner (Firecrawl + LLM)
  api/cron/            Vercel Cron entry points (jobs, scrape), gated by CRON_SECRET
  page.tsx / *Client   Server pages fetch initial data → client components render it
components/          UI primitives + Shell, Landing, bells, modals
lib/
  db/                  Drizzle schema, Neon client, SQL migrations
  auth/                JWT (edge-safe) + cookie session + form actions
  ai/                  OpenRouter transport + the engines (research, outreach, qualify,
                       assess, match, proposal, meetingTime, intent, resolveLeads)
  scrape/              Firecrawl search + prospect extraction
  jobs/                enqueueJob / getJob
  cron/                CRON_SECRET check for the /api/cron/* routes
  leads/ products/ proposals/ matches/ meetings/   domain stores + "use server" actions
  pod/                 full-funnel pod pipeline (chaining, approvals)
  chat/                team group-chat orchestration
  workspace/ agents/   aggregates + persistence
  store.tsx            the React Context store (useApp)
scripts/             migrate.mjs (custom migration runner)
```

The backend uses a **`server-only` / `"use server"` split**: real logic lives in `server-only` modules that take an explicit `userId`; thin `"use server"` action modules resolve the session and delegate. Client components import only the actions.

## Database & migrations

Migrations use a **custom runner**. Apply them with `pnpm db:migrate` (`node scripts/migrate.mjs`), **not** `drizzle-kit migrate`. Neon's HTTP driver runs one statement per call. Thus the runner splits each `.sql` file on the `--> statement-breakpoint` marker and executes statements individually (tracked in a `_migrations` table; idempotent).

Migration `0012` runs `CREATE EXTENSION IF NOT EXISTS vector` and creates the products HNSW cosine index. You **must enable pgvector** on your database (Neon has it).

Workflow: edit `lib/db/schema.ts` → `pnpm db:generate` → `pnpm db:migrate`.

## Deployment

**Single deploy** to Vercel (or any Node host). This includes scraping. Set `DATABASE_URL`, `AUTH_SECRET`, `OPENROUTER_API_KEY`, `FIRECRAWL_API_KEY` and `CRON_SECRET` in the project environment. The scrape route caps at `maxDuration = 60`; the job runner at `300`. No persistent process, no browser: Vercel Cron (`vercel.json`, every minute, needs the Pro plan) calls `/api/cron/jobs` and `/api/cron/scrape` with `CRON_SECRET` to run queued jobs and scrapes for every user, so they finish with no tab open. Ensure pgvector is enabled on your Neon database.
