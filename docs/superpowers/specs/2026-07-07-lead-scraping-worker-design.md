# Milestone 2 · Spec 1 — Lead-Scraping Worker

Implement the real engine behind the existing `scrape` capability: a standalone
Python worker driving a real browser (via **browser-use** + Gemini) that finds
ICP-matched prospects and writes them into the `leads` table, triggered on-demand
from the app's "Find leads" button.

> Milestone 2 is split into two specs. **This is Spec 1** (the worker, engine,
> leads/schema, trigger, and step capture). **Spec 2** (later) builds the live
> "watch it navigate" UI, the send-path for no-email leads, and the `research`
> capability + Research Agent.

> Prior art this builds on:
> - Typed-agent harness — `docs/superpowers/specs/2026-07-07-typed-agents-and-team-templates-design.md`
> - Agent-creation architecture — `docs/architecture/agent-creation.md`
> - M1 outreach engine — `lib/ai/outreach.ts`, `app/api/jobs/run/route.ts`

---

## 1. Architecture — a separate Python worker, DB as the only integration surface

Playwright/browser-use cannot run inside the Next.js serverless `/api/jobs/run`
route. So scrape execution moves **out of Node entirely** into a standalone
**Python worker** that runs locally alongside the app.

```
  Next.js app (localhost:3001)                 Python worker (local process)
  ─────────────────────────────                ─────────────────────────────
  "Find leads" button                          poll loop (every few seconds)
    └─ enqueueJob(scrape) ──┐                     │
                            ▼                      ▼
                    ┌───────────────────────────────────┐
                    │           Neon Postgres            │
                    │  jobs · leads · job_steps · …      │   ← the ONLY shared surface
                    └───────────────────────────────────┘
                            ▲                      │
    getJob() poll ──────────┘                      ├─ writes leads (source='scrape')
    (UI shows progress)                            └─ writes job_steps + screenshots
```

- **No HTTP between the two.** They share nothing but the database (and the
  filesystem, for screenshot PNGs). The worker reads `jobs`, writes `leads` +
  `job_steps`; the app enqueues jobs and polls their status. This keeps the two
  languages fully decoupled — the contract is the schema.
- **The Node runner narrows to `outreach` only.** `app/api/jobs/run/route.ts`
  today claims *any* queued job for the user and has a catch-all "engine coming
  soon" branch. It changes to claim only `kind='outreach'`, so it never grabs a
  `scrape` job out from under the Python worker. The scrape branch is removed.
- **The "Find leads" trigger only enqueues.** Unlike outreach (where the browser
  POSTs `/api/jobs/run` to drive the run), the scrape trigger just inserts a
  `queued` job and returns. The Python worker — not the browser — executes it.
- **Worker down ⇒ job waits.** With no worker running, a scrape job simply stays
  `queued`; nothing breaks. The UI surfaces a gentle "waiting for the scraper
  worker" hint if a job doesn't advance.

---

## 2. The scrape engine (browser-use + Gemini)

The worker runs a **browser-use `Agent`** — an LLM (Gemini) that autonomously
drives a real Chromium via natural-language goals — to find prospects.

- **ICP source.** For a claimed job, the worker reads
  `agent_config.settings.scrape` for that `(userId, agentId)`: `industry`,
  `titles`, `geo` (written by the creation wizard). If absent/empty, it falls
  back to the agent's `goal`/`role` from the job's `params.agent`.
- **Targets.** The agent searches across **Reddit, public web, and open sources**,
  plus **Facebook on a best-effort basis** (see §3 for the authenticated-browser
  detail). It is told *which* platforms to prefer but chooses its own path.
- **Structured output.** browser-use returns a validated list of `Prospect`
  objects: `{ name, title, company, profileUrl, platform, email? }`.
  - `profileUrl` is **always** captured — it's the contact handle when there's
    no email.
  - `email` is **found-only**: included when it's visibly on the page, otherwise
    left blank. The engine never guesses or pattern-constructs an address.
- **Writing leads.** Each prospect becomes a `leads` row with `source='scrape'`,
  assigned to the scraping agent, **deduped by `profileUrl`** (per user+agent) so
  re-runs don't create duplicates.
- **Bounded runs.** A `target` count (default 10) and a max-steps cap bound each
  run — browser-use runs are slow and token-heavy, so runs stop at the target or
  the cap, whichever comes first. Blocked/anti-bot sources are **skipped, not
  fatal** — a run returns whatever it found.
- **Step emission.** During the run the worker captures a screenshot + caption
  after each browser action and writes them as `job_steps` rows (see §3), and
  keeps `jobs.result` updated with a running `{ leadsFound, steps }` tally.

---

## 3. Schema & step storage

### `leads` gains two columns (additive migration)

| Column | Type | Meaning |
|---|---|---|
| `profileUrl` | `text` (nullable) | Link to the prospect's profile/page — the contact handle. Always set for scraped leads. |
| `platform` | `text` (nullable) | Source label: `reddit` / `facebook` / `web` / … |

`email` already exists; it stays blank for most scraped leads. `source='scrape'`
distinguishes scraped leads from manual ones.

### New `job_steps` table — the "watch it navigate" data

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` pk | |
| `jobId` | `uuid` | the scrape job |
| `userId` | `uuid` | scoped like every other table |
| `idx` | `integer` | step order within the job |
| `caption` | `text` | what the agent is doing ("Searching r/fintech…") |
| `url` | `text` | current page URL |
| `screenshotPath` | `text` | e.g. `/runs/<jobId>/step-3.png` |
| `createdAt` | `timestamptz` | default now |

### Screenshots — static PNGs served by Next

The worker and app share the local filesystem, so screenshots are plain files,
not blobs or base64:

- The worker writes a **downscaled** PNG to
  `agentic-salesforce/public/runs/<jobId>/step-<idx>.png`.
- `job_steps.screenshotPath` stores the public path `/runs/<jobId>/step-<idx>.png`,
  which Next serves statically. Spec 2's UI renders `<img src={screenshotPath}>`.
- `public/runs/` is **gitignored**. Old run folders are prunable later (noted, not
  built now).

The worker writes each `job_steps` row + its PNG **during** the run (after each
step), so a future live view can poll and animate progress even though the render
UI itself is Spec 2.

### Authenticated browser — using the user's own Facebook session

Facebook (and most login-walled sources) require being signed in. The worker
therefore launches a **headed Chromium with a persistent profile** (a dedicated
`user-data-dir` at `worker/.browser-profile/`, gitignored):

- The user logs into Facebook (and any other platform) **once** in that
  browser; the cookies persist, so every subsequent run operates as the user on
  those platforms.
- Alternative (not the default): point browser-use at the user's *everyday*
  Chrome over CDP (`--remote-debugging-port`) to literally drive their real
  browser. Deferred unless requested — the persistent-profile approach is
  contained and doesn't collide with daily browsing.
- **Risk, explicitly accepted by the user:** automating a real logged-in
  Facebook account can trip Facebook's anti-automation terms and, worst case,
  temporarily restrict the account. Read-only scraping while logged in is lower
  risk than automated messaging, but it is the user's account. The persistent
  profile keeps this contained and opt-in (Facebook is only attempted when the
  profile is logged in; otherwise it's skipped like any other blocked source).

---

## 4. The "Find leads" trigger & worker lifecycle

### Trigger (Next.js)

- On the agent detail page (`app/agents/[id]/page.tsx`), the action buttons render
  **by capability**: a scrape-capable agent shows **"Find leads"**; an
  outreach-capable agent shows **"Run outreach"**. (This also resolves the
  deferred typed-agents follow-up where those buttons showed regardless of
  capability.)
- **"Find leads"** calls `enqueueJob({ agent, kind: 'scrape', capabilities, target })`
  — capability-gated (rejected if the agent lacks `scrape`) — inserting a `jobs`
  row (`kind='scrape'`, `queued`, `params: { agent, target }`). It does **not**
  POST `/api/jobs/run`.
- `enqueueJob` gains an optional `target` carried into `params`.
- After enqueue the button shows **"Finding leads…"** and the UI **polls
  `getJob(id)`** every ~2–3s. `job.result` carries the running `{ leadsFound,
  steps }` tally. On `done` → refetch the agent's leads and show the new scraped
  ones. If the job stays `queued`, the UI hints that the worker isn't running.
  (The live step-by-step screen is Spec 2; Spec 1's feedback is the tally +
  final count.)

### Worker lifecycle (Python)

1. **Poll** — `SELECT … FROM jobs WHERE status='queued' AND kind='scrape' ORDER BY created_at ASC LIMIT 1`.
2. **Claim** — `UPDATE jobs SET status='running', started_at=now() WHERE id=? AND status='queued' RETURNING id`; 0 rows ⇒ someone else claimed ⇒ skip.
3. **Run** — read ICP from `agent_config.settings.scrape`; run the browser-use
   Agent (Gemini, authenticated persistent browser); emit `job_steps` + PNG per
   action; write `leads` (dedup by `profileUrl`); keep `jobs.result` tallied.
4. **Finish** — `status='done'`, `result={ leadsFound, steps }`, `finished_at`.
   On error → `status='failed'` + `error`. One job at a time; extras stay queued.

The queue is the only coordination surface: click **Find leads** → job queued →
worker claims + runs (writing leads + step frames live) → UI polls to `done`.

---

## 5. Worker setup, verification, phasing

### The worker (`agentic-salesforce/worker/`)

Co-located with the app so it shares `.env.local` and can write to `../public/runs/`.

| File | Responsibility |
|---|---|
| `main.py` | poll → claim → orchestrate loop |
| `scraper.py` | browser-use Agent, `Prospect` output model, step emission |
| `db.py` | Neon access (psycopg/asyncpg): read `jobs`/`agent_config`, write `leads`/`job_steps` |
| `requirements.txt` | browser-use + deps |
| `README.md` | setup + run steps |

- **Setup (one-time):** create a venv, `pip install -r requirements.txt`,
  `playwright install chromium`, launch once and **log into Facebook** in the
  persistent profile; thereafter `python worker/main.py`.
- **Env:** reads `DATABASE_URL` + `GEMINI_API_KEY` from the app's `.env.local`.
- **Gitignored:** `worker/.venv/`, `worker/.browser-profile/`,
  `worker/__pycache__/`, `agentic-salesforce/public/runs/`.
- **Contract:** the worker's raw SQL reuses the **exact column names from
  `schema.ts`** — that's the cross-language contract; keep them in sync.

### Verification

No automated test suite (project convention). Verify by:

1. Migration applies (`leads` +`profileUrl`/`platform`; `job_steps` table).
2. Node runner narrowed: an `outreach` job still drafts; a `scrape` job is **not**
   claimed by `/api/jobs/run` (stays `queued`).
3. Start the worker (it drives its **own** Chromium, independent of any editor
   browser tooling) → "Find leads" on a Lead Scout with an ICP → job
   `queued`→`running`→`done`; real leads appear (`source='scrape'`,
   `profileUrl`/`platform` set, email only when on-page); dedup works;
   `job_steps` rows + PNGs written under `public/runs/<jobId>/`.
4. Capability-aware buttons: Lead Scout shows "Find leads" (not "Run outreach")
   and vice-versa; a mismatched enqueue is gated.
5. `tsc` clean on the Next side.

### Phasing (shape of the plan)

- **Phase A** — schema (`leads` +cols, `job_steps`) + migration; narrow the Node
  runner to `outreach` only.
- **Phase B** — the Python worker: `db.py` access + poll/claim loop + browser-use
  scrape engine (`Prospect` output, ICP task, authenticated browser) + writing
  leads + step emission; setup files (`requirements.txt`, `README.md`, gitignore).
- **Phase C** — the "Find leads" trigger (capability-aware buttons, `enqueueJob`
  `target`, enqueue-and-poll UI).

### Catalog note

`scrape` flips to `engineReady: true` in `lib/agentTypes.ts` once the engine
lands. The new `research` capability is **Spec 2**, not here.

### Deferred (Spec 2 / later)

- **Spec 2:** live watch-view UI (renders `job_steps`/screenshots); actionable
  send-path for no-email leads (drafted message + "Open profile" + copy, while
  email leads keep the M1 `mailto:` path); `research` capability + Research Agent
  + Gemini research-brief engine.
- **Later:** scheduler (recurring scrape runs); `follow-up` / `book-meeting`
  engines.

### Risks

| Risk | Mitigation |
|---|---|
| browser-use runs slow / token-heavy | bounded by `target` + max-steps cap |
| anti-bot / blocked sources | skipped, not fatal; run returns what it found |
| worker not running | jobs sit `queued`; UI hint |
| Python↔Node drift | worker SQL mirrors `schema.ts` column names |
| `public/runs` disk growth | prunable (noted) |
| Facebook account restriction | user-accepted; persistent profile keeps it contained/opt-in |
