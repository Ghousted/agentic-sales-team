# Live "Who's On It Right Now" (Slice 2b) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every lead row shows **who has worked it** (durable avatar trail from the `activity` log) and, live, **who's on it now** (a polled pulse from running jobs); the team page adds a **"Working now"** strip.

**Architecture:** `LeadDTO` gains `workedBy` (computed centrally when leads are listed). A `getLiveWork()` server read turns running research/outreach jobs into `{agent, capability, leadIds}`; a `useLiveWork()` hook polls it; two shared components (`WorkedBy`, `LivePulse`) render on all three lead surfaces. **No migration** — reads `activity` + `jobs`.

**Tech Stack:** Next.js 14 App Router / TypeScript / Drizzle / Neon (existing).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-08-live-who-is-working-design.md`.
- **Git identity:** commit as the user only — `Ghousted <clydepadua091@gmail.com>`. **Never** a `Co-Authored-By: Claude` / AI-attribution line.
- **No push.** `.env.local` stays gitignored.
- **No unit-test framework, no migration.** Verification is `npx tsc --noEmit` (from `agentic-salesforce/`) clean + code review + manual.
- **User-scoping:** every `activity`/`jobs`/`leads` read filters by the session `userId`.
- **Follow patterns:** store mirrors the existing functions; UI uses `css()`/`av()`/`Box`/`Btn`; the shared components take data as props (client-safe).
- **Deferred:** poll-only-while-active back-off; a global cross-team "Working now"; exact single in-flight lead (2b shows the running job's remaining pool).

---

## File Structure

- `lib/leads/types.ts` — MODIFY: `LeadDTO.workedBy`; `LiveWorkDTO`.
- `lib/leads/store.ts` — MODIFY: `toLeadDTO` sets `workedBy:[]`; new `toLeadDTOs`; wire 4 list fns; `getLiveWork`.
- `lib/leads/actions.ts` — MODIFY: `liveWork()`.
- `lib/useLiveWork.ts` — CREATE: polling hook.
- `components/LeadBits.tsx` — CREATE: `WorkedBy` + `LivePulse`.
- `app/globals.css` — MODIFY: `@keyframes pulse`.
- `app/leads/page.tsx` / `app/agents/[id]/page.tsx` / `app/teams/[id]/page.tsx` — MODIFY: render the components (+ team strip).

---

## Task 1: Data — `workedBy` + `getLiveWork`

**Files:** Modify `lib/leads/types.ts`, `lib/leads/store.ts`.

**Interfaces:** Produces `LeadDTO.workedBy: string[]`; `LiveWorkDTO { agentId, agentName, capability, leadIds }`; `getLiveWork(): Promise<LiveWorkDTO[]>`; list functions attach `workedBy`.

- [ ] **Step 1: Types.** In `lib/leads/types.ts`, add to `LeadDTO` (after `research: ResearchBrief | null;`):

```ts
  workedBy: string[];
```

And add (after `LeadDTO`):

```ts
export interface LiveWorkDTO {
  agentId: string;
  agentName: string;
  capability: string;
  leadIds: string[];
}
```

- [ ] **Step 2: Import `jobs` + `LiveWorkDTO` in the store.** In `lib/leads/store.ts`, change the db import (line 6) to add `jobs`:

```ts
import { getDb, isDbConfigured, leads, outreachDrafts, activity, jobs } from "@/lib/db";
```

and the types import (line 8) to add `LiveWorkDTO`:

```ts
import { LEAD_STAGES, type LeadDTO, type DraftDTO, type OutreachResult, type ResearchBrief, type LiveWorkDTO } from "./types";
```

- [ ] **Step 3: `toLeadDTO` sets an empty `workedBy`; add `toLeadDTOs`.** In `lib/leads/store.ts`, change `toLeadDTO` (line 18-24) to include `workedBy: []`:

```ts
function toLeadDTO(r: LeadRow): LeadDTO {
  return {
    id: r.id, agentId: r.agentId, name: r.name, title: r.title, company: r.company,
    email: r.email, status: r.status, score: r.score, source: r.source, review: r.review, profileUrl: r.profileUrl, platform: r.platform, research: r.research ?? null,
    workedBy: [],
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  };
}

/** Map rows to DTOs, attaching each lead's `workedBy` (distinct agents that have
 *  acted on it, most-recent first) from the activity log in one query. */
async function toLeadDTOs(userId: string, rows: LeadRow[]): Promise<LeadDTO[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const acts = await getDb().select({ leadId: activity.leadId, agentId: activity.agentId })
    .from(activity)
    .where(and(eq(activity.userId, userId), inArray(activity.leadId, ids)))
    .orderBy(desc(activity.createdAt));
  const byLead: Record<string, string[]> = {};
  for (const a of acts) {
    if (!a.leadId) continue;
    const list = (byLead[a.leadId] ??= []);
    if (!list.includes(a.agentId)) list.push(a.agentId);
  }
  return rows.map((r) => ({ ...toLeadDTO(r), workedBy: byLead[r.id] ?? [] }));
}
```

- [ ] **Step 4: Wire the list functions.** In `lib/leads/store.ts`, change the four list functions to use `toLeadDTOs`:
  - `listLeads` (line 52): `return toLeadDTOs(userId, rows);`
  - `listWorkbook` (line 65): `return toLeadDTOs(userId, rows);`
  - `listLeadsForAgents` (line 76): `return toLeadDTOs(userId, rows);`
  - `listCandidates` (line 87): `return toLeadDTOs(userId, rows);`

(Each has `userId` and `rows` in scope. `addLead`/`getLead` keep `toLeadDTO` — single-lead, `workedBy: []`.)

- [ ] **Step 5: Add `getLiveWork`.** In `lib/leads/store.ts`, after `applyResearchResult` (end of file), add:

```ts
/** Running research/outreach jobs → who is actively working which leads now
 *  (the job's remaining pool). Renders nothing when idle. */
export async function getLiveWork(): Promise<LiveWorkDTO[]> {
  if (!isDbConfigured()) return [];
  const userId = await uid();
  if (!userId) return [];
  const running = await getDb().select().from(jobs)
    .where(and(eq(jobs.userId, userId), eq(jobs.status, "running"), inArray(jobs.kind, ["research", "outreach"])));
  const out: LiveWorkDTO[] = [];
  for (const j of running) {
    const p = j.params as { agent?: { id?: string; name?: string } };
    const agentId = p.agent?.id ?? j.agentId;
    const pick = j.kind === "research" ? pickLeadsForResearch : pickLeadsForRun;
    const pool = await pick(userId, agentId, undefined, 50);
    out.push({ agentId, agentName: p.agent?.name ?? "Agent", capability: j.kind, leadIds: pool.map((l) => l.id) });
  }
  return out;
}
```

- [ ] **Step 6: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors.

- [ ] **Step 7: Commit.**

```bash
git add agentic-salesforce/lib/leads/types.ts agentic-salesforce/lib/leads/store.ts
git commit -m "Attach workedBy to leads + getLiveWork (running-job working sets)"
```

---

## Task 2: Action + hook + components + CSS

**Files:** Modify `lib/leads/actions.ts`, `app/globals.css`; Create `lib/useLiveWork.ts`, `components/LeadBits.tsx`.

**Interfaces:** Produces `liveWork()` action; `useLiveWork()` hook → `{ live, byLead }`; `WorkedBy`/`LivePulse` components; a `pulse` keyframe.

- [ ] **Step 1: `liveWork` action.** In `lib/leads/actions.ts`, add (and extend the type import if needed):

```ts
import type { LeadDTO, DraftDTO, LiveWorkDTO } from "./types";
```

```ts
export async function liveWork(): Promise<LiveWorkDTO[]> {
  return store.getLiveWork();
}
```

- [ ] **Step 2: `useLiveWork` hook.** Create `lib/useLiveWork.ts`:

```ts
"use client";
import { useEffect, useState } from "react";
import { liveWork } from "@/lib/leads/actions";
import type { LiveWorkDTO } from "@/lib/leads/types";

/** Poll the live "who's working now" set every ~3.5s while mounted. Returns the
 *  raw list (for a team strip) and a leadId → {agentName, capability} map. */
export function useLiveWork(): { live: LiveWorkDTO[]; byLead: Record<string, { agentName: string; capability: string }> } {
  const [live, setLive] = useState<LiveWorkDTO[]>([]);
  useEffect(() => {
    let active = true;
    const tick = async () => { const w = await liveWork(); if (active) setLive(w); };
    tick();
    const id = setInterval(tick, 3500);
    return () => { active = false; clearInterval(id); };
  }, []);
  const byLead: Record<string, { agentName: string; capability: string }> = {};
  for (const w of live) for (const id of w.leadIds) byLead[id] = { agentName: w.agentName, capability: w.capability };
  return { live, byLead };
}
```

- [ ] **Step 3: Shared components.** Create `components/LeadBits.tsx`:

```tsx
"use client";
import { css } from "./primitives";
import { av } from "@/lib/visuals";
import type { Agent } from "@/lib/types";

/** Overlapping avatars of the agents that have worked a lead (top 3). */
export function WorkedBy({ ids, byId }: { ids: string[]; byId: (id: string) => Agent | undefined }) {
  const agents = ids.map(byId).filter(Boolean).slice(0, 3) as Agent[];
  if (agents.length === 0) return null;
  return (
    <div style={css("display:flex;align-items:center")} title={"Worked by " + agents.map((a) => a.name).join(" · ")}>
      {agents.map((a, i) => (
        <div key={a.id} style={css(av(a, 18) + ";border:1.5px solid #fff;" + (i === 0 ? "" : "margin-left:-6px"))}>{a.initials}</div>
      ))}
    </div>
  );
}

/** Pulsing "who's on it now" badge; renders nothing when not active. */
export function LivePulse({ info }: { info?: { agentName: string; capability: string } }) {
  if (!info) return null;
  const verb = info.capability === "research" ? "researching" : info.capability === "outreach" ? "drafting" : info.capability;
  return (
    <span style={css("display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:600;color:#1B7A3D;background:#E7F7EC;border-radius:99px;padding:2px 9px;white-space:nowrap")}>
      <span style={css("width:6px;height:6px;border-radius:50%;background:#2FA45C;animation:pulse 1.4s ease-in-out infinite")} />
      {info.agentName.split(" ")[0]} {verb}…
    </span>
  );
}
```

- [ ] **Step 4: Pulse keyframe.** Append to `app/globals.css`:

```css
@keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: .35; transform: scale(1.5); } }
```

- [ ] **Step 5: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors. (`css` re-exported from `components/primitives`; `av` from `@/lib/visuals`; `Agent` from `@/lib/types`.)

- [ ] **Step 6: Commit.**

```bash
git add agentic-salesforce/lib/leads/actions.ts agentic-salesforce/lib/useLiveWork.ts agentic-salesforce/components/LeadBits.tsx agentic-salesforce/app/globals.css
git commit -m "liveWork action + useLiveWork hook + WorkedBy/LivePulse components + pulse keyframe"
```

---

## Task 3: Leads page rows

**Files:** Modify `app/leads/page.tsx`.

**Interfaces:** Consumes `useLiveWork`, `WorkedBy`/`LivePulse`, `l.workedBy`, `byId`.

- [ ] **Step 1: Imports + hook.** In `app/leads/page.tsx`, add:

```ts
import { useLiveWork } from "@/lib/useLiveWork";
import { WorkedBy, LivePulse } from "@/components/LeadBits";
```

In the component body (after `const { agents, byId, showToast } = useApp();`), add:

```ts
  const { byLead } = useLiveWork();
```

- [ ] **Step 2: Render in the Active row's Lead cell.** In the Active table's `filtered.map((l) => …)` row, the first cell shows `{l.name}` + a sub-line. Add a live/worked-by group under it — change that first `<div>` cell to append:

```tsx
              <div style={css("font-weight:600")}>{l.name}<div style={css("font-size:11px;color:#A1A1AA;font-weight:400")}>{l.title || l.email}</div>
                {(byLead[l.id] || l.workedBy.length > 0) && (
                  <div style={css("display:flex;align-items:center;gap:6px;margin-top:4px")}>
                    <LivePulse info={byLead[l.id]} />
                    <WorkedBy ids={l.workedBy} byId={byId} />
                  </div>
                )}
              </div>
```

(Only the first cell of the Active row changes — the Company/Agent/Stage/Score/Actions cells stay as-is. The Pending candidates table is unchanged — candidates aren't worked.)

- [ ] **Step 3: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors.

- [ ] **Step 4: Commit.**

```bash
git add "agentic-salesforce/app/leads/page.tsx"
git commit -m "Leads page: worked-by trail + live pulse on active rows"
```

---

## Task 4: Agent workbook rows

**Files:** Modify `app/agents/[id]/page.tsx`.

**Interfaces:** Consumes `useLiveWork`, `WorkedBy`/`LivePulse`, `agentLeads[].workedBy`, `byId`.

- [ ] **Step 1: Imports + hook.** In `app/agents/[id]/page.tsx`, add:

```ts
import { useLiveWork } from "@/lib/useLiveWork";
import { WorkedBy, LivePulse } from "@/components/LeadBits";
```

In the component body (where `byId` from `useApp()` and other hooks are), add:

```ts
  const { byLead } = useLiveWork();
```

- [ ] **Step 2: Render in the workbook row.** In the Leads section's `agentLeads.map((l) => …)` row, find the Name cell (`{l.name}` with its sub-line) and append the live/worked-by group inside it:

```tsx
                  <div style={css("font-weight:600")}>{l.name}<div style={css("font-size:11px;color:#A1A1AA;font-weight:400")}>{l.title || l.email}</div>
                    {(byLead[l.id] || l.workedBy.length > 0) && (
                      <div style={css("display:flex;align-items:center;gap:6px;margin-top:4px")}>
                        <LivePulse info={byLead[l.id]} />
                        <WorkedBy ids={l.workedBy} byId={byId} />
                      </div>
                    )}
                  </div>
```

(Match the existing Name-cell markup and only append the `{(byLead… )}` group inside it; leave the Agent/Company/Status/Score/Added cells unchanged. Read the current row first to anchor exactly.)

- [ ] **Step 3: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors.

- [ ] **Step 4: Commit.**

```bash
git add "agentic-salesforce/app/agents/[id]/page.tsx"
git commit -m "Agent workbook: worked-by trail + live pulse on lead rows"
```

---

## Task 5: Team page rows + "Working now" strip

**Files:** Modify `app/teams/[id]/page.tsx`.

**Interfaces:** Consumes `useLiveWork` (`live` + `byLead`), `WorkedBy`/`LivePulse`, `teamLeads[].workedBy`, `byId`, `team.members`.

- [ ] **Step 1: Imports + hook.** In `app/teams/[id]/page.tsx`, add:

```ts
import { useLiveWork } from "@/lib/useLiveWork";
import { WorkedBy, LivePulse } from "@/components/LeadBits";
```

In the component body (before the `if (!team) return null;` guard, alongside the other hooks), add:

```ts
  const { live, byLead } = useLiveWork();
```

- [ ] **Step 2: "Working now" strip.** In the render, after the KPIs grid and before the two-column layout (or right after the header card), add a strip that shows only when a team member is active:

```tsx
      {(() => {
        const active = live.filter((w) => team.members.includes(w.agentId));
        if (active.length === 0) return null;
        return (
          <div style={css("display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:#F0FBF3;border:1px solid #CFEBD8;border-radius:12px;padding:10px 14px")}>
            <span style={css("font-size:12px;font-weight:700;color:#1B7A3D")}>Working now</span>
            {active.map((w) => {
              const verb = w.capability === "research" ? "researching" : w.capability === "outreach" ? "drafting" : w.capability;
              return <span key={w.agentId} style={css("display:inline-flex;align-items:center;gap:5px;font-size:12px;color:#3F3F46")}><span style={css("width:6px;height:6px;border-radius:50%;background:#2FA45C;animation:pulse 1.4s ease-in-out infinite")} />{w.agentName.split(" ")[0]} — {verb} {w.leadIds.length}</span>;
            })}
          </div>
        );
      })()}
```

- [ ] **Step 3: Rows.** In the "Team leads" card's `teamLeads.slice(0, 12).map((l) => …)` row, append the live/worked-by group to the lead's name block:

```tsx
                      <div style={css("font-size:12.5px;font-weight:600;min-width:0;flex:1")}>{l.name}<span style={css("font-size:11px;color:#A1A1AA;font-weight:400")}>{l.company ? " · " + l.company : ""}</span>
                        {(byLead[l.id] || l.workedBy.length > 0) && (
                          <div style={css("display:flex;align-items:center;gap:6px;margin-top:3px")}>
                            <LivePulse info={byLead[l.id]} />
                            <WorkedBy ids={l.workedBy} byId={byId} />
                          </div>
                        )}
                      </div>
```

(Only the name block changes; the assigned-agent avatar on the right stays.)

- [ ] **Step 4: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors.

- [ ] **Step 5: Manual check.** With `pnpm dev`: after research + outreach have run, lead rows on the Leads page, agent workbook, and team book show the worker avatars (un-worked leads show none). Click **Work the book** on a team → while it runs, affected rows pulse "…researching/drafting…" and the team page shows a **"Working now"** strip; both clear when the run finishes.

- [ ] **Step 6: Commit.**

```bash
git add "agentic-salesforce/app/teams/[id]/page.tsx"
git commit -m "Team page: worked-by + live pulse on team-book rows + Working-now strip"
```

---

## Self-Review

**Spec coverage:**
- Part A (`workedBy` on `LeadDTO` via central `toLeadDTOs`, rendered as avatar cluster on every surface) → Task 1 (data), Tasks 3/4/5 (render). Shared `WorkedBy` → Task 2.
- Part B (`getLiveWork` from running jobs, `useLiveWork` polling, per-lead `LivePulse`, team "Working now" strip) → Task 1 (`getLiveWork`), Task 2 (`liveWork`/hook/`LivePulse`/keyframe), Tasks 3/4/5 (pulse), Task 5 (strip).

**Placeholder scan:** every step has complete code. The row edits reference existing name-cell markup to append into (implementer reads the anchor) — not omitted new code.

**Type consistency:** `LeadDTO.workedBy: string[]` (Task 1) is set `[]` by `toLeadDTO` and filled by `toLeadDTOs`, consumed by `WorkedBy` (Task 2) on all rows (Tasks 3/4/5). `LiveWorkDTO` (Task 1) is returned by `getLiveWork` (Task 1) → `liveWork` (Task 2) → `useLiveWork` (Task 2) → `byLead`/`live` (Tasks 3/4/5). `WorkedBy({ ids, byId })` / `LivePulse({ info })` prop shapes (Task 2) match the call sites (Tasks 3/4/5). The `pulse` keyframe (Task 2) backs the `animation:pulse …` in `LivePulse` + the team strip (Task 5).
