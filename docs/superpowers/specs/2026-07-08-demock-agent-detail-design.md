# De-Mock Slice 1 — Agent Detail (real data / empty states)

Replace the invented content on the agent-detail page with **real DB data where a source exists, and clean empty states where none does** — so the sub-tabs become a live mirror of what an agent has actually done, and the pipeline can be tested end-to-end.

> First of three de-mock slices. **Slice 2** (later): dashboard hero + analytics + notifications. **Slice 3** (later): calendar. This slice touches only the agent-detail page + its data source.
> **Keeps the seed roster** (`AGENTS_BASE`/`TEAMS_BASE`) — they're functional test agents. Only fake *content/numbers* are removed.

---

## Part A — The data source

The page currently builds every mock section from `buildAgentDetail(agent, …)` (pure fiction). This slice replaces those sections with a real, user-scoped read.

**New `getAgentStats(agentId)`** (`lib/agents/stats.ts`, server-only) → returns everything the sub-tabs need from real tables (all scoped by session `userId` + `agentId`):

```ts
interface AgentStats {
  leadsWorked: number;       // count of leads assigned to the agent
  researched: number;        // leads with a research brief
  drafted: number;           // outreach_drafts rows
  sent: number;              // outreach_drafts where status='sent'
  replyRate: number;         // % of the agent's leads at stage replied|meeting
  activity: { type: string; text: string; createdAt: string }[]; // recent, newest first
  jobs: { kind: string; status: string; createdAt: string; finishedAt: string | null }[]; // recent
}
```

- **Leads scoping:** `leads.agentId = agentId` (the agent's assigned leads — this is per-agent, not the team book, since the sub-tabs describe *this* agent). `outreach_drafts`/`activity`/`jobs` filter `agentId`.
- Exposed to the client via a `getAgentStats` wrapper in `lib/agents/actions.ts` (`"use server"`); the page loads it into state like it already does for `agentLeads`/`drafts`.

**`lib/agentDetail.ts` is deleted** once the page no longer imports it (nothing else does). Any still-real bit (the agent's `goal`) is read directly from `sel`/config, not the builder.

---

## Part B — Each section → real or empty

| Section | Now (fake) | After |
|---|---|---|
| **Overview — summary** | invented prose | factual line: *"12 leads · 8 researched · 5 drafts · 2 sent"* from `getAgentStats` |
| **Overview — stats (3 cards)** | fake numbers | real: **Leads worked · Drafts sent · Replies** |
| **Overview — accomplishments** | invented | the agent's **recent `activity`** events (real text), newest first; empty state when none |
| **Overview — goals** | `agent.goal` + filler | keep the agent's real `goal` (+ config); drop the invented filler entries |
| **Overview — next actions** | invented | **dropped** |
| **Reach Outs** | fake timeline | the agent's real **`activity` timeline** (researched/drafted/sent), newest first; empty state |
| **Tasks** | fake tasks | the agent's real **`jobs`** (kind · status · time); empty state |
| **Performance** | fake KPIs + weekly bars + heatmap | **real KPIs only** (leads worked, drafted, sent, reply rate); **charts dropped** |
| **Memory** | pure fiction | **section removed** (tab + body) |
| **Meetings** | `detail.meetings` (fake) | **empty state** — "No meetings yet" (no book-meeting engine); stays gated to `book-meeting` |

After this slice, every agent-detail section is **real DB data or an honest empty state** — nothing invented. An un-worked agent shows clean empties; a worked agent shows its actual history.

---

## File map

| File | Change |
|---|---|
| `lib/agents/stats.ts` | **new** — `getAgentStats` (server-only, real reads) |
| `lib/agents/actions.ts` | **new** — `getAgentStats` `"use server"` wrapper |
| `app/agents/[id]/page.tsx` | load `getAgentStats`; render Overview/Reach/Tasks/Performance from it; remove Memory section + tab; Meetings → empty state; drop `buildAgentDetail` import + `detail` |
| `lib/agentDetail.ts` | **deleted** (no remaining importers) |

---

## Verification

No unit-test framework — `npx tsc --noEmit` clean + manual (no migration):

- A **fresh agent** (no leads/jobs) shows: Overview "0 leads · 0 researched · 0 drafts · 0 sent", empty accomplishments/Reach/Tasks, real goal, real (zero) Performance KPIs, no Memory tab.
- After running the pipeline on that agent (research + outreach): Overview counts rise, accomplishments + Reach Outs list the real `lead_researched`/`email_drafted`/`email_sent` events, Tasks lists the real `jobs`, Performance shows real drafted/sent/reply-rate.
- No section renders invented data; `lib/agentDetail.ts` is gone and nothing imports it.
- `tsc` clean.

## Deferred

- Slice 2 (dashboard/analytics/notifications), Slice 3 (calendar).
- Real agent **Memory** feature (removed here, not replaced).
- Real **meetings** (await a book-meeting engine).
- Chat `aiReply` (canned) — left as-is this slice.
- Untrackable metrics (open rate, pipeline $, activity heatmap) — dropped, not faked.
