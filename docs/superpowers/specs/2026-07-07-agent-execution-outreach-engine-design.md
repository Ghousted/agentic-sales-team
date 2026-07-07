# Agent Execution — Milestone 1: Outreach Engine + Leads Module

**Date:** 2026-07-07
**Status:** Approved design, ready for implementation plan
**Scope:** First milestone of the "make the agents actually work" initiative.

## Context

The Agentic Salesforce app is a real Next.js product (Neon Postgres + Drizzle, Gemini
API, cookie/JWT auth). Every design-derived feature is real and persisted, but the
agents themselves do not *do* anything yet: the Leads / Emails / Reach Outs / Tasks /
Performance / Memory sub-tabs, the dashboard hero, and analytics are all rendered from
**synthetic, deterministic-but-fake** content (`lib/agentDetail.ts` and per-page
derivations). This initiative replaces that with real agent execution.

The `geminiGenerate()` primitive (Gemini 2.5-flash, `thinkingBudget: 0`) already exists
in `lib/ai/gemini.ts` and powers `chatReply`. That is the "agent brain" building block
this milestone builds on.

### Decisions locked during brainstorming

- **Reality level:** a real Gemini engine that produces **real email drafts**. The human
  sends with one click via a pre-filled `mailto:` (subject + body already composed). No
  external email API, OAuth, or deliverability infra.
- **Lead source (long term):** a headless-browser (Playwright) web-scraping agent. **That
  is milestone 2** — out of scope here.
- **Execution model:** on-demand runs now, designed so a scheduler can drive the same
  jobs later.
- **First milestone (this spec):** Foundation (data model + job/worker seam) + Outreach
  engine + one-click send, over leads added manually through a dedicated **Leads module**.

## Goal of this milestone

An agent can, on demand, work a real list of leads: qualify/score each one, draft a
personalized outreach email with Gemini, and surface it in the UI where the user opens it
pre-filled in their mail client and marks it sent — advancing the lead through a real
pipeline. The **Leads** and **Emails** sub-tabs render real records instead of the
synthetic model.

## Out of scope (named so nothing is oversold)

- The Playwright scraper (milestone 2 — the real automated lead source).
- Scheduled / continuous autonomy (the scheduler driving jobs).
- Permission-toggle enforcement (gating whether an agent may draft autonomously, book
  meetings, make calls). The toggles remain display-only this milestone.
- Wiring the remaining synthetic surfaces to real activity: Reach Outs, Tasks,
  Performance, Memory tabs, plus the dashboard hero and analytics derivations. Only Leads
  + Emails become real here; `activity` rows are written now so those surfaces can consume
  them later.
- Real email deliverability / verification. `mailto:` uses the user's own mail client;
  there is no sending infrastructure and no bounce handling.

## Architecture overview

```
Add lead (form)                         Run outreach (button)
      |                                        |
      v                                        v
 lib/leads/actions.ts                 lib/jobs: enqueueOutreachJob()
 (addLead → leads table)              (insert jobs row, status=queued)
      |                                        |
      |                          fire-and-forget fetch → /api/jobs/run
      |                                        |
      |                          claim job (atomic) → for each lead:
      |                          lib/ai/outreach.draftOutreach(agent, lead)
      |                          → outreach_drafts + activity + lead.status
      v                                        v
  /leads page  <----- per-view fetch -----  Emails/Leads sub-tabs
  (all leads, filters)                     (agent-scoped real records)
                                                 |
                                    "Open in mail" (mailto)  "Mark sent"
                                                 |                |
                                          user's mail client   draft=sent,
                                          pre-filled           stage advance,
                                                               activity logged
```

Leads are a **first-class module**: `lib/leads` owns the lead lifecycle, `/leads` is its
home page, and agents *consume* leads from it. The per-agent Leads tab is a filtered view
of the same `leads` table (`agentId` = that agent), not a separate dataset.

## Data model

Four new Drizzle tables, following the existing per-user pattern (all FK to `users` with
`onDelete: cascade`; `agentId` is a plain text agent code, matching how seed + created
agents are keyed everywhere else). Pipeline `status` and `score` reuse the exact vocab
already in `lib/agentDetail.ts` so real data drops into existing UI shapes.

### `leads`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK (defaultRandom) | |
| userId | uuid FK users | cascade |
| agentId | text | which agent works this lead |
| name | text | |
| title | text | |
| company | text | |
| email | text | used by the `mailto:` send |
| status | text | `new` → `contacted` → `engaged` → `replied` → `meeting` |
| score | integer | 0–100, set by the engine (0 until first run) |
| source | text | `manual` now; `scrape` in milestone 2 |
| createdAt | timestamptz default now | |
| updatedAt | timestamptz default now | bumped on stage change |

### `outreach_drafts`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| userId | uuid FK users | cascade |
| agentId | text | |
| leadId | uuid FK leads | cascade |
| subject | text | Gemini-written |
| body | text | Gemini-written |
| rationale | text | the angle the engine chose |
| status | text | `draft` → `sent` |
| createdAt | timestamptz default now | |
| sentAt | timestamptz nullable | set by "Mark sent" |

### `activity`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| userId | uuid FK users | cascade |
| agentId | text | |
| type | text | `lead_added` / `lead_qualified` / `email_drafted` / `email_sent` |
| leadId | uuid nullable | |
| text | text | human-readable summary |
| createdAt | timestamptz default now | |

### `jobs`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| userId | uuid FK users | cascade |
| agentId | text | |
| kind | text | `outreach` now; `scrape` in milestone 2 |
| status | text | `queued` → `running` → `done` / `failed` |
| params | jsonb | `{ leadIds?: string[], batchSize: number }` |
| result | jsonb nullable | `{ draftsCreated, skipped, failed }` progress/summary |
| error | text nullable | |
| createdAt | timestamptz default now | |
| startedAt | timestamptz nullable | |
| finishedAt | timestamptz nullable | |

Migration generated via `pnpm db:generate` and applied with the existing
`scripts/migrate.mjs` runner (`pnpm db:migrate`).

## The job/worker seam & run flow

A job queue exists because drafting a batch is N Gemini calls (~20–60s) — too long to
block a request — and it is the exact seam the Playwright scraper and the scheduler plug
into later without changing anything upstream.

1. **Trigger** — "Run outreach" on an agent, or a bulk action in the Leads module, calls
   the server action `enqueueOutreachJob(agentId, leadIds?)`, which inserts one `jobs` row
   (`kind='outreach'`, `status='queued'`, `params={leadIds, batchSize}`) and returns the
   job id. It then issues a fire-and-forget `fetch('/api/jobs/run')` to kick the runner.
2. **Claim** — the runner **drains the queue**: it repeatedly claims the next `queued`
   job (bounded by a max-jobs-per-invocation cap) with an atomic
   `UPDATE jobs SET status='running', startedAt=now() WHERE id=? AND status='queued'
   RETURNING *` until none remain. The `status='queued'` guard guarantees two runners can
   never grab the same job, so this is safe whether triggered by an enqueue's
   fire-and-forget fetch or, later, a cron tick.
3. **Run** — for each lead in the batch (respecting `batchSize`, default 5): call
   `draftOutreach(agent, lead)`, then write an `outreach_drafts` row + an `activity` row
   (`email_drafted`), set `leads.score`/`leads.status` from the result, and update the
   job's `result` progress. Leads that already have a `draft`-status draft are skipped
   (idempotent re-runs).
4. **Finish** — `status='done'` with a `result` summary, or `status='failed'` + `error`
   only if *every* lead errored.
5. **Poll** — the UI polls job status (a `getJob(id)` action). The Run button shows
   running → done; on done, the Leads/Emails views refetch and show the new records.

**Runner placement — now vs. later.**
- **This milestone:** the runner is a Next.js **Node-runtime route handler**
  (`app/api/jobs/run/route.ts`, `export const runtime = 'nodejs'`, extended
  `maxDuration`), kicked by the fire-and-forget fetch after enqueue. It runs in `next dev`
  and on a Node host; on serverless it is bounded by the platform max duration, which is
  fine for small Gemini batches.
- **Milestone 2+ (scraper / scheduler):** the *same* claim-and-run logic moves into a
  standalone long-running **worker service** (a Node process that can drive Playwright)
  polling the `jobs` table; a cron just inserts `jobs` rows. `enqueueOutreachJob` and the
  `jobs` table are unchanged — only *who* runs the loop changes.

## The outreach engine (Gemini)

Per lead, one **structured** Gemini call both qualifies and drafts:

```
draftOutreach(agent, lead) → { score: 0-100, stage, subject, body, rationale }
```

- **Inputs:** the agent's real config — role, goal, and ICP targeting (industry, size,
  titles, geography from the Configuration tab) — plus the lead's `{name, title, company,
  email}`.
- **Qualify/score:** rate fit (0–100) against the agent's ICP + goal, pick a pipeline
  `stage`, give a one-line `rationale`. The returned `stage` is one of the `leads.status`
  values (`new`/`contacted`/`engaged`/`replied`/`meeting`) and is written to
  `leads.status` — "stage" and "status" are the same pipeline field, named `status` on the
  table.
- **Draft:** write a personalized cold email (`subject` + `body`) in the agent's voice,
  addressed to the lead by name/title/company and tied to the agent's goal.

**Personalization honesty:** the draft is personalized only from the lead's *provided*
fields (title, company, industry). The model reasons a sensible angle but has **no real
web research** on the company this milestone — deep per-company research is what the
scraper/enrichment milestone adds, and draft quality steps up then. The spec states this
plainly so the first drafts are not oversold.

**New code:**
- `lib/ai/gemini.ts` gains `geminiJSON(system, turns, schema)` using Gemini's JSON
  response mode (`responseMimeType: 'application/json'` + a response schema), with
  defensive parsing and a fallback to a minimal valid object on malformed output.
- `lib/ai/outreach.ts` owns `draftOutreach()` and its prompt, separate from `chatReply`,
  reusing the same Gemini client.

**Failure handling:** a lead whose call fails is skipped and logged (sub-result `failed`),
and the run continues; the job is `done` with a partial summary, `failed` only if every
lead errored. One bad lead never sinks the batch.

**Permissions this milestone:** the engine always *drafts* and the human always *sends*,
so nothing is auto-sent regardless of the toggle state. Enforcing the permission toggles
is deferred to the enforcement milestone.

## UI & human-in-the-loop send

### Leads module — `app/leads/page.tsx`
- A **"Leads"** item is added to the sidebar nav in `components/Shell.tsx` (alongside
  Dashboard / Agents / Chats / Analytics).
- A central table of all leads: Name/title, Company, Agent, Stage, Score, Source, Last
  activity — with filters by agent / stage / source.
- An **Add lead** form (name, title, company, email, assign-to-agent).
- Per-row and bulk **"Run outreach"** (enqueues the job).
- Clicking a lead opens a drawer showing its drafts, activity, and stage controls.

### Emails tab (agent detail) — real drafts
- The synthetic `emailStats` / `emailTimeline` are replaced by that agent's real
  `outreach_drafts`.
- Each draft shows subject, body, recipient (`to: name · company`), status, timestamp,
  with **two** buttons:
  - **"Open in mail"** → `mailto:{email}?subject={enc}&body={enc}` opens the user's mail
    client fully pre-filled. Composing only — no state change.
  - **"Mark sent"** → sets the draft `sent` + `sentAt`, logs `email_sent` activity,
    advances the lead's stage (`new → contacted`).
- Two separate actions (not one) because opening the mail client is not proof the user
  hit send, so the state change is explicit. This keeps the data honest.

### Leads tab (agent detail) — real, scoped
- Replaced by real `leads` where `agentId` = that agent, same table shape as today, with a
  link out to the full Leads module.

### Data fetching
- Leads and drafts are fetched **per view** via `lib/leads` server actions / server
  components — *not* hydrated into the global client store (which stays for the small
  agents/teams sets). Lead volume grows over time, so global hydration would bloat the
  store; per-view fetch keeps it lean and always fresh after a run.

## Module boundaries

- `lib/leads/actions.ts` — lead lifecycle: `addLead`, `updateLead`, `assignLead`,
  `setStage`, `listLeads(filter)`, `getLead(id)`. Sole owner of `leads` reads/writes.
- `lib/ai/outreach.ts` — `draftOutreach(agent, lead)`. Pure engine; no DB.
- `lib/ai/gemini.ts` — transport, now with `geminiJSON`.
- `lib/jobs/actions.ts` — `enqueueOutreachJob`, `getJob`. `app/api/jobs/run/route.ts` —
  the claim-and-run loop; owns `jobs` + writes `outreach_drafts`/`activity`/lead updates
  by calling `lib/leads` + `lib/ai/outreach`.
- `app/leads/page.tsx` — Leads module UI. `app/agents/[id]/page.tsx` — Emails + Leads
  tabs consume `lib/leads`.

Each unit has one purpose, a small interface, and can be reasoned about independently.

## Verification

Browser + DB, before each commit (matching how the rest of the app was validated; no
automated suite exists yet):

1. Migration applies to Neon; `/leads` Add-lead form persists a row (survives reload).
2. "Run outreach" → job `queued` → claimed → real drafts created → job `done`; a draft's
   subject/body are genuinely personalized to that lead.
3. Emails tab shows the draft; "Open in mail" opens a compose window with correct
   to/subject/body; "Mark sent" flips status, advances stage, logs activity.
4. Leads module lists all leads with working filters; agent Leads tab shows only its
   scoped leads.
5. Per-user isolation: a second account sees none of another user's leads/drafts.
6. Failure path: a forced Gemini error on one lead → that lead skipped, batch still
   `done`.

Optional later: tiny pure-function checks for the `geminiJSON` parser fallback and the
atomic job-claim idempotency.

## Risks & mitigations

- **Runner duration on serverless** — small batches (default 5) stay within platform
  limits; larger batches or Playwright force the externalized worker (milestone 2), which
  the seam already anticipates.
- **Malformed Gemini JSON** — `geminiJSON` parses defensively and falls back; a failed
  lead is skipped, not fatal.
- **Draft quality without research** — stated honestly; improves with the
  scraper/enrichment milestone.
- **Double-processing a job** — prevented by the atomic `WHERE status='queued'` claim.

## Milestone sequence (for context)

1. **This spec** — Foundation + Outreach engine + one-click send + Leads module.
2. Playwright scraping lead-gen agent (real automated lead source) + externalized worker.
3. Wire remaining synthetic surfaces (Reach Outs / Tasks / Performance / Memory,
   dashboard hero, analytics) to real `activity` + records.
4. Permission-toggle enforcement.
5. Scheduled autonomy (cron → jobs).
