# Agent Creation — Architecture

How an agent gets created in Agentic Salesforce, end to end: the model, the wizard flow, the data it writes, and how a created agent's **capabilities** connect to the job/engine harness.

> Spec: `docs/superpowers/specs/2026-07-07-typed-agents-and-team-templates-design.md`
> Plan: `docs/superpowers/plans/2026-07-07-typed-agents-and-team-templates.md`

---

## 1. The two-layer model

Agents are **not** free-text roles. They are built from two layers:

- **Capabilities** — the atomic, engine-backed functions. Each capability id is also a `jobs.kind`, so a capability is the unit an agent can actually *run*.
- **Agent types** — preset "harnesses" that bundle a set of capabilities + a display identity. Picking a type is how a user gets a sensible behaviour without wiring capabilities by hand. **Custom** is the escape hatch: the user hand-picks capabilities.

```
Capability (atom, = jobs.kind)      Agent type (preset bundle)
┌───────────────┐                   ┌──────────────────────────────┐
│ scrape        │◄──┐               │ SDR   → scrape+outreach+follow-up
│ outreach      │◄──┼──── bundled ──│ Lead Scout → scrape           │
│ follow-up     │◄──┤   into types  │ Outreach Writer → outreach    │
│ book-meeting  │◄──┘               │ Custom → (user-picked)        │
└───────────────┘                   └──────────────────────────────┘
```

The single source of truth for both layers is the static catalog **`lib/agentTypes.ts`** (developer-curated, like `AGENTS_BASE`).

### Capabilities

| Capability (`= jobs.kind`) | Function | Engine status |
|---|---|---|
| `scrape` | Find & import ICP-matched leads | Milestone 2 (Playwright) |
| `outreach` | Qualify/score + draft personalized emails | **Built (M1)** |
| `follow-up` | Re-engage non-repliers / cold leads | harness-only (engine later) |
| `book-meeting` | Propose times & book on positive replies | harness-only (engine later) |

`CAPABILITIES` records `{ id, label, desc, jobKind, engineReady }`. `engineReady` is `true` only where a real engine exists; running an engine-less capability is a clean no-op with an "engine coming soon" note.

### Agent types (presets)

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

---

## 2. The creation flow (wizard)

Route: **`/create`** (`app/create/page.tsx`), a full-screen takeover. Five steps, driven by `s.wStep` in the store:

```
Step 0        Step 1            Step 2         Step 3                 Step 4        Success
Identity  →   Type          →   Appearance →   Settings           →   Goal      →  "live!"
(name)        (type or           (character     (capability-driven     (free text)
              Custom+caps)        sprite)        sub-forms)
```

1. **Identity** — the agent's name (`wName`).
2. **Type** — a grid of `AGENT_TYPES`. Selecting a preset fixes its capabilities (chips shown read-only). Selecting **Custom** reveals a `CAPABILITIES` multi-select the user toggles (`wCapabilities`).
3. **Appearance** — pick the illustrated character sprite (`wCharacter`) used as the avatar everywhere.
4. **Settings** — *rendered dynamically from the resolved capabilities* (`caps`). Only the sections for capabilities the agent has appear, stacked, writing into `wSettings[capability]`:
   - `scrape` → target industry / job titles / geography (the ICP the scraper will consume)
   - `outreach` → tone
   - `follow-up` → number of touches
   - `book-meeting` → meeting length
   - A type with **no** capabilities (Sales Manager) shows a "coordinates the team — no capability settings" note.
5. **Goal** — free-text objective (`wGoals`). The footer's final-step button fires `createAgent`, then the success screen offers "View agent →".

Resolved capabilities inside the wizard:

```ts
const at   = typeById(s.wType);
const caps = at?.custom ? s.wCapabilities : (at?.capabilities ?? []);
```

---

## 3. What gets persisted

On the last step, the store's **`createAgent`** (`lib/store.tsx`) builds the agent and writes it in two places:

```
createAgent()
  ├── build Agent { id, name, initials, role: <type label>, color, status,
  │                 task, score, goal, char, type: wType, capabilities: caps }
  ├── set store.extraAgents += agent            (optimistic, in-memory)
  ├── saveAgent(agent)                           → INSERT agents row
  └── if wSettings not empty:
        saveAgentConfig(id, { settings: wSettings })  → UPSERT agent_config.settings
        mirror into store.agentConfig[id].settings
```

### Data model

| Table | Columns that matter here | Written by |
|---|---|---|
| `agents` | `type` (text), `capabilities` (jsonb `string[]`), + identity fields | `saveAgent` |
| `agent_config` | `settings` (jsonb, per-capability map), + role/goal/permissions overrides | `saveAgentConfig` (partial upsert — only provided facets change) |

- `role` is kept as the **human display label** (set to the type's `label`), so existing role-based UI (`lib/agentDetail.ts`) keeps working unchanged.
- `capabilities` on the agent is the **source of truth for what jobs it can run**.
- `agent_config.settings` is a `Record<capability, Record<key, value>>` — e.g. `{ scrape: { industry, titles, geo }, outreach: { tone } }`. It is a **partial upsert**: saving one facet (settings, or role/goal/permissions) never nulls the others.

On page load, **`loadWorkspace`** (`lib/workspace/actions.ts`) reads the user's `agents` rows (mapping `type`/`capabilities`) and `agent_config` (mapping `settings`) and hydrates the store. The 8 seed agents live statically in `AGENTS_BASE` (already tagged with `type`/`capabilities`); only user-created agents are stored in the DB. Pre-existing created agents were backfilled from their legacy `role` by `scripts/backfill-agent-types.mjs`.

---

## 4. How capabilities drive execution

A created agent's `capabilities` gate what it can be asked to do. Enqueuing a job is **capability-gated**:

```
Run a capability on an agent
  └── enqueueJob({ agent, kind, capabilities })      (lib/jobs/actions.ts)
        ├── reject if kind ∉ agent.capabilities  → { error }
        └── INSERT jobs { kind, status:'queued', params:{ agent, ... } }
              │
              ▼  POST /api/jobs/run  (Node route handler; browser fetch carries the session)
        claim queued job (atomic) → switch on job.kind:
          • outreach     → M1 Gemini drafting engine (real drafts)
          • scrape       → Milestone 2 (Playwright) — stub for now
          • follow-up /
            book-meeting → no-op with "engine coming soon" note
```

So the type you pick at creation → its capabilities → the `jobs.kind`s that agent may run → the engine that executes them. A **Lead Scout** (only `scrape`) can't be asked to draft; an **SDR** can run all three of its capabilities. `enqueueOutreachJob` remains a thin wrapper over `enqueueJob(agent, "outreach", …)`, so Milestone 1's outreach path is unchanged.

---

## 5. File map

| File | Responsibility |
|---|---|
| `lib/agentTypes.ts` | Static catalog: `CAPABILITIES`, `AGENT_TYPES`, `TEAM_TEMPLATES` + `typeById`/`capabilitiesForType`/`templateById` |
| `app/create/page.tsx` | The 5-step creation wizard (Type step + capability-driven Settings) |
| `lib/store.tsx` | Wizard state (`wType`/`wCapabilities`/`wSettings`), `createAgent`, agent memos |
| `lib/types.ts` | `Agent` (`type`, `capabilities`), `Team` (`template`) |
| `lib/workspace/actions.ts` | `saveAgent` / `saveAgentConfig` (partial upsert) / `loadWorkspace` |
| `lib/db/schema.ts` | `agents.type`/`capabilities`, `agent_config.settings` columns |
| `lib/jobs/actions.ts` + `app/api/jobs/run/route.ts` | Capability-gated enqueue + kind-switched runner |
| `lib/data.ts` | `AGENTS_BASE` seed agents (tagged with type/capabilities) |

---

## 6. Teams (related)

Teams mirror the same idea: a team is created from a **template** (`TEAM_TEMPLATES`) that declares `requiredCapabilities`. The New Team flow shows live **coverage** (which required capabilities the selected members' `capabilities` cover) and, for each gap, a guided inline "create a fitting agent" that reuses the creation path. See the spec/plan for the team flow detail.

---

*Status: reflects Milestones 1 + the typed-agents redesign (agent types, capabilities, wizard, harness). `scrape`/`follow-up`/`book-meeting` engines are later milestones; their agent types and settings already exist here.*
