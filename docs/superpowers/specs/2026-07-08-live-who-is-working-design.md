# Live "Who's On It Right Now" (Slice 2b) — Design

Complete the "leads are worked, not owned" model with visibility: every lead row shows **who has worked it** (a durable avatar trail) and, live, **who's on it right now** (a pulse), plus a team **"Working now"** strip.

> **Slice 2b** — the visibility layer deferred from Slice 2a. Reads existing data only (`activity` + `jobs`); **no migration**, no new engines.

---

## Part A — "Worked by" trail (durable)

The `activity` table already logs every per-lead action (`lead_added`, `lead_researched`, `email_drafted`, `email_sent`) with the acting `agentId` + timestamp. The trail just reads it.

- **`LeadDTO` gains `workedBy: string[]`** — the distinct agents that have acted on the lead, **most-recent first**.
- **Computed centrally.** A plural `toLeadDTOs(rows)` in `lib/leads/store.ts` fetches the `activity` agents for all listed lead ids in **one query**, groups by lead, and attaches `workedBy`. The list functions (`listLeads`, `listWorkbook`, `listLeadsForAgents`, `listCandidates`) switch from `.map(toLeadDTO)` to `await toLeadDTOs(rows)`, so `workedBy` rides along to **every** surface. Single-lead paths (`addLead`/`getLead`) keep `toLeadDTO`, which sets `workedBy: []`.
- **Rendered as a small avatar cluster** on every lead row (a shared `WorkedBy` component), most-recent agent first, with a `title` tooltip of their names. Un-worked leads render nothing.

No new tracking, no migration — just surfacing the log that's already written.

---

## Part B — Live "active now"

The live layer reads **running jobs** (`jobs.status='running'`).

- **`getLiveWork(userId)`** (`lib/leads/store.ts`, server) → for each running `research`/`outreach` job, resolve the leads it's still working — its remaining pool via the Slice-1 picks (`pickLeadsForResearch`/`pickLeadsForRun` for the job's `params.agent.id`) — and return `LiveWorkDTO[]` = `{ agentId, agentName, capability, leadIds }[]`. As a job finishes leads, they leave the pool, so the set reflects what's *still* in flight. Exposed via a `liveWork()` action.
- **`useLiveWork()`** (`lib/useLiveWork.ts`, client hook) polls `liveWork()` every ~3.5s while mounted and returns `{ live, byLead }` where `byLead[leadId] = { agentName, capability }`. It renders nothing when idle.
- **Per-lead pulse** — a shared `LivePulse` component: when `byLead[l.id]` is set, the row shows a **pulsing** badge *"Sarah researching…"* beside the worked-by avatars. (A `pulse` keyframe is added to `globals.css`.)
- **Team "Working now" strip** — on the team page, `live` filtered to the team's members renders a compact strip: *"🟢 Sarah — researching 5 · Michael — drafting 3."* Shown only when someone's active.

Polling is a light query (running jobs are few) and renders nothing when idle, so pages stay quiet unless work is happening. *(A "poll only while a run is in flight" back-off is an easy later tune.)*

---

## Shared UI pieces

Two small client components in `components/LeadBits.tsx`, reused by all three lead surfaces:
- `WorkedBy({ ids, byId })` — the overlapping avatar cluster (top 3).
- `LivePulse({ info })` — the pulsing "{agent} {verb}…" badge (`research → researching`, `outreach → drafting`).

Both take data as props (client-safe); `byId` comes from the store.

---

## File map

| File | Change |
|---|---|
| `lib/leads/types.ts` | `LeadDTO.workedBy: string[]`; `LiveWorkDTO` |
| `lib/leads/store.ts` | `toLeadDTO` sets `workedBy: []`; new `toLeadDTOs` (attach workedBy); wire `listLeads`/`listWorkbook`/`listLeadsForAgents`/`listCandidates`; `getLiveWork` |
| `lib/leads/actions.ts` | `liveWork()` wrapper |
| `lib/useLiveWork.ts` | **new** — polling hook → `{ live, byLead }` |
| `components/LeadBits.tsx` | **new** — `WorkedBy` + `LivePulse` |
| `app/globals.css` | `@keyframes pulse` |
| `app/leads/page.tsx` | worked-by + live pulse on Active + Pending rows |
| `app/agents/[id]/page.tsx` | worked-by + live pulse on workbook rows |
| `app/teams/[id]/page.tsx` | worked-by + live pulse on team-book rows + "Working now" strip |

---

## Verification

No unit-test framework — `npx tsc --noEmit` clean + manual (no migration):

- **Trail:** after research + outreach have run on some leads, those rows show the researcher's + writer's avatars (most-recent first) on the Leads page, agent workbook, and team book; un-worked leads show none.
- **Live:** click **Work the book** (or Run outreach) on a team → while the run is in flight, the affected rows show a pulsing *"…researching/drafting…"* badge and the team page shows a **"Working now"** strip; both clear when the run finishes (poll settles to empty).
- **Quiet when idle:** with nothing running, no pulse/strip renders; the poll returns empty.
- `tsc` clean.

## Deferred

- Poll-only-while-active back-off (2b polls steadily).
- Per-lead exact single in-flight lead (2b shows the running job's remaining pool, i.e. batch-level).
- A global (cross-team) "Working now" view.
