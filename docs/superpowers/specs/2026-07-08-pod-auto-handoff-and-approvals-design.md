# Pod Auto-Hand-off + Approval Modes (Slice 2a) — Design

The team pod stops being a set of manual per-capability buttons and becomes an **orchestrated flow**: one **"Work the book"** action runs a team's shared book through the pipeline (research → outreach), **auto-handing off** from one capability to the next — pausing at any capability an agent's owner set to **Ask**, which surfaces a human **approval**.

> **Slice 2a** = auto hand-off + approval modes (this doc). **Slice 2b** (right after) = the live "who's on it right now" view.
> Builds on Slice 1's shared team book (`teammatesOf`, accepted-only pools) and the existing research/outreach engines + the `jobs` runner. **No migration** — `jobs.status`/`jobs.params` and `agent_config.settings` are existing free-form columns.

---

## Part A — Approval mode (per agent-capability)

Each capability an agent has runs in one of two modes:
- **Auto** (default) — runs when the pod reaches it.
- **Ask** — pauses and requests human approval first.

**Storage:** `agent_config.settings[capability].mode` = `"auto" | "ask"` (absent ⇒ auto). Reuses the existing per-capability settings blob the wizard already writes.

**Config UI:** the agent detail page gains an **Autonomy** control — for each capability the agent has, an **Auto / Ask** toggle. It reads `s.agentConfig[id].settings?.[cap]?.mode` and saves via the existing `saveConfig(id, { settings })` path (which partial-upserts settings), building the full merged settings object so no other capability's settings are lost.

Mode is **per-agent**, so a *writer's* outreach can be Ask while a *researcher's* research is Auto.

---

## Part B — "Work the book" + runner chaining

### Pod resolution (`lib/pod/orchestrate.ts`, new, server-only)

The pipeline order is `POD_ORDER = ["research", "outreach"]` (capability ids; follow-up/book-meeting have no engines yet). Helpers:

- `membersOfTeam(userId, teamId) → string[]` — the team's agent ids (`TEAMS_BASE` + the user's `teams`, with the `team_members` override), reusing Slice 1's membership logic.
- `agentInfo(userId, agentId) → { id, name, role, goal, task, capabilities } | null` — merges `AGENTS_BASE` (seed) + the `agents` table (created), for both the capability check and the enqueue snapshot.
- `memberWithCapability(userId, teamId, capability) → agentId | null` — the first team member whose capabilities include it.
- `approvalMode(userId, agentId, capability) → "auto" | "ask"` — from `agent_config.settings`, default auto.
- `countPending(userId, agentId, capability) → number` — how many book leads the stage would process now (un-briefed for research / un-drafted for outreach, via the Slice-1 pools), for the approval's lead count.
- `enqueuePodStage(userId, teamId, capability, agentId)` — inserts a `jobs` row: `kind=capability`, `params = { agent: <snapshot>, teamId, pod: true, leadCount, batchSize: POD_BATCH }`, `status = approvalMode==="ask" ? "needs_approval" : "queued"`.

`POD_BATCH` is larger than the manual default (e.g. 20) so one "Work the book" handles a typical book in a run.

### The action (`lib/pod/actions.ts`, `"use server"`)

`workTheBook(teamId)`:
1. Resolve the **first coverable stage** — the earliest `POD_ORDER` capability some member has (`research` if a member researches, else `outreach`) + that member.
2. `enqueuePodStage(...)` it. Returns `{ started, needsApproval }` (needsApproval when that first agent's mode is Ask) or `{ error }` if the team covers no pod stage.

The team page then `POST`s `/api/jobs/run` (unless it needs approval) and refreshes.

### Runner chaining (`app/api/jobs/run/route.ts`)

After a **pod** stage job (`params.pod && params.teamId`) reaches `done`, the runner chains:
- `nextCap = POD_ORDER[index(candidate.kind)+1]` (research → outreach; outreach → none).
- `agentId = memberWithCapability(userId, teamId, nextCap)` — if none, chain ends.
- `enqueuePodStage(userId, teamId, nextCap, agentId)`.

Because the runner loops over queued jobs in one invocation, an **auto** chain flows **research → outreach in a single run**; an **Ask** next stage is enqueued as `needs_approval` and simply waits (the runner never claims it). The runner still claims only `outreach`+`research` (never `scrape`); pod stages are those kinds. Non-pod jobs (the existing manual "Run outreach" / "Research leads") are unaffected — they carry no `params.pod`, so they never chain.

---

## Part C — Approvals queue

**Representation (no new table):** an Ask-gated stage is a `jobs` row with `status='needs_approval'` and `params.leadCount`. The runner only ever claims `queued`, so it waits untouched. (`jobs.status` gains `needs_approval` + `dismissed` — free-text column, no migration.)

**Reads/actions (`lib/pod/actions.ts`):**
- `listPendingApprovals(teamId) → ApprovalDTO[]` — `jobs` where `status='needs_approval'` and `params.teamId=teamId`, mapped to `{ id, agentName, capability, leadCount }` (user-scoped).
- `approveJob(id)` — flips `needs_approval → queued` (user-scoped); the caller kicks the runner. It runs and — via Part B chaining — the pod resumes to the next stage.
- `rejectJob(id)` — flips to `dismissed`; the chain ends.

**Surface — inline on the team page**, below "Work the book":

> *Michael (Outreach Writer) wants to draft outreach for 8 leads.* **[Approve] [Reject]**

Approve → the stage runs + the pod continues; Reject → it stops there. A fully-auto team never shows an approval and flows end to end. *(A global Approvals view/badge is an easy follow-up; 2a keeps it where the action starts.)*

---

## File map

| File | Change |
|---|---|
| `lib/pod/orchestrate.ts` | **new** — pod resolution + `enqueuePodStage` + chaining helpers (server-only) |
| `lib/pod/actions.ts` | **new** — `workTheBook` / `listPendingApprovals` / `approveJob` / `rejectJob` (`"use server"`) |
| `app/api/jobs/run/route.ts` | after a pod stage completes, chain the next stage |
| `app/teams/[id]/page.tsx` | "Work the book" button + pending-approvals list (Approve/Reject) |
| `app/agents/[id]/page.tsx` | Autonomy control — per-capability Auto/Ask toggle |
| `lib/leads/types.ts` (or a pod types file) | `ApprovalDTO` |

---

## Verification

No unit-test framework — `npx tsc --noEmit` clean + manual (no migration):

- **Autonomy:** toggle a capability to Ask on an agent; reload → it persists (`agent_config.settings[cap].mode`).
- **Auto flow:** a team with a researcher (Auto) + a writer (Auto) and accepted book leads → "Work the book" → in one run the book is briefed then drafted (drafts appear); re-running is idempotent (nothing re-worked).
- **Ask gate:** set the writer's outreach to Ask → "Work the book" runs research, then a pending approval "…draft outreach for N leads" appears on the team page; **Approve** → drafts appear; **Reject** → no drafts, approval clears.
- **Isolation:** non-pod manual "Run outreach"/"Research leads" still work unchanged (no chaining, no approval). The runner still never claims `scrape`.
- `tsc` clean.

## Deferred

- **Slice 2b:** live "who's on it right now" (per-lead active-agent indicator).
- Global approvals view/badge; follow-up/book-meeting pod stages (need engines first); event-driven auto-start on accept; multi-batch "work the whole book" looping (2a processes up to `POD_BATCH` per run).
