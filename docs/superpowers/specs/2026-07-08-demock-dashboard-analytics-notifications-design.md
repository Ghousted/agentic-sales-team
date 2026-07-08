# De-Mock Slice 2 — Dashboard + Analytics + Notifications

Replace the invented content on the **dashboard**, **analytics**, and **notifications** with real workspace aggregates or drop what has no source — so these top-level surfaces reflect what the agents have actually done.

> Second of three de-mock slices (Slice 1 = agent detail, shipped). **Slice 3** (companion spec) = calendar. Keeps the seed roster; removes only fake *content*.
> **Decisions (user-confirmed):** money metrics (pipeline $/revenue) **dropped**, meetings **0**; agent **score replaced with real output** (leads worked / drafts / sent); trend charts **replaced with real per-day activity**.

---

## Part A — Data reads (`lib/workspace/stats.ts`, server-only)

Two user-scoped reads over the real tables (accepted leads only, mirroring `getAgentStats`):

```ts
export interface WorkspaceStats {
  leadsWorked: number;
  drafted: number;
  sent: number;
  replies: number;
  replyRate: number;                 // 0-100
  activeAgents: number;              // agents with a running job
  tasksRunning: number;              // running jobs
  perAgent: { agentId: string; leadsWorked: number; drafted: number; sent: number }[];
  daily: { date: string; drafted: number; sent: number }[]; // last 14 days, oldest→newest
}
export async function getWorkspaceStats(): Promise<WorkspaceStats>;

export interface ActivityItem { agentId: string; type: string; text: string; createdAt: string }
export async function listActivity(limit?: number): Promise<ActivityItem[]>; // newest first, default 30
```

- `getWorkspaceStats`: aggregates `leads` (accepted), `outreach_drafts`, `activity`, `jobs` for the session `userId`; `perAgent` groups by `agentId`; `daily` buckets `activity` (`email_drafted`/`email_sent`) by calendar day for the last 14 days. `activeAgents`/`tasksRunning` from `jobs.status='running'`.
- `listActivity`: the `activity` log for the user, newest first — the notifications feed.
- Client wrappers in `lib/workspace/statsActions.ts` (`"use server"`).

---

## Part B — Notifications (`components/NotificationsBell.tsx`)

- Replace the hardcoded `ACTIVITY_FEED` + in-memory `feedExtra` with **`listActivity()`** — real events, mapped to the existing row UI (agent avatar via `byId(agentId)`, the event `text`, a relative time from `createdAt`, a type chip). Empty state when none.
- `ACTIVITY_FEED` import removed; `feedExtra` store state retired if unused elsewhere.

---

## Part C — Dashboard (`app/page.tsx`)

Load `getWorkspaceStats` into state. Then:

- **Hero:** primary headline number → **Leads worked** (real). The `⚡ N working · M tasks` badge → real `activeAgents` · `tasksRunning`. The goal-ring (meetings) and `$X pipeline` badge → **removed**.
- **Agent spotlight rows:** "what they're doing" (hardcoded `hubPools`) → the agent's **running job** label if any, else last activity text, else "Idle." The **score bar** → a **real output bar** (`perAgent` leadsWorked, scaled to the busiest agent).
- **Per-team cards:** *Leads* → real team lead count (union of members' accepted leads); *Meetings* → 0 (or the tile dropped); *Pipeline* → **removed**.
- Delete now-unused `hubPools`, `parsePipeline`/`fmtMoney`, `ACTIVITY_FEED` imports.

---

## Part D — Analytics (`app/analytics/page.tsx`)

Load `getWorkspaceStats`. Then:

- **KPI cards** → **Active Agents · Leads worked · Emails sent · Reply rate** (all real; the money/score/meeting KPIs replaced).
- **Charts:** pipeline ramp → **removed**; 14-day outreach trend → **real per-day activity** bars from `daily[]` (drafted + sent per day); **team comparison bars** → **kept**, now by **real team lead count**.
- **Agent ranking** (top 5) → by **real output** (`perAgent` leadsWorked, showing the real number) instead of score.
- Delete now-unused `parsePipeline`/`fmtMoney` + the deterministic series helpers.

---

## File map

| File | Change |
|---|---|
| `lib/workspace/stats.ts` | **new** — `getWorkspaceStats` + `listActivity` (server-only) |
| `lib/workspace/statsActions.ts` | **new** — `"use server"` wrappers |
| `components/NotificationsBell.tsx` | real `listActivity` feed (drop `ACTIVITY_FEED`) |
| `app/page.tsx` | real hero + spotlight + team cards; drop money/meetings/hubPools |
| `app/analytics/page.tsx` | real KPIs + real per-day chart + real ranking; drop money/score/fake trends |
| `lib/data.ts` | remove `ACTIVITY_FEED` (+ `parsePipeline`/`fmtMoney` if no other importer) once unused |

---

## Verification

No unit-test framework — `npx tsc --noEmit` clean + manual (no migration):

- Fresh workspace: dashboard hero shows 0 leads worked, 0 working/0 tasks, no pipeline/goal-ring; team cards show real (0) lead counts; notifications "No recent activity"; analytics KPIs all 0, empty per-day chart.
- After running the pipeline: leads worked / sent / active-agents rise; notifications list the real `activity` events; the per-day chart shows real drafts/sent bars; agent ranking orders by real output; no pipeline $/score/meeting numbers anywhere.
- `tsc` clean; no `ACTIVITY_FEED`/`hubPools`/`parsePipeline` references survive on these surfaces.

## Deferred

- Slice 3 (calendar). Real meetings + pipeline/revenue (await engines/deal tracking). `agents.score` column kept (used on agent-list/team surfaces); only removed as a *headline metric* on dashboard/analytics.
