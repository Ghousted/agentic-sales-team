# Vercel-Native Scraper — Design

Move lead scraping off the persistent Python worker and onto an **on-demand Vercel Python serverless function** that drives a **hosted cloud browser (Browserbase)** with browser-use. Goal: the whole app — including scraping — deploys to **Vercel only**, works **multi-user** (public sources, not tied to any login), and needs **no second always-on host**.

> Supersedes the deploy path of the M2 lead-scraping worker. Keeps browser-use, the `Prospect` model, `build_task`, `READ_ONLY_GUARD`, the jobs table, the capability gate, and the Leads → Pending approval gate.
> **Public sources only** this round. "Scrape my own logged-in Facebook" stays deferred to a future browser-extension approach.

---

## Why

The persistent worker (`while True` poll + headed local Chrome + persistent profile) **cannot run on Vercel serverless** — no long-lived process, no display, hard time limits. Public-web scraping isn't tied to any user's login, so it can run **centrally in a serverless function** for all users, scoped by `userId`. That collapses the deployment to a single Vercel project.

---

## Part A — Architecture

```
scrape enqueued (team chat @mention or agent Find-leads)  →  jobs row (queued, userId, params.icp)
        │  client POSTs /api/scrape { jobId } (fire-and-forget; session cookie carries auth)
        ▼
/api/scrape  — a Vercel Python Function (api/scrape.py + vercel.json runtime), NOT a Next route
   1. verify session JWT (HS256 + AUTH_SECRET) → userId; load job; assert job.userId === userId
   2. atomically mark running:  UPDATE jobs SET status='running' WHERE id=? AND userId=? AND status='queued' RETURNING
   3. create a Browserbase session → remote CDP connectUrl
   4. browser-use (ChatGoogle gemini-2.5-flash, thinking_budget=0) drives that remote browser
      over PUBLIC sources for the ICP → structured Prospects
   5. write each as a lead (review='pending') + a job_steps row per browser step (caption, url, base64 screenshot)
   6. close the Browserbase session; mark job done (or failed on error)
        ▼
existing getJob poll shows progress + the "Found N leads → Pending" status line; leads await accept/dismiss
```

- **Single deploy:** the Python function is a Vercel Function co-located with the Next app in the same project. Browserbase/Neon/Gemini are **APIs called**, not deployments.
- **Non-persistent:** the function runs only while a scrape is in flight.
- **Multi-user:** one function serves everyone; every invocation is `userId`-scoped. No per-user machine.

---

## Part B — Function internals

Reuse the existing worker logic; swap the browser + the storage.

- **Reused as shared modules:** `scraper.py` (`build_task`, `run_scrape`, `Prospect`/`Prospects`, `READ_ONLY_GUARD`, the `on_step` callback) and `db.py` (`insert_lead`, `insert_job_step`, `update_job_result`, `finish_job`/`fail_job`, `get_scrape_settings`, `lead_exists`). Deleted: `main.py`'s `while True` loop + `claim_next_scrape_job` (replaced by per-job invocation).
- **Browser → Browserbase over CDP.** Replace `BrowserProfile(user_data_dir=…, headless=False)` with: create a Browserbase session (their SDK/API → CDP `connectUrl`), connect browser-use to that `cdp_url`, and **close the session in a `finally`** so paid sessions never leak. Headless cloud browser, public pages, no profile/login. *(Verify the exact browser-use remote-CDP connect API against 0.13.3 in the plan — probe it before writing code.)*
- **Screenshots → DB.** Vercel `public/` is read-only, so drop `_save_screenshot` → filesystem. `insert_job_step` writes the downscaled frame as **base64 into a new `job_steps.screenshot` column** (plus `caption` + `url`). This is required for Vercel and unblocks a future in-app "watch it scrape" view.
- **Auth + scoping.** The handler verifies the session JWT (PyJWT, HS256, `AUTH_SECRET`) → `userId`, loads the job, asserts ownership, and atomically claims it (the `status='queued'` guard prevents a double-POST double-run). ICP: prefer `params.icp`, else `agent_config.settings.scrape`/goal (already built).
- **Lifecycle:** update `result` counters (`steps`, `leadsFound`) per step; `finish_job` on success; `fail_job` (with a short error) on any throw or timeout.

---

## Part C — App-side changes + constraints

**Changes:**
- **Migration:** add `job_steps.screenshot` text column (base64).
- **Client invokes the function:** after `enqueueJob({kind:"scrape", …})`, the client POSTs `/api/scrape { jobId }` (fire-and-forget). Two call sites: `sendTeamChat`'s job handling when `kind==='scrape'`, and the agent page's `runScrape`. The `getJob` progress poll is unchanged.
- **Retire the persistent worker from the deploy path:** remove `main.py`'s poll loop + `claim_next_scrape_job`; keep `scraper.py`/`db.py` as shared logic the function imports. (An optional thin local-run shim may stay for dev.)
- **New env keys:** `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID`.
- **`vercel.json`:** register the Python runtime for `api/scrape.py` and set `maxDuration` (e.g. 300 on Pro).

**Constraints (documented, not hidden):**
- **Vercel Pro required** for a usable `maxDuration` (Hobby's 60s is too short). Each scrape scoped **small** (low `target`); a timeout → `failed`, retry smaller.
- **Bundle-size risk:** the function + `browser-use` deps must fit Vercel's ~250MB unzipped limit. Remote browser means no bundled Chromium, but **verify with a probe deploy first** (hello-world `api/scrape.py` importing `browser_use` + a Browserbase connect) before building the rest.
- **Per-scrape cost** (Browserbase + Gemini steps) and **agentic fragility**. **Public sources only.**

**Unchanged:** the `jobs` table, `enqueueJob` (with `icp`), the capability gate, the review gate + Leads → Pending, `getJob`, the `Prospect` model, `build_task`, `READ_ONLY_GUARD`.

---

## File map

| File | Change |
|---|---|
| `api/scrape.py` | **new** — the Vercel Python Function handler (auth → claim → Browserbase → run → persist) |
| `vercel.json` | **new/edit** — Python runtime + `maxDuration` for `api/scrape.py` |
| `worker/scraper.py` | Browserbase CDP connect (was local headed Chrome); shared by the function |
| `worker/db.py` | `insert_job_step` stores base64 screenshot; add JWT-verify + job-load helpers |
| `worker/main.py` | remove poll loop + `claim_next_scrape_job` (or reduce to an optional local shim) |
| `lib/db/schema.ts` + migration | add `job_steps.screenshot` |
| `lib/store.tsx` | `sendTeamChat`: POST `/api/scrape` for `kind==='scrape'` |
| `app/agents/[id]/page.tsx` | `runScrape`: POST `/api/scrape` after enqueue |
| `.env.example` | document `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID` |

---

## Verification

No unit-test framework — `npx tsc --noEmit` clean + manual (one migration):

- **Probe first:** a minimal `api/scrape.py` deploys to Vercel, imports `browser_use`, and opens+closes a Browserbase session within `maxDuration`. (De-risks bundle size + connectivity before the full build.)
- **Local:** run a scrape from team chat (`@Emily find <ICP>`) and from the agent Find-leads button → the function runs → leads land in **Leads → Pending** with `review='pending'` → `job_steps` rows carry base64 screenshots → `getJob` reaches `done` with a `leadsFound` count.
- **Multi-user:** two users' scrape jobs are each scoped to their own `userId`; neither sees the other's leads/steps.
- **Failure paths:** unauthenticated POST → rejected; a job belonging to another user → rejected; a timeout/throw → job `failed` with an error, Browserbase session closed.
- `tsc` clean.

## Deferred

- The in-app "watch it scrape" live view (now unblocked by DB-stored screenshots) — separate slice.
- "Scrape my own logged-in Facebook" (per-user browser extension) — future.
- Auto-retry/backoff and per-user scrape rate limits.
