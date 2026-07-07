# Pod Auto-Hand-off + Approval Modes (Slice 2a) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A team **"Work the book"** action that runs the shared book through research → outreach, **auto-handing off** stage to stage, pausing at any capability an agent's owner set to **Ask** (surfaced as a team-page approval).

**Architecture:** A new server-only `lib/pod/` module resolves team members + capabilities + approval modes and enqueues/chains pod-stage `jobs`. The existing Node runner gains chaining: when a `params.pod` stage completes, it enqueues the next stage. Approvals are `jobs` with `status='needs_approval'`. **No migration** — `jobs.status`/`params` and `agent_config.settings` are existing free-form columns.

**Tech Stack:** Next.js 14 App Router / TypeScript / Drizzle / Neon / Gemini (existing engines).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-08-pod-auto-handoff-and-approvals-design.md`.
- **Git identity:** commit as the user only — `Ghousted <clydepadua091@gmail.com>`. **Never** a `Co-Authored-By: Claude` / AI-attribution line.
- **No push.** `.env.local` stays gitignored.
- **No unit-test framework.** Verification is `npx tsc --noEmit` (from `agentic-salesforce/`) clean + code review + manual. No test framework, no migration.
- **User-scoping:** every `jobs`/`agent_config`/`leads` read+write filters by the session `userId`.
- **Runner isolation:** the runner still claims only `queued` `outreach`+`research` (never `scrape`). Only `params.pod` jobs chain; manual "Run outreach"/"Research leads" (no `params.pod`) are unaffected.
- **Follow patterns:** server helpers mirror `lib/leads/store.ts` / `lib/teams/membership.ts`; UI uses `css()`/`Box`/`Btn`; capability ids are `"research"|"outreach"|…` and equal `jobs.kind`.
- **Deferred (Slice 2b / later):** live "who's on it" view; global approvals badge; follow-up/book-meeting stages; event-driven auto-start; multi-batch looping (2a processes up to `POD_BATCH` per run).

---

## File Structure

- `lib/teams/membership.ts` — MODIFY: add `membersOfTeam`.
- `lib/pod/types.ts` — CREATE: `ApprovalDTO`, `POD_ORDER`, `POD_BATCH`.
- `lib/pod/orchestrate.ts` — CREATE: resolution + `enqueuePodStage` + `chainNext` (server-only).
- `lib/pod/actions.ts` — CREATE: `workTheBook`/`listPendingApprovals`/`approveJob`/`rejectJob` (`"use server"`).
- `app/api/jobs/run/route.ts` — MODIFY: chain the next pod stage on completion.
- `app/agents/[id]/page.tsx` — MODIFY: Autonomy control (per-capability Auto/Ask).
- `app/teams/[id]/page.tsx` — MODIFY: "Work the book" + pending-approvals list.

---

## Task 1: Pod resolution module

**Files:** Modify `lib/teams/membership.ts`; Create `lib/pod/types.ts`, `lib/pod/orchestrate.ts`.

**Interfaces:** Produces `membersOfTeam(userId, teamId)`; `POD_ORDER`/`POD_BATCH`/`ApprovalDTO`; and from `orchestrate.ts`: `agentInfo`, `memberWithCapability`, `approvalMode`, `countPending`, `enqueuePodStage`, `firstStage`, `nextStageAfter`, `chainNext`.

- [ ] **Step 1: Add `membersOfTeam`.** In `lib/teams/membership.ts`, change the drizzle import to include `and`:

```ts
import { and, eq } from "drizzle-orm";
```

Then add (after `teammatesOf`):

```ts
/** The agent ids on a team (team_members override, else base members). */
export async function membersOfTeam(userId: string, teamId: string): Promise<string[]> {
  if (!isDbConfigured()) return TEAMS_BASE.find((t) => t.id === teamId)?.members ?? [];
  const db = getDb();
  const [override] = await db.select().from(teamMembers)
    .where(and(eq(teamMembers.userId, userId), eq(teamMembers.teamId, teamId))).limit(1);
  if (override) return override.members;
  const seed = TEAMS_BASE.find((t) => t.id === teamId);
  if (seed) return seed.members;
  const [userTeam] = await db.select().from(teamsTable)
    .where(and(eq(teamsTable.userId, userId), eq(teamsTable.id, teamId))).limit(1);
  return userTeam?.members ?? [];
}
```

- [ ] **Step 2: Create `lib/pod/types.ts`.**

```ts
// Pod pipeline shared constants + DTOs (importable by client + server).
export const POD_ORDER = ["research", "outreach"] as const;
export type PodStage = (typeof POD_ORDER)[number];
export const POD_BATCH = 20;

export interface ApprovalDTO {
  id: string;
  agentName: string;
  capability: string;
  leadCount: number;
}
```

- [ ] **Step 3: Create `lib/pod/orchestrate.ts`.**

```ts
import "server-only";
// Pod orchestration: resolve a team's members/capabilities/approval-modes and
// enqueue or chain pod-stage jobs. Server-only. No engine work here — it wires
// the existing research/outreach jobs into an auto-handed-off pipeline.
import { and, eq } from "drizzle-orm";
import { getDb, isDbConfigured, agents, agentConfig, jobs } from "@/lib/db";
import { AGENTS_BASE } from "@/lib/data";
import { membersOfTeam } from "@/lib/teams/membership";
import { pickLeadsForResearch, pickLeadsForRun } from "@/lib/leads/store";
import { POD_ORDER, POD_BATCH } from "./types";

interface AgentInfo { id: string; name: string; role: string; goal: string; task: string; capabilities: string[] }

/** Merge the static seed roster + the user's created agents to look one up. */
export async function agentInfo(userId: string, agentId: string): Promise<AgentInfo | null> {
  const seed = AGENTS_BASE.find((a) => a.id === agentId);
  if (seed) return { id: seed.id, name: seed.name, role: seed.role, goal: seed.goal, task: seed.task, capabilities: seed.capabilities };
  if (!isDbConfigured()) return null;
  const [row] = await getDb().select().from(agents).where(and(eq(agents.userId, userId), eq(agents.id, agentId))).limit(1);
  if (!row) return null;
  return { id: row.id, name: row.name, role: row.role, goal: row.goal, task: row.task, capabilities: row.capabilities };
}

export async function memberWithCapability(userId: string, teamId: string, capability: string): Promise<string | null> {
  const members = await membersOfTeam(userId, teamId);
  for (const id of members) {
    const info = await agentInfo(userId, id);
    if (info?.capabilities.includes(capability)) return id;
  }
  return null;
}

export async function approvalMode(userId: string, agentId: string, capability: string): Promise<"auto" | "ask"> {
  if (!isDbConfigured()) return "auto";
  const [row] = await getDb().select().from(agentConfig).where(and(eq(agentConfig.userId, userId), eq(agentConfig.agentId, agentId))).limit(1);
  const settings = row?.settings as Record<string, { mode?: string }> | null | undefined;
  return settings?.[capability]?.mode === "ask" ? "ask" : "auto";
}

/** How many book leads the stage would process now (for the approval count). */
export async function countPending(userId: string, agentId: string, capability: string): Promise<number> {
  const pick = capability === "research" ? pickLeadsForResearch : pickLeadsForRun;
  const rows = await pick(userId, agentId, undefined, POD_BATCH);
  return rows.length;
}

export async function enqueuePodStage(userId: string, teamId: string, capability: string, agentId: string): Promise<void> {
  const info = await agentInfo(userId, agentId);
  if (!info) return;
  const mode = await approvalMode(userId, agentId, capability);
  const leadCount = await countPending(userId, agentId, capability);
  await getDb().insert(jobs).values({
    userId, agentId, kind: capability,
    status: mode === "ask" ? "needs_approval" : "queued",
    params: {
      agent: { id: info.id, name: info.name, role: info.role, goal: info.goal, task: info.task },
      teamId, pod: true, leadCount, batchSize: POD_BATCH, leadIds: null,
    },
  });
}

/** The first pod stage the team can cover + the member responsible. */
export async function firstStage(userId: string, teamId: string): Promise<{ capability: string; agentId: string } | null> {
  for (const cap of POD_ORDER) {
    const agentId = await memberWithCapability(userId, teamId, cap);
    if (agentId) return { capability: cap, agentId };
  }
  return null;
}

export function nextStageAfter(capability: string): string | null {
  const i = (POD_ORDER as readonly string[]).indexOf(capability);
  return i >= 0 && i + 1 < POD_ORDER.length ? POD_ORDER[i + 1] : null;
}

/** After a pod stage completes, enqueue the next stage for the right team agent. */
export async function chainNext(userId: string, teamId: string, completedKind: string): Promise<void> {
  const nextCap = nextStageAfter(completedKind);
  if (!nextCap) return;
  const agentId = await memberWithCapability(userId, teamId, nextCap);
  if (!agentId) return;
  await enqueuePodStage(userId, teamId, nextCap, agentId);
}
```

- [ ] **Step 4: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors. (`agents`/`agentConfig`/`jobs` from `@/lib/db`; `AGENTS_BASE` from `@/lib/data`; the picks from `@/lib/leads/store`.)

- [ ] **Step 5: Commit.**

```bash
git add agentic-salesforce/lib/teams/membership.ts agentic-salesforce/lib/pod/types.ts agentic-salesforce/lib/pod/orchestrate.ts
git commit -m "Pod orchestration module: team/capability/mode resolution + enqueue/chain"
```

---

## Task 2: Pod actions

**Files:** Create `lib/pod/actions.ts`.

**Interfaces:** Consumes Task 1's orchestrate. Produces `workTheBook(teamId)`, `listPendingApprovals(teamId)`, `approveJob(id)`, `rejectJob(id)`.

- [ ] **Step 1: Write `lib/pod/actions.ts`.**

```ts
"use server";
// Client-facing pod actions: start the pipeline, list pending approvals, and
// approve/reject a gated stage. All user-scoped.
import { and, desc, eq } from "drizzle-orm";
import { getDb, isDbConfigured, jobs } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { firstStage, enqueuePodStage, approvalMode } from "./orchestrate";
import type { ApprovalDTO } from "./types";

async function uid(): Promise<string | null> {
  const s = await getSession();
  return s?.userId ?? null;
}

export async function workTheBook(teamId: string): Promise<{ started: boolean; needsApproval?: boolean; error?: string }> {
  if (!isDbConfigured()) return { started: false, error: "Server not configured." };
  const userId = await uid();
  if (!userId) return { started: false, error: "Not signed in." };
  const first = await firstStage(userId, teamId);
  if (!first) return { started: false, error: "This team has no research or outreach agent to run the pod." };
  const mode = await approvalMode(userId, first.agentId, first.capability);
  await enqueuePodStage(userId, teamId, first.capability, first.agentId);
  return { started: true, needsApproval: mode === "ask" };
}

export async function listPendingApprovals(teamId: string): Promise<ApprovalDTO[]> {
  if (!isDbConfigured()) return [];
  const userId = await uid();
  if (!userId) return [];
  const rows = await getDb().select().from(jobs)
    .where(and(eq(jobs.userId, userId), eq(jobs.status, "needs_approval"))).orderBy(desc(jobs.createdAt));
  return rows
    .filter((r) => (r.params as { teamId?: string })?.teamId === teamId)
    .map((r) => {
      const p = r.params as { agent?: { name?: string }; leadCount?: number };
      return { id: r.id, agentName: p.agent?.name ?? "Agent", capability: r.kind, leadCount: p.leadCount ?? 0 };
    });
}

export async function approveJob(id: string): Promise<void> {
  if (!isDbConfigured()) return;
  const userId = await uid();
  if (!userId) return;
  await getDb().update(jobs).set({ status: "queued" })
    .where(and(eq(jobs.id, id), eq(jobs.userId, userId), eq(jobs.status, "needs_approval")));
}

export async function rejectJob(id: string): Promise<void> {
  if (!isDbConfigured()) return;
  const userId = await uid();
  if (!userId) return;
  await getDb().update(jobs).set({ status: "dismissed", finishedAt: new Date() })
    .where(and(eq(jobs.id, id), eq(jobs.userId, userId), eq(jobs.status, "needs_approval")));
}
```

- [ ] **Step 2: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors.

- [ ] **Step 3: Commit.**

```bash
git add agentic-salesforce/lib/pod/actions.ts
git commit -m "Pod actions: workTheBook + listPendingApprovals + approve/reject"
```

---

## Task 3: Runner chaining

**Files:** Modify `app/api/jobs/run/route.ts`.

**Interfaces:** Consumes `chainNext` (Task 1). A completed `params.pod` stage enqueues the next stage.

- [ ] **Step 1: Import `chainNext`.** In `app/api/jobs/run/route.ts`, after the existing imports, add:

```ts
import { chainNext } from "@/lib/pod/orchestrate";
```

- [ ] **Step 2: Widen the `params` cast.** Change the `params` cast (line ~39) to carry the pod fields:

```ts
    const params = candidate.params as { agent: AgentSnapshot; leadIds: string[] | null; batchSize: number; pod?: boolean; teamId?: string };
```

- [ ] **Step 3: Chain the next stage.** Immediately AFTER the `if (candidate.kind === "outreach") { … } else if … else { … }` block closes and BEFORE the `} catch (e) {`, add:

```ts
      if (params.pod && params.teamId && (candidate.kind === "outreach" || candidate.kind === "research")) {
        await chainNext(userId, params.teamId, candidate.kind);
      }
```

(This runs only after a pod stage reached `done` inside the `try`; a failed stage throws to the `catch` and doesn't chain. Non-pod jobs have no `params.pod`, so they never chain.)

- [ ] **Step 4: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors.

- [ ] **Step 5: Commit.**

```bash
git add agentic-salesforce/app/api/jobs/run/route.ts
git commit -m "Runner: chain the next pod stage when a pod job completes"
```

---

## Task 4: Autonomy control (per-capability Auto/Ask)

**Files:** Modify `app/agents/[id]/page.tsx`.

**Interfaces:** Reads/writes `agent_config.settings[cap].mode` via the store's `saveConfig`.

- [ ] **Step 1: Import CAPABILITIES.** In `app/agents/[id]/page.tsx`, add to the `@/lib/agentTypes` import (or add the import if absent):

```ts
import { CAPABILITIES } from "@/lib/agentTypes";
```

- [ ] **Step 2: Add mode read/write helpers.** In the component body (after `const selM = …` / `visibleSections`, where `sel` and `saveConfig` are in scope), add:

```ts
  const capMode = (cap: string): "auto" | "ask" =>
    ((s.agentConfig[sel.id]?.settings?.[cap] as { mode?: string } | undefined)?.mode === "ask" ? "ask" : "auto");
  const setCapMode = (cap: string, mode: "auto" | "ask") => {
    const cur = s.agentConfig[sel.id]?.settings ?? {};
    saveConfig(sel.id, { settings: { ...cur, [cap]: { ...(cur[cap] ?? {}), mode } } });
  };
```

- [ ] **Step 3: Render the Autonomy block.** In the Configuration section (the card at `id="sec-settings"`), after the Permissions block and BEFORE the "Save changes" `<Btn>`, add:

```tsx
        {sel.capabilities && sel.capabilities.length > 0 && (
          <div>
            <div style={css("font-size:12px;font-weight:600;color:#3F3F46;margin-bottom:6px")}>Autonomy</div>
            <div style={css("font-size:11px;color:#A1A1AA;margin-bottom:8px")}>How this agent runs each capability inside a team pod.</div>
            <div style={css("display:flex;flex-direction:column;gap:8px")}>
              {sel.capabilities.map((cap) => {
                const mode = capMode(cap);
                const label = CAPABILITIES.find((c) => c.id === cap)?.label ?? cap;
                return (
                  <div key={cap} style={css("display:flex;align-items:center;font-size:12.5px;color:#3F3F46")}>{label}
                    <div style={css("margin-left:auto;display:flex;background:#F4F4F5;border-radius:99px;padding:2px")}>
                      <Box onClick={() => setCapMode(cap, "auto")} style={"padding:4px 13px;font-size:11.5px;font-weight:600;border-radius:99px;cursor:pointer;" + (mode === "auto" ? "background:#fff;color:#18181B;box-shadow:0 1px 2px rgba(0,0,0,.08)" : "color:#71717A")}>Auto</Box>
                      <Box onClick={() => setCapMode(cap, "ask")} style={"padding:4px 13px;font-size:11.5px;font-weight:600;border-radius:99px;cursor:pointer;" + (mode === "ask" ? "background:#fff;color:#5122C1;box-shadow:0 1px 2px rgba(0,0,0,.08)" : "color:#71717A")}>Ask</Box>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
```

(`Box` is already imported; `sel.capabilities` is `string[]`; `saveConfig` persists the settings partial-upsert immediately, independent of the "Save changes" button which handles role/goal/permissions.)

- [ ] **Step 4: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors.

- [ ] **Step 5: Manual check.** With `pnpm dev`: an agent's Configuration tab shows an **Autonomy** list of its capabilities each with an Auto/Ask toggle; flipping one to Ask and reloading the page keeps it (persisted to `agent_config.settings`).

- [ ] **Step 6: Commit.**

```bash
git add "agentic-salesforce/app/agents/[id]/page.tsx"
git commit -m "Agent detail: Autonomy control (per-capability Auto/Ask mode)"
```

---

## Task 5: Team page — Work the book + approvals

**Files:** Modify `app/teams/[id]/page.tsx`.

**Interfaces:** Consumes `workTheBook`/`listPendingApprovals`/`approveJob`/`rejectJob` (Task 2) + `ApprovalDTO`.

- [ ] **Step 1: Imports + state.** In `app/teams/[id]/page.tsx`, add:

```ts
import { workTheBook, listPendingApprovals, approveJob, rejectJob } from "@/lib/pod/actions";
import type { ApprovalDTO } from "@/lib/pod/types";
```

Add `showToast` to the `useApp()` destructure (`const { agents, teams, byId, addTeamMembers, showToast } = useApp();`). Add state near `teamLeads`:

```ts
  const [approvals, setApprovals] = useState<ApprovalDTO[]>([]);
  const [working, setWorking] = useState(false);
```

- [ ] **Step 2: Load approvals.** Extend the existing team-leads effect (or add one) to also load approvals when `team` is set. In the effect that loads `teamLeads`, add an approvals load:

```ts
  useEffect(() => {
    if (memberIds.length) listLeadsForAgents(memberIds).then(setTeamLeads);
    else setTeamLeads([]);
    if (team) listPendingApprovals(team.id).then(setApprovals);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberIds.join(","), team?.id]);
```

- [ ] **Step 3: Handlers.** After the `confirmAdd` handler, add:

```ts
  const refetchPod = () => {
    if (!team) return;
    listPendingApprovals(team.id).then(setApprovals);
    if (memberIds.length) listLeadsForAgents(memberIds).then(setTeamLeads);
  };
  const runBook = async () => {
    if (!team) return;
    setWorking(true);
    const res = await workTheBook(team.id);
    if (res.error) showToast(res.error);
    else if (res.needsApproval) showToast("Sent for your approval below");
    else { try { await fetch("/api/jobs/run", { method: "POST" }); } catch { /* best-effort */ } showToast("Working the book…"); }
    setWorking(false);
    refetchPod();
  };
  const approve = async (id: string) => { await approveJob(id); try { await fetch("/api/jobs/run", { method: "POST" }); } catch {} refetchPod(); };
  const reject = async (id: string) => { await rejectJob(id); refetchPod(); };
```

- [ ] **Step 4: "Work the book" button.** In the header card, next to the existing "+ Add agents" `<Btn>`, add a Work-the-book button (change the `<Btn>`'s `margin-left:auto` grouping so both sit at the right — wrap the two buttons in a flex `div`):

```tsx
        <div style={css("margin-left:auto;display:flex;gap:8px;flex:none")}>
          <Btn onClick={runBook} style={"background:#5122C1;color:#fff;border:none;border-radius:99px;padding:8px 18px;font-size:12.5px;font-weight:600;cursor:pointer;" + (working ? "opacity:.6" : "")} styleHover="background:#42199E">{working ? "Working…" : "Work the book"}</Btn>
          <Btn onClick={openAdd} style="background:#F4F4F5;color:#3F3F46;border:none;border-radius:99px;padding:8px 18px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#E4E4E7">+ Add agents</Btn>
        </div>
```

(Replace the existing single `+ Add agents` `<Btn>` — which had `margin-left:auto` — with this wrapper containing both. The `openAdd` handler is unchanged.)

- [ ] **Step 5: Pending-approvals card.** In the right column (after the "Shared goal" card, before "Recent activity"), add a card that shows only when there are approvals:

```tsx
          {approvals.length > 0 && (
            <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:16px 18px")}>
              <div style={css("font-size:13.5px;font-weight:700;margin-bottom:10px")}>Pending approvals <span style={css("font-size:11px;font-weight:700;color:#fff;background:#5122C1;border-radius:99px;padding:1px 7px")}>{approvals.length}</span></div>
              <div style={css("display:flex;flex-direction:column;gap:10px")}>
                {approvals.map((ap) => (
                  <div key={ap.id} style={css("border:1px solid #F0F0F3;border-radius:12px;padding:10px 12px")}>
                    <div style={css("font-size:12px;color:#3F3F46")}><span style={css("font-weight:600")}>{ap.agentName}</span> wants to {ap.capability} for {ap.leadCount} lead{ap.leadCount === 1 ? "" : "s"}.</div>
                    <div style={css("display:flex;gap:8px;margin-top:9px")}>
                      <Btn onClick={() => approve(ap.id)} style="border:none;border-radius:8px;padding:5px 12px;font-size:11.5px;font-weight:600;cursor:pointer;background:#E7F7EC;color:#1B7A3D" styleHover="background:#D6EFDD">Approve</Btn>
                      <Btn onClick={() => reject(ap.id)} style="border:none;border-radius:8px;padding:5px 12px;font-size:11.5px;font-weight:600;cursor:pointer;background:#F4F4F5;color:#71717A" styleHover="background:#E4E4E7">Reject</Btn>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
```

- [ ] **Step 6: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors.

- [ ] **Step 7: Manual check.** With `pnpm dev` (+ a real Gemini key for real output): on a team with a researcher (Auto) + writer (Auto) and accepted book leads, **Work the book** → the book is briefed then drafted in one run (drafts appear on the writer's agent page). Set the writer's outreach to **Ask** (Task 4) → Work the book → research runs, then a "…wants to outreach for N leads" approval appears; **Approve** → drafts appear; **Reject** → clears with no drafts. Non-pod "Run outreach" on an agent still works unchanged.

- [ ] **Step 8: Commit.**

```bash
git add "agentic-salesforce/app/teams/[id]/page.tsx"
git commit -m "Team page: Work the book + pending-approvals (approve/reject)"
```

---

## Self-Review

**Spec coverage:**
- Part A (per-capability Auto/Ask in `agent_config.settings`, agent-detail Autonomy control) → Task 4 (read/write via `saveConfig`); consumed by `approvalMode` → Task 1.
- Part B ("Work the book" first-stage resolution + `enqueuePodStage` + runner chaining) → Task 1 (`firstStage`/`enqueuePodStage`/`chainNext`), Task 2 (`workTheBook`), Task 3 (runner chain). `POD_ORDER`/`POD_BATCH` → Task 1 types.
- Part C (approvals as `needs_approval` jobs, team-page inline, approve/reject resumes the pod) → Task 2 (`listPendingApprovals`/`approveJob`/`rejectJob`), Task 5 (team-page UI). Approve → `queued` + kick runner → chains next.

**Placeholder scan:** every step has complete code. The two "…unchanged…"/"replace the existing Btn" notes reference existing markup, not omitted new code.

**Type consistency:** `POD_ORDER`/`POD_BATCH`/`ApprovalDTO` (Task 1 types) are used by `orchestrate.ts` (Task 1), `actions.ts` (Task 2), and the team page (Task 5). `chainNext(userId, teamId, kind)` (Task 1) matches the runner call (Task 3). `workTheBook`/`listPendingApprovals`/`approveJob`/`rejectJob` (Task 2) match the team-page calls (Task 5). `approvalMode` reads `settings[cap].mode` (Task 1) which the Autonomy control writes (Task 4). `enqueuePodStage` writes `params.pod`/`teamId`/`leadCount` — read by the runner chain (Task 3) and `listPendingApprovals` (Task 2). The runner still claims only `queued` outreach/research; `needs_approval` jobs are never claimed until `approveJob` flips them.
