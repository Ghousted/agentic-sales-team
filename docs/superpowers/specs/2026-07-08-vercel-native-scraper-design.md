# Vercel-Native Scraper (Firecrawl) — Design

Replace the persistent Python/browser-use worker with a **Node scrape job that calls the Firecrawl API** from inside Next.js. Goal: the whole app — including scraping — deploys to **Vercel only**, on the **Hobby** plan (no Pro), works **multi-user** (public sources, not tied to any login), and needs **no browser, no Python, and no second host**.

> Supersedes the M2 lead-scraping worker's execution path. Keeps the `Prospect` shape, the ICP, the `jobs` table, the capability gate, and the Leads → Pending approval gate.
> **Public sources only.** "Scrape my own logged-in Facebook" stays deferred to a future browser-extension approach.

---

## Why Firecrawl

Firecrawl is a plain HTTP scraping/search/extract API (open-source and self-hostable, used here via its hosted API). Because it's just an API call, scraping runs in a normal **Next.js TypeScript route** — dropping browser-use, Browserbase, the headless browser, the Python function, the bundle-size risk, **and the Vercel Pro requirement**. Public-web discovery isn't tied to any login, so one route serves all users, scoped by `userId`. Single Vercel deploy.

---

## Part A — Architecture

```
scrape enqueued (team chat @mention or agent Find-leads)  →  jobs row (queued, userId, params.icp, params.target)
        │  client POSTs /api/scrape { jobId }   (session cookie carries auth)
        ▼
/api/scrape  — a normal Next.js route handler (TypeScript, runtime "nodejs")
   1. getSession → userId; load job; assert job.userId === userId
   2. atomically mark running (UPDATE ... WHERE status='queued' RETURNING)
   3. build a search query + extraction prompt from the ICP
   4. SUBMIT an async Firecrawl job (search + schema-extract for the Prospect shape); store its
      firecrawlJobId on our job (result.firecrawlJobId); return quickly (invocation stays short)
        ▼
client polls /api/scrape/status { jobId }  every few seconds (like the existing getJob poll)
   • checks the Firecrawl job; while pending → return {status:"running", found:N}
   • when Firecrawl completes → write each prospect as a lead (review='pending', source='scrape')
     + an activity row, dedup by profileUrl/email; mark our job done with { leadsFound }
        ▼
leads land in Leads → Pending (approval gate unchanged); the team-chat status line reports "Found N leads → Pending"
```

- **Single deploy, Hobby-friendly:** every function invocation is short (submit, or poll-and-maybe-write). No long-running process, no Pro `maxDuration` needed. Firecrawl/Neon/Gemini are APIs called, not deployments.
- **Multi-user:** one route serves everyone; every call is `userId`-scoped.
- **No browser, no Python.** Firecrawl does the crawling + LLM extraction server-side.

*(If a small `target` scrape completes fast enough synchronously, `/api/scrape` may do search+extract in one invocation and write leads directly — the async submit+poll path is the Hobby-safe default; the plan picks based on the verified Firecrawl endpoint behavior.)*

---

## Part B — Scrape handler internals

- **Firecrawl call:** from the ICP (`industry`/`titles`/`geo`, preferring `params.icp`, else `agent_config.settings.scrape`/goal), build a search query and an extraction prompt, and call Firecrawl to **search public sources + extract structured `Prospect`s against a JSON schema**. Firecrawl's own LLM does the structuring — **no separate Gemini call needed for scrape**. Exact endpoint mix (`/search` + `/scrape`-with-`json` vs a single async `/extract`) is verified against the current Firecrawl API in the plan; use raw `fetch` (consistent with the Gemini transport) or the Firecrawl Node SDK.
- **Prospect shape (reused):** `{ name, title, company, profileUrl, platform, email }` — email only if visibly present. Map each Firecrawl result → a `leads` row via the existing `insert`/DTO path with `source='scrape'`, `review='pending'`.
- **Dedup:** skip prospects whose `profileUrl` (or email) already exists for this user+agent (reuse the existing `lead_exists` logic, ported to TS).
- **Lifecycle:** mark `running` on submit (atomic `status='queued'` guard prevents double-run from a double-POST). Store `result.firecrawlJobId` + a `found` counter. On completion write leads + `finish` (`result.leadsFound`); on Firecrawl error/timeout → `fail` with a short error.
- **Auth:** `getSession()` in both `/api/scrape` and `/api/scrape/status`; reject if no session or the job isn't the caller's.
- **READ-ONLY by construction:** Firecrawl only reads public pages — no posting/logging-in, so the old `READ_ONLY_GUARD` is inherent.

---

## Part C — App-side changes, drops, constraints

**Changes:**
- **New routes:** `app/api/scrape/route.ts` (submit) + `app/api/scrape/status/route.ts` (poll → write leads on completion). Both `runtime = "nodejs"`, short invocations.
- **Client invokes + polls:** after `enqueueJob({kind:"scrape", …})`, POST `/api/scrape { jobId }`, then poll `/api/scrape/status`. Two call sites: `sendTeamChat`'s `kind==='scrape'` branch and the agent page's `runScrape`. (The generic `getJob` poll may be reused instead of a dedicated status route if the status route folds the Firecrawl check into it — plan decides.)
- **New env key:** `FIRECRAWL_API_KEY`.
- **Scrape logic in TS:** a `lib/scrape/firecrawl.ts` (`server-only`) module holds the query/prompt builder, the Firecrawl calls, and the prospect→lead mapping. (The old Python `build_task`/`Prospect` concepts move here.)

**Dropped (relative to the browser-use design):**
- The **Python worker** (`worker/`), **browser-use**, **Browserbase** (+ its 2 keys), the headless browser, the Python/Vercel-function machinery, and **Vercel Pro**.
- **Per-step screenshots** and the **`job_steps.screenshot` migration** (no browser to screenshot). `job_steps` is unused by this path; progress = Firecrawl status counts surfaced through the job `result`.
- Graceful fallback when `FIRECRAWL_API_KEY` is unset: scrape returns a clear "scraping isn't configured" error (mirrors the Gemini-unconfigured pattern) — the rest of the app still runs.

**Constraints (documented):**
- **Firecrawl cost + rate limits** per scrape (search + extract credits). Scope `target` sensibly; consider a per-user rate cap later.
- **Public sources only**; quality depends on Firecrawl's discovery + extraction. Results still pass through the human **Pending** review gate, so bad extractions are filtered by the user, not shipped.

**Unchanged:** the `jobs` table, `enqueueJob` (with `icp`), the capability gate (`scrape` capability), the review gate + Leads → Pending, `getJob`, the `Prospect` shape, the ICP source, and team-chat routing.

---

## File map

| File | Change |
|---|---|
| `lib/scrape/firecrawl.ts` | **new** (`server-only`) — query/prompt builder, Firecrawl calls, prospect→lead mapping, dedup |
| `app/api/scrape/route.ts` | **new** — submit: auth → claim job → submit Firecrawl → store firecrawlJobId |
| `app/api/scrape/status/route.ts` | **new** — poll: check Firecrawl → on done, write leads (pending) + finish job |
| `lib/store.tsx` | `sendTeamChat`: POST `/api/scrape` + poll for `kind==='scrape'` |
| `app/agents/[id]/page.tsx` | `runScrape`: POST `/api/scrape` + poll (replaces the worker-dependent path) |
| `worker/` | retire from the deploy path (remove, or keep an optional local shim); no longer required |
| `.env.example` | add `FIRECRAWL_API_KEY`; remove any browser-worker vars |

---

## Verification

No unit-test framework — `npx tsc --noEmit` clean + manual (no migration needed):

- **Config probe:** with `FIRECRAWL_API_KEY` set, a single scrape from team chat (`@Emily find <ICP>`) and from Find-leads submits a Firecrawl job, the status poll reaches completion, and leads land in **Leads → Pending** (`source='scrape'`, `review='pending'`) with a `leadsFound` count in `getJob`.
- **Multi-user:** two users' scrape jobs are each `userId`-scoped; neither sees the other's leads or job.
- **Failure paths:** unauthenticated POST → rejected; another user's job → rejected; Firecrawl error/timeout → job `failed` with a short error, surfaced in the thread; `FIRECRAWL_API_KEY` unset → a clear "not configured" message, app otherwise fine.
- **No Pro / no worker:** the whole scrape flow runs on Vercel Hobby with no Python process running.
- `tsc` clean.

## Deferred

- The in-app scrape **progress/status view** (Firecrawl status → "searching… found N") — a small follow-on; no screenshots.
- "Scrape my own logged-in Facebook" (per-user browser extension) — future.
- Per-user scrape rate limits / credit budgeting; self-hosting Firecrawl.
