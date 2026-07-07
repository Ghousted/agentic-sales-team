# Typed Agents & Team Templates — Design

**Date:** 2026-07-07
**Status:** Approved design, ready for implementation plan
**Sequence:** Comes **before** Milestone 2 (the Playwright scraper) — the scraper attaches to the `scrape` capability this introduces.

## Context

The Agentic Salesforce app currently models agents with a **cosmetic `role` string** (SDR / BDR / Account Executive / Sales Manager / Customer Success / Recruiter) that carries no behaviour — the onboarding wizard just picks a role label, and every agent is otherwise identical. Milestone 1 built a real outreach loop (a `jobs` queue + a Gemini drafting engine, `jobs.kind = "outreach"`), and Milestone 2 will add web scraping (`jobs.kind = "scrape"`).

This redesign turns agents into a **proper harness for a sales team**: each agent becomes a functional, sales-suited **type** whose behaviour is a **preset bundle of capabilities**, where each capability maps to a job kind/engine. Teams become **templates** that require certain capabilities and guide the user to create fitting agents when coverage is missing.

### Decisions locked during brainstorming
- **Two-layer model:** *capabilities* are engine-backed atoms (one per `jobs.kind`); *agent types* are preset harnesses that bundle capabilities + default settings + display identity.
- **Catalog** keeps the classic sales roles (given preset behaviours) and adds capability-focused types. **No "Email Sender" type** — email stays manually sent (human-in-the-loop `mailto`).
- **Custom agent type:** the user hand-picks capabilities (freedom hatch beyond presets).
- **Team templates** require capabilities; the create-team flow is a **guided prompt** — it shows coverage, and for each gap offers an inline "create a fitting agent" — **non-blocking** (you can create the team with gaps flagged).
- **Wizard order:** Identity (name) first, then Type, Appearance, Settings, Goal.
- **Static catalog in code** (`lib/agentTypes.ts`), not a runtime CMS.

## Goal

An agent is created by picking a **type** (or Custom), which determines its **capabilities** and the **settings** it collects; it can only run jobs for capabilities it has. Teams are created from **templates** that declare required capabilities, with live coverage and guided inline creation of missing agents. The `outreach` capability keeps working exactly as Milestone 1 built it; `scrape` is ready for Milestone 2 to fill in.

## Out of scope (named so nothing is oversold)
- The `scrape` engine itself (Milestone 2). This spec only introduces the `scrape` **capability/type/settings** it will attach to.
- Real engines for `follow-up` and `book-meeting` — these are **harness-only** here: real, selectable types with persisted settings, but running such a capability is a no-op with an "engine coming soon" note until a later milestone.
- Permission-toggle enforcement (still deferred, as in M1).
- Any runtime-editable catalog (types/templates stay developer-curated in code).

## Capability & type-preset catalog

### Capabilities (atoms; each === a `jobs.kind`)
| Capability | Does | Engine |
|---|---|---|
| `scrape` | Find & import ICP-matched leads | Milestone 2 |
| `outreach` | Qualify/score + draft personalized emails | **Built (M1)** |
| `follow-up` | Draft re-engagement to non-repliers / cold leads | later (reuses outreach engine with a follow-up prompt) |
| `book-meeting` | Propose times & book on positive replies | later (calendar) |

`CAPABILITIES` records `{ id, label, desc, jobKind, engineReady }` where `jobKind === id` and `engineReady` is `true` only for `outreach` at this milestone (and `scrape` once M2 lands).

### Agent types (presets bundling capabilities)
| Type id | Label | Capabilities |
|---|---|---|
| `sdr` | SDR | scrape + outreach + follow-up |
| `bdr` | BDR | outreach + follow-up |
| `ae` | Account Executive | outreach + book-meeting |
| `csm` | Customer Success | follow-up |
| `recruiter` | Recruiter | scrape + outreach |
| `manager` | Sales Manager | *(none — orchestrate/report)* |
| `scout` | Lead Scout | scrape |
| `writer` | Outreach Writer | outreach |
| `followup` | Follow-up Agent | follow-up |
| `custom` | Custom | *(user-selected; `custom: true`)* |

An agent runs jobs **only** for the capabilities its type grants. Types whose engine isn't built yet still create real, fully-configured agents; their runs light up when the engine lands.

### Team templates (require capabilities)
| Template id | Label | Required capabilities |
|---|---|---|
| `outbound` | Outbound | scrape + outreach + follow-up |
| `leadgen` | Lead-Gen / Research | scrape |
| `enterprise` | Enterprise / Named Accounts | outreach + book-meeting |
| `fullcycle` | Full-Cycle Pod | scrape + outreach + follow-up + book-meeting |
| `nurture` | Nurture / Re-engagement | follow-up + outreach |
| `meetings` | Meeting-Booking / SDR→AE | outreach + book-meeting |
| `recruitment` | Recruitment | scrape + outreach |
| `success` | Customer Success | follow-up |
| `custom` | Custom | *(none — freeform)* |

`TEAM_TEMPLATES` records `{ id, label, desc, requiredCapabilities: Capability[] }`. A required capability is **covered** if any team member's `capabilities` includes it.

## Data model

**New static catalog — `lib/agentTypes.ts`** (developer-curated, mirrors the `AGENTS_BASE`/`TEAMS_BASE` pattern):
```ts
export type Capability = "scrape" | "outreach" | "follow-up" | "book-meeting";
export const CAPABILITIES: { id: Capability; label: string; desc: string; jobKind: string; engineReady: boolean }[];

export interface AgentType { id: string; label: string; desc: string; capabilities: Capability[]; custom?: boolean }
export const AGENT_TYPES: AgentType[];        // the 10 rows above
export function typeById(id: string): AgentType | undefined;

export interface TeamTemplate { id: string; label: string; desc: string; requiredCapabilities: Capability[] }
export const TEAM_TEMPLATES: TeamTemplate[];   // the 9 rows above
export function templateById(id: string): TeamTemplate | undefined;
```

**Schema changes** (additive; `pnpm db:generate` + `pnpm db:migrate`):
- `agents` (created agents): add `type text not null default 'custom'`, `capabilities jsonb $type<string[]> not null default '[]'`.
- `agent_config` (per-user overrides for any agent): add `settings jsonb $type<Record<string, Record<string, unknown>>>` — a per-capability settings map, e.g.
  `{ scrape: { industry, size, titles, geo, batchSize }, outreach: { tone, angle, dailyCap }, "follow-up": { touches, spacingDays, stopOnReply }, "book-meeting": { lengthMins, availability } }`.
  This is where the ICP the wizard already collects (`wIndustry`/`wSize`/`wTitles`/`wGeo`) finally persists.
- `teams` (created teams): add `template text not null default 'custom'`.

**Type changes** (`lib/types.ts`):
- `Agent` gains `type: string` and `capabilities: string[]`. `role` stays as the human display label (set to the type's `label`), so the existing role-based logic in `lib/agentDetail.ts` keeps working unchanged.
- `Team` gains `template: string`.

**Static seed tagging** (no DB migration needed — `AGENTS_BASE`/`TEAMS_BASE` are code):
- Tag each seed agent with `type` + `capabilities` by its current role: Sarah/Emily/Ava (SDR)→`sdr`; Michael (BDR)→`bdr`; Ryan (AE)→`ae`; Noah→`manager`; Priya→`csm`; Leo→`recruiter`.
- Tag each seed team with a `template`: North America SDR→`outbound`, Outbound Team→`outbound`, Enterprise Team→`enterprise`, Recruitment Team→`recruitment`.

**Backfill of pre-existing DB rows** (created before this migration): new columns take their defaults (`type='custom'`, `capabilities='[]'`, `template='custom'`). A one-time backfill (a `scripts/*.mjs` step, run after the migration) sets `agents.type`/`capabilities` from `role` where `role` matches a preset label, so pre-existing wizard agents keep functioning; unmatched rows remain `custom` with empty capabilities (editable via the Config tab).

**Harness tie-in:** capability id === `jobs.kind`. `enqueueOutreachJob(input)` generalizes to `enqueueJob(agent, kind, opts)` and is **gated**: it rejects a `kind` not in `agent.capabilities` (returns `{ error }`). The M1 outreach path becomes `enqueueJob(agent, "outreach", …)` — behaviourally unchanged. Running a capability whose `engineReady` is false enqueues a job that the runner completes as a no-op with a `result` note ("engine coming soon"), so the UI can show it cleanly.

## Agent creation wizard (type-first, incl. Custom)

Five steps (same count as today; **Name stays first**, `Position`→`Type`, `Prospect`→capability-driven `Settings`):

1. **Identity** — name (unchanged).
2. **Type** — grid of `AGENT_TYPES`. Each card: label, one-line desc, and its capability chips (e.g. SDR → `scrape · outreach · follow-up`). Preset capabilities are shown read-only (the preset *is* the behaviour). **Custom** reveals a capability multi-select (`scrape`/`outreach`/`follow-up`/`book-meeting`, each with a one-liner). Replaces today's free-text "describe a position → spark generates" (which was fake).
3. **Appearance** — character sprite picker (unchanged).
4. **Settings** — *dynamically rendered from the agent's capabilities*; only sections for capabilities it has appear, stacked:
   - `scrape` → target industry, company size, job titles, geography, batch size *(reuses today's Prospect fields, now persisted to `settings.scrape`)*
   - `outreach` → tone, angle, daily draft cap
   - `follow-up` → number of touches, days between, stop-on-reply
   - `book-meeting` → meeting length, availability window
   - A `manager` (no capabilities) → a "coordinates the team — no capability settings" note; the step auto-advances.
5. **Goal** — free-text goal (unchanged) → success screen (unchanged; the "View agent" navigation fix from the wizard-verification work stays).

**Wizard store state** swaps `wPosition`/`POSITION_SUGGESTIONS` for `wType`, `wCapabilities` (Custom only), and a `wSettings` map; `wIndustry`/`wSize`/`wTitles`/`wGeo` become the `scrape` settings sub-form.

**`createAgent` redesign:** builds the agent with `type` + resolved `capabilities` (preset bundle or Custom selection) + `role` = type label; persists the `agents` row (`saveAgent` extended with `type` + `capabilities`) **and** `agent_config.settings` with the collected per-capability settings.

## Team creation & templates

**Redesigned "New Team" flow** (extends today's team modal):
1. **Details + template** — name, icon, goal (as today) + a **template picker** (cards showing each template's required-capability chips). **Custom** = no requirements (today's freeform behaviour).
2. **Roster & coverage** — a live **coverage strip**: each required capability as ✓ *covered by <agent>* or ✗ *gap*. Below it, existing agents as a multi-select list (each showing capability chips); selecting/deselecting recomputes coverage live (covered = any selected member has the capability).
3. **Guided gap-fill** — for each still-uncovered capability, a **"＋ Create a [type]"** button (a type that grants that capability). It opens a **compact inline create** inside the modal — just a name field; type is fixed to the gap's type, capabilities from that preset, settings default (tunable later on the Config tab). Creating it persists the agent (reusing `createAgent`), auto-adds it to the roster, and flips coverage to ✓ — no full-wizard round-trip.
4. **Create** — always enabled (guided, **non-blocking**). If gaps remain, a subtle note and the team stores its `template`.

**Team detail page** (already has "+ Add agents"): gains a **coverage row** — the template's required capabilities as ✓/missing chips — and the "+ Add agents" picker marks candidates that fill a current gap.

**`createTeam` redesign:** stores `template`; coverage is computed on the fly from members' `capabilities` vs `TEAM_TEMPLATES[template].requiredCapabilities`.

## Module boundaries
- `lib/agentTypes.ts` — the static catalog (capabilities, agent types, team templates) + small lookup helpers. No DB, no React. Imported by the wizard, team modal, config tab, store, and job enqueue.
- `lib/db/schema.ts` — additive columns only.
- `lib/workspace/actions.ts` — `saveAgent` carries `type`/`capabilities`; `agent_config` load/save carries `settings`; `saveTeam` carries `template`.
- `lib/jobs/actions.ts` — add `enqueueJob(agent, kind, opts)` with capability gating; keep `enqueueOutreachJob(input)` as a thin wrapper that calls `enqueueJob(input.agent, "outreach", { leadIds: input.leadIds, batchSize: input.batchSize })`, so existing callers (the leads page and agent-detail Emails tab) need **no** changes.
- `lib/store.tsx` — `createAgent`/`createTeam` set the new fields; wizard state updated.
- `app/create/page.tsx` — the type-first wizard.
- Team modal + `app/teams/[id]/page.tsx` — templates, coverage, guided gap-fill.

## Phasing (one spec, phased tasks)
- **A — Foundation:** `lib/agentTypes.ts` + schema migration + seed tagging + backfill script. Verify: migration applies, `tsc` clean, seed agents carry types.
- **B — Wizard:** type-first flow + Custom picker + capability-driven Settings + `createAgent` persistence.
- **C — Harness wiring:** `enqueueJob` generalization + capability gating; the `/api/jobs/run` runner **switches on `job.kind`** — `outreach` → the M1 engine unchanged; any `engineReady: false` kind (`follow-up`, `book-meeting`) → completes the job as a no-op with an "engine coming soon" `result` note; `scrape` is left as a stub branch for Milestone 2 to fill.
- **D — Teams:** template picker + live coverage + guided inline gap-create + team-detail coverage row.

Phases are ordered; each ends with a working, verifiable increment.

## Verification
Browser + DB + `npx tsc --noEmit` (no automated suite, per project convention):
1. Migration applies; seed agents show correct types/capabilities; a pre-existing created agent is backfilled from its role (or left `custom`).
2. Wizard: create one agent of each preset type + one Custom (hand-picked capabilities); confirm `type`, `capabilities`, and per-capability `settings` persist (survive reload) and the Settings step renders only the relevant sections.
3. Harness: M1 outreach still runs from a typed `outreach`-capable agent; enqueue is **gated** — a Lead Scout (`scrape` only) cannot be asked to run `outreach` (returns an error / disabled control); an engine-less capability run completes as a clean no-op note.
4. Teams: create teams from several templates; confirm live coverage (✓/gap) updates as agents are selected, the inline gap-create adds a fitting agent and flips coverage, and Custom has no requirements; team detail shows the coverage row.
5. Per-user isolation preserved for all new persisted fields.

## Risks & mitigations
- **Backfill mis-tagging** existing created agents → unmatched rows stay `custom`/empty (safe, editable), not guessed wrong.
- **Engine-less capability confusion** → runs of `follow-up`/`book-meeting` return an explicit "engine coming soon" no-op result the UI surfaces; the type is still fully creatable.
- **Wizard scope creep** (dynamic Settings step) → settings are a flat per-capability map with a fixed small field set per capability; no nested/conditional logic beyond "show section if capability present."
- **`role` vs `type` drift** → `role` is always set to the type's label on create; `agentDetail` continues to key off `role`, so no behavioural regression.

## Milestone sequence (for context)
1. **This spec** — typed agents + team templates (the harness).
2. Milestone 2 — Playwright `scrape` engine (attaches to the Lead Scout / `scrape` capability + `settings.scrape`).
3. `follow-up` and `book-meeting` engines.
4. Permission-toggle enforcement; scheduled autonomy.
