# Sales Capabilities Expansion — Qualify (real) + Placeholders

Expand the sales capability set. **Qualify** is built as a real, working engine (triage/score the book so agents prioritize hot leads). **Enrich · Nurture · Social sell · Reply handling · Proposal** are added to the catalog as **placeholders** — selectable in the wizard, routable in the team chat, replying *"coming soon"* until engines exist (exactly like `follow-up`/`book-meeting` today).

> Reuses the capability model in `lib/agentTypes.ts` (id === `jobs.kind`, `engineReady` gates execution), the job runner, the chat intent/routing, and the leads store. The schema already has a `score` column and a `lead_qualified` activity type reserved for Qualify — **no migration**.

---

## The new capabilities

| id | label | engineReady | notes |
|---|---|---|---|
| `qualify` | Lead qualification | **true** | built here — scores accepted leads hot/warm/cold |
| `enrich` | Contact enrichment | false | placeholder; next to make real (needs a Firecrawl lookup) |
| `nurture` | Nurture sequences | false | placeholder |
| `social` | Social selling | false | placeholder |
| `reply` | Reply handling | false | placeholder |
| `proposal` | Proposal / quotes | false | placeholder |

Placeholders need **only** a catalog entry + the intent enum — the existing `engineReady:false` path (chat `actWith` replies "coming soon," no job enqueued) handles the rest. No engine, runner, or UI for them.

---

## Part A — Catalog (`lib/agentTypes.ts`)

- Extend `Capability` union with the 6 new ids.
- Add the 6 `CAPABILITIES` entries (labels/descs above; `qualify` → `jobKind:"qualify", engineReady:true`; others `engineReady:false`).
- Add an agent type **`qualifier`** ("Lead Qualifier — scores & triages the book", capabilities `["qualify"]`) and add `qualify` to the **`sdr`** type's capabilities (an SDR qualifies its own book).
- Add a team template **`qualify`** (label "Qualify & Prioritize", requiredCapabilities `["qualify","outreach"]`) — optional, keeps the picker coherent.

## Part B — Qualify engine (`lib/ai/qualify.ts`, `server-only`)

`qualifyLead(agent: AgentSnapshot, lead: {name; title; company; email; research?: ResearchBrief|null}): Promise<QualifyResult>` where **`QualifyResult = { score: number /*1-100*/; tier: "hot"|"warm"|"cold"; reason: string }`** (add to `lib/leads/types.ts`).
- One `geminiJSON` call: score the lead's fit/intent (BANT/ICP) from its title/company (+ the research brief when present); return a 1-100 score, a tier, and a one-line reason. `score` is clamped to **≥ 1** (so `0` always means "not yet qualified").
- Canned fallback when Gemini is unconfigured (e.g. 55/"warm"/"heuristic"). Pure — no DB.

## Part C — Qualify job wiring

- **Leads store (`lib/leads/store.ts`):**
  - `pickLeadsForQualify(userId, agentId, leadIds?, batchSize)` — accepted teammate leads with **`score = 0`** (not yet qualified), oldest first, capped (idempotent re-runs, mirrors `pickLeadsForRun`).
  - `applyQualifyResult(userId, agentId, lead, result)` — set `leads.score = max(1, result.score)`; log an `activity` `lead_qualified` with the reason. (Tier is derived from score at display — no column.)
- **Runner (`app/api/jobs/run/route.ts`):** add `qualify` to the claimed kinds (`inArray(jobs.kind, ["outreach","research","qualify"])`) and a `qualify` branch: `pickLeadsForQualify` → `qualifyLead` → `applyQualifyResult`; mark done with `result: { qualified, failed }`. Pod chaining unaffected (`qualify` isn't in `POD_ORDER`).
- **Intent (`lib/ai/intent.ts`):** add `qualify` + the 5 placeholders to the enum + a system-prompt line each ("qualify: score/prioritize existing leads (hot/warm/cold)"; the placeholders one line each). The chat then routes `qualify` to a capable agent (runs it) and the placeholders to "coming soon."

## Part D — Qualify UI (`app/agents/[id]/page.tsx`)

- For a `qualify`-capable agent, add a **"Qualify leads"** action (next to Research / Run outreach) that enqueues a `qualify` job, POSTs `/api/jobs/run`, and refetches the workbook — mirroring `runResearch`.
- Show a **tier chip** on each lead in the agent's Leads section, derived from `score` (`≥75` Hot / `≥50` Warm / `>0` Cold / `0` "—"). The score column already exists.

---

## File map

| File | Change |
|---|---|
| `lib/agentTypes.ts` | 6 new capabilities; `qualifier` type; `qualify` on `sdr`; optional `qualify` template |
| `lib/leads/types.ts` | `QualifyResult` type |
| `lib/ai/qualify.ts` | **new** — `qualifyLead` engine (Gemini JSON + fallback) |
| `lib/leads/store.ts` | `pickLeadsForQualify` + `applyQualifyResult` |
| `app/api/jobs/run/route.ts` | claim `qualify` + a `qualify` runner branch |
| `lib/ai/intent.ts` | add `qualify` + 5 placeholders to the enum + prompt |
| `app/agents/[id]/page.tsx` | "Qualify leads" action + tier chip |

---

## Verification

No unit-test framework — `npx tsc --noEmit` clean + manual (no migration):

- **Qualify works:** on a qualify-capable agent with accepted (unscored) leads, "Qualify leads" → each lead gets a real score + tier chip; the activity log shows `lead_qualified` with reasons; re-running skips already-scored leads.
- **Chat:** `@agent qualify the leads` runs the real qualify job; `@agent enrich these` / nurture / social / reply / proposal → "coming soon" (no job).
- **Wizard/types:** the new capabilities are selectable (Custom + the `qualifier` type); a scrape-capable agent's ICP requirement is unaffected.
- **Placeholders enqueue nothing** (`engineReady:false`); the runner never claims them.
- `tsc` clean.

## Deferred

- Real engines for `enrich` (Firecrawl lookup → fill missing email/title/company — the clear next one), `nurture`, `social`, `reply`, `proposal`.
- A dedicated pod stage / `POD_ORDER` slot for `qualify` (qualify→outreach auto-chain) — this slice runs qualify on demand only.
- Sorting/filtering the Leads module by tier.
