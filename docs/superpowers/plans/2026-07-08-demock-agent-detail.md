# De-Mock Agent Detail (Slice 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the invented content on the agent-detail page with real DB data (Overview counts, Reach Outs, Tasks, Performance from `activity`/`leads`/`outreach_drafts`/`jobs`) or clean empty states (Meetings), and remove the Memory section — retiring `lib/agentDetail.ts`.

**Architecture:** A new server-only `getAgentStats(agentId)` reads the agent's real tables; the page loads it and renders every previously-mock section from it. `lib/agentDetail.ts` (the mock builder) is deleted once nothing imports it. `detail` is removed from the page incrementally — it survives (tsc-green) until the final task converts the last section.

**Tech Stack:** Next.js 14 App Router / TypeScript / Drizzle / Neon (existing).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-08-demock-agent-detail-design.md`.
- **Git identity:** commit as the user only — `Ghousted <clydepadua091@gmail.com>`. **Never** a `Co-Authored-By: Claude` / AI-attribution line.
- **No push.** `.env.local` stays gitignored.
- **No unit-test framework, no migration.** Verification is `npx tsc --noEmit` (from `agentic-salesforce/`) clean + code review + manual.
- **User-scoping:** every `leads`/`outreach_drafts`/`activity`/`jobs` read filters by session `userId` + `agentId`.
- **No invented data:** a section either renders real DB data or an honest empty state. Keep the seed roster (`AGENTS_BASE`/`TEAMS_BASE`) — only fake *content* is removed.
- **`detail`/`buildAgentDetail` stay imported until Task 4** (the last section using them). Each task ends tsc-clean.
- **Deferred:** dashboard/analytics/notifications (Slice 2); calendar (Slice 3); real Memory + real meetings + chat `aiReply` — untouched here.

---

## File Structure

- `lib/agents/stats.ts` — CREATE: `AgentStats` type + `getAgentStats` (server-only).
- `lib/agents/actions.ts` — CREATE: `"use server"` wrapper.
- `app/agents/[id]/page.tsx` — MODIFY: load + render real stats; empty Meetings; remove Memory; drop `detail`.
- `lib/agentDetail.ts` — DELETE (Task 4, once unimported).

---

## Task 1: `getAgentStats` data module

**Files:** Create `lib/agents/stats.ts`, `lib/agents/actions.ts`.

**Interfaces:** Produces `AgentStats` + `getAgentStats(agentId): Promise<AgentStats>` (server) and its `"use server"` wrapper.

- [ ] **Step 1: Write `lib/agents/stats.ts`.**

```ts
import "server-only";
// Real per-agent stats for the agent-detail sub-tabs, from the agent's own rows
// in leads / outreach_drafts / activity / jobs. User-scoped. Replaces the mock
// lib/agentDetail.ts builder.
import { and, desc, eq } from "drizzle-orm";
import { getDb, isDbConfigured, leads, outreachDrafts, activity, jobs } from "@/lib/db";
import { getSession } from "@/lib/auth/session";

export interface AgentStats {
  leadsWorked: number;
  researched: number;
  drafted: number;
  sent: number;
  replies: number;
  replyRate: number; // 0-100
  activity: { type: string; text: string; createdAt: string }[];
  jobs: { kind: string; status: string; createdAt: string; finishedAt: string | null }[];
}

const EMPTY: AgentStats = { leadsWorked: 0, researched: 0, drafted: 0, sent: 0, replies: 0, replyRate: 0, activity: [], jobs: [] };

export async function getAgentStats(agentId: string): Promise<AgentStats> {
  if (!isDbConfigured()) return EMPTY;
  const s = await getSession();
  const userId = s?.userId;
  if (!userId) return EMPTY;
  const db = getDb();

  const [leadRows, draftRows, actRows, jobRows] = await Promise.all([
    db.select().from(leads).where(and(eq(leads.userId, userId), eq(leads.agentId, agentId))),
    db.select().from(outreachDrafts).where(and(eq(outreachDrafts.userId, userId), eq(outreachDrafts.agentId, agentId))),
    db.select().from(activity).where(and(eq(activity.userId, userId), eq(activity.agentId, agentId))).orderBy(desc(activity.createdAt)).limit(12),
    db.select().from(jobs).where(and(eq(jobs.userId, userId), eq(jobs.agentId, agentId))).orderBy(desc(jobs.createdAt)).limit(10),
  ]);

  const leadsWorked = leadRows.length;
  const researched = leadRows.filter((l) => l.research).length;
  const replies = leadRows.filter((l) => l.status === "replied" || l.status === "meeting").length;
  const sent = draftRows.filter((d) => d.status === "sent").length;

  return {
    leadsWorked,
    researched,
    drafted: draftRows.length,
    sent,
    replies,
    replyRate: leadsWorked ? Math.round((replies / leadsWorked) * 100) : 0,
    activity: actRows.map((a) => ({ type: a.type, text: a.text, createdAt: a.createdAt.toISOString() })),
    jobs: jobRows.map((j) => ({ kind: j.kind, status: j.status, createdAt: j.createdAt.toISOString(), finishedAt: j.finishedAt ? j.finishedAt.toISOString() : null })),
  };
}
```

- [ ] **Step 2: Write `lib/agents/actions.ts`.**

```ts
"use server";
// Client-facing wrapper for the server-only agent stats read.
import { getAgentStats as _getAgentStats, type AgentStats } from "./stats";

export async function getAgentStats(agentId: string): Promise<AgentStats> {
  return _getAgentStats(agentId);
}
```

- [ ] **Step 3: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors. (`leads`/`outreachDrafts`/`activity`/`jobs` are exported from `@/lib/db`.)

- [ ] **Step 4: Commit.**

```bash
git add agentic-salesforce/lib/agents/stats.ts agentic-salesforce/lib/agents/actions.ts
git commit -m "Add getAgentStats: real per-agent stats from leads/drafts/activity/jobs"
```

---

## Task 2: Overview → real stats

**Files:** Modify `app/agents/[id]/page.tsx`.

**Interfaces:** Consumes `getAgentStats` + `AgentStats`. Adds `stats` state; converts the Overview section. `detail` stays for the other sections.

- [ ] **Step 1: Import + state.** In `app/agents/[id]/page.tsx`, add after the existing imports (near line 14):

```ts
import { getAgentStats } from "@/lib/agents/actions";
import type { AgentStats } from "@/lib/agents/stats";
```

In the component body, after the `agentLeads` state/effect (around line 90), add:

```ts
  const [stats, setStats] = useState<AgentStats | null>(null);
  useEffect(() => {
    if (selId) getAgentStats(selId).then(setStats);
  }, [selId]);
```

- [ ] **Step 2: Add an activity-label map.** Near the top-level consts (after `LEAD_STAGE_COLORS`, ~line 43), add:

```ts
const ACT_META: Record<string, { label: string; c: [string, string] }> = {
  lead_added: { label: "Lead added", c: ["#F4F4F5", "#71717A"] },
  lead_researched: { label: "Researched", c: ["#F1EDFD", "#5122C1"] },
  email_drafted: { label: "Drafted", c: ["#FEF6E8", "#B45309"] },
  email_sent: { label: "Sent", c: ["#E7F7EC", "#1B7A3D"] },
};
function actMeta(type: string) { return ACT_META[type] ?? { label: type, c: ["#F4F4F5", "#71717A"] as [string, string] }; }
function relTime(iso: string): string { return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
```

- [ ] **Step 3: Replace the AI Summary line.** Change `{detail.summary}` (line ~247) to:

```tsx
              {stats ? `${stats.leadsWorked} lead${stats.leadsWorked === 1 ? "" : "s"} · ${stats.researched} researched · ${stats.drafted} draft${stats.drafted === 1 ? "" : "s"} · ${stats.sent} sent` : "Loading…"}
```

Also change the label above it from `✦ AI Summary — Today` to `✦ Summary` (line ~245: replace the text `AI Summary — Today` with `Summary`).

- [ ] **Step 4: Replace the stats cards.** Change the `{detail.overviewStats.map(([l, v]) => (…))}` block (lines ~251-256) to iterate a real tuple list:

```tsx
            {([["Leads worked", stats?.leadsWorked ?? 0], ["Drafts sent", stats?.sent ?? 0], ["Replies", stats?.replies ?? 0]] as [string, number][]).map(([l, v]) => (
              <div key={l} style={css("background:#fff;border:1px solid #ECECF1;border-radius:14px;padding:14px 16px")}>
                <div style={css("font-size:11.5px;color:#71717A")}>{l}</div>
                <div style={css("font-size:22px;font-weight:700;margin-top:4px")}>{v}</div>
              </div>
            ))}
```

- [ ] **Step 5: Replace accomplishments with real activity.** Change the accomplishments inner `{detail.accomplishments.map(…)}` (lines ~261-263) to:

```tsx
              {!stats || stats.activity.length === 0 ? (
                <div style={css("font-size:12.5px;color:#A1A1AA")}>No activity yet.</div>
              ) : stats.activity.slice(0, 5).map((a, i) => (
                <div key={i} style={css("display:flex;gap:9px;align-items:center;font-size:12.5px;color:#3F3F46")}><span style={css("color:#2FA45C;font-weight:700")}>✓</span>{a.text}</div>
              ))}
```

- [ ] **Step 6: Replace goals with the real goal; remove Next actions.** Change the goals inner `{detail.goals.map(…)}` (line ~271) to a single real goal:

```tsx
              <div style={css("font-size:12px;color:#3F3F46;background:#FAFAFB;border:1px solid #F0F0F3;border-radius:10px;padding:8px 11px")}>{sel.goal}</div>
```

Then delete the entire **Next actions** card — the `<div …>` block containing `<div …>Next actions</div>` and `{detail.nextActions.map(…)}` (lines ~274-281).

- [ ] **Step 7: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors. (`detail` is still used by Reach/Meetings/Tasks/Performance/Memory — keep its import + memo. `sel.goal` is on the agent.)

- [ ] **Step 8: Commit.**

```bash
git add "agentic-salesforce/app/agents/[id]/page.tsx"
git commit -m "Agent Overview: real summary/stats/accomplishments/goal (drop mock + next-actions)"
```

---

## Task 3: Reach Outs + Tasks + Meetings → real / empty

**Files:** Modify `app/agents/[id]/page.tsx`.

**Interfaces:** Consumes `stats.activity` (Reach), `stats.jobs` (Tasks). `detail` stays for Performance/Memory.

- [ ] **Step 1: Reach Outs → real activity timeline.** Replace the Reach Outs body's `{detail.reach.map((r, i) => (…))}` (lines ~392-404) with an activity-driven timeline + empty state:

```tsx
            {!stats || stats.activity.length === 0 ? (
              <div style={css("font-size:12.5px;color:#A1A1AA")}>No reach-outs yet.</div>
            ) : stats.activity.map((a, i) => {
              const m = actMeta(a.type);
              return (
                <div key={i} style={css("display:flex;gap:16px")}>
                  <div style={css("display:flex;flex-direction:column;align-items:center")}>
                    <div style={css("width:12px;height:12px;border-radius:50%;background:" + m.c[1] + ";border:3px solid " + m.c[0] + ";flex:none;margin-top:2px")} />
                    <div style={css("width:2px;flex:1;background:#F0F0F3")} />
                  </div>
                  <div style={css("padding-bottom:20px;min-width:0;flex:1")}>
                    <div style={css("display:flex;align-items:center;gap:8px")}><span style={css(chip(m.c[0], m.c[1]))}>{m.label}</span><span style={css("font-size:11px;color:#A1A1AA")}>{relTime(a.createdAt)}</span></div>
                    <div style={css("font-size:13px;font-weight:600;margin-top:6px")}>{a.text}</div>
                  </div>
                </div>
              );
            })}
```

- [ ] **Step 2: Tasks → real jobs.** Replace the Tasks body `{detail.tasks.map((t, i) => (…))}` (lines ~428-434) with a jobs list + empty state:

```tsx
        {!stats || stats.jobs.length === 0 ? (
          <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:14px;padding:18px;font-size:12.5px;color:#A1A1AA")}>No tasks yet.</div>
        ) : stats.jobs.map((j, i) => {
          const c: [string, string] = j.status === "done" ? ["#E7F7EC", "#1B7A3D"] : j.status === "failed" ? ["#FEECEC", "#B91C1C"] : j.status === "running" ? ["#E9F5FE", "#0369A1"] : ["#FEF6E8", "#B45309"];
          return (
            <div key={i} style={css("background:#fff;border:1px solid #ECECF1;border-radius:14px;padding:14px 18px;display:flex;align-items:center;gap:14px")}>
              <span style={css("display:inline-flex;align-items:center;gap:5px;" + chip(c[0], c[1]))}><span style={css("width:6px;height:6px;border-radius:50%;background:" + c[1])} />{j.status}</span>
              <div style={css("font-size:13px;font-weight:600;text-transform:capitalize")}>{j.kind}</div>
              <div style={css("margin-left:auto;font-size:11px;color:#A1A1AA")}>{relTime(j.finishedAt ?? j.createdAt)}</div>
            </div>
          );
        })}
```

- [ ] **Step 3: Meetings → empty state.** Replace the Meetings body (the `{detail.meetings.length === 0 ? (…) : detail.meetings.map(…)}` block, lines ~413-421) with just the empty state (no real meeting source yet):

```tsx
          <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:22px;font-size:12.5px;color:#A1A1AA")}>No meetings yet.</div>
```

- [ ] **Step 4: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors. (`detail` is still used by Performance + Memory — keep its import + memo until Task 4.)

- [ ] **Step 5: Commit.**

```bash
git add "agentic-salesforce/app/agents/[id]/page.tsx"
git commit -m "Agent Reach Outs (activity) + Tasks (jobs) real; Meetings empty state"
```

---

## Task 4: Performance real + remove Memory + retire the mock builder

**Files:** Modify `app/agents/[id]/page.tsx`; Delete `lib/agentDetail.ts`.

**Interfaces:** Consumes `stats` for Performance. Removes the Memory section + tab, the `detail` memo + `buildAgentDetail` import, and the now-unused chart consts.

- [ ] **Step 1: Performance → real KPIs, drop charts.** Replace the entire Performance section body (the `<div …>` after `<SectionTitle id="sec-analytics">Performance</SectionTitle>` — the KPI grid `{detail.kpis.map(…)}` AND the two chart divs, lines ~439-471) with a real KPI grid only:

```tsx
      <div style={css("display:flex;flex-direction:column;gap:14px;animation:fadeUp .25s ease")}>
        <div style={css("display:grid;grid-template-columns:repeat(4,1fr);gap:14px")}>
          {([["Leads worked", String(stats?.leadsWorked ?? 0)], ["Drafts sent", String(stats?.sent ?? 0)], ["Reply rate", (stats?.replyRate ?? 0) + "%"], ["Researched", String(stats?.researched ?? 0)]] as [string, string][]).map(([l, v]) => (
            <div key={l} style={css("background:#fff;border:1px solid #ECECF1;border-radius:14px;padding:14px 16px")}>
              <div style={css("font-size:11.5px;color:#71717A")}>{l}</div>
              <div style={css("font-size:22px;font-weight:700;margin-top:4px")}>{v}</div>
            </div>
          ))}
        </div>
      </div>
```

- [ ] **Step 2: Remove the Memory section.** Delete the `["memory", "Memory"],` entry from the `SECTIONS` array (line ~27). Then delete the entire Memory block — the `{/* Memory */}` comment, `<SectionTitle id="sec-memory">Memory</SectionTitle>`, and its `<div …>{detail.memory.map(…)}…</div>` (lines ~473 through its closing `</div>`).

- [ ] **Step 3: Remove `detail` + mock import + dead consts.** In `app/agents/[id]/page.tsx`:
  - Delete the import `import { buildAgentDetail } from "@/lib/agentDetail";` (line 6).
  - Delete the `detail` memo (the `const detail = useMemo(() => (sel ? buildAgentDetail(...) : null), [...]);` block, lines ~82-85).
  - Delete the now-unused top-level consts `days` (line 31) and `heatShades` (line 32).
  - The guard `if (!sel || !detail) return null;` (further down) → change to `if (!sel) return null;`.

- [ ] **Step 4: Delete the mock builder.**

```bash
git rm agentic-salesforce/lib/agentDetail.ts
```

- [ ] **Step 5: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors. (Confirm no remaining `detail.` references, no remaining `buildAgentDetail`/`days`/`heatShades` uses. `grep -n "detail\.\|buildAgentDetail\|heatShades\| days\b" app/agents/[id]/page.tsx` should be empty.)

- [ ] **Step 6: Manual check.** With `pnpm dev`: a fresh agent shows Overview "0 leads · 0 researched · …", empty accomplishments/Reach/Tasks, its real goal, zero Performance KPIs, **no Memory tab**, Meetings "No meetings yet." After running research + outreach on it: counts rise, accomplishments + Reach list the real events, Tasks lists the real jobs, Performance shows real numbers. No invented data anywhere.

- [ ] **Step 7: Commit.**

```bash
git add "agentic-salesforce/app/agents/[id]/page.tsx" agentic-salesforce/lib/agentDetail.ts
git commit -m "Agent Performance real KPIs; remove Memory section; delete mock agentDetail builder"
```

---

## Self-Review

**Spec coverage:**
- Part A (`getAgentStats` real read + action, retire `agentDetail.ts`) → Task 1 (module/action), Task 4 (delete builder).
- Part B per-section: Overview summary/stats/accomplishments/goals + drop next-actions → Task 2; Reach Outs (activity) + Tasks (jobs) + Meetings empty → Task 3; Performance real KPIs + drop charts → Task 4; Memory removed → Task 4.

**Placeholder scan:** every step has complete code or an exact deletion target. The "lines ~N" are anchors to read before editing, not omitted code.

**Type consistency:** `AgentStats` (Task 1) is the state type in Task 2 and consumed by Tasks 2/3/4 (`stats.leadsWorked/researched/drafted/sent/replies/replyRate/activity/jobs`). `getAgentStats(agentId)` action (Task 1) matches the page load (Task 2). `actMeta`/`relTime` (Task 2) are used by Reach (Task 3). `detail`/`buildAgentDetail` remain valid through Tasks 2–3 and are fully removed in Task 4 (with `days`/`heatShades` and the guard), so `tsc` is green at every task boundary and no `detail.` reference outlives Task 4.
