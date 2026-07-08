# De-Mock Slices 2 + 3 — Dashboard/Analytics/Notifications + Calendar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the invented content on the dashboard, analytics, notifications, and calendar with real workspace aggregates + the real `activity` log, or drop what has no source (money metrics, meetings). After this, no top-level surface renders fabricated data.

**Architecture:** A new `lib/workspace/stats.ts` provides `getWorkspaceStats` (totals + per-agent output + 14-day series) and `listActivity` (the real event log). The dashboard, analytics, and notifications render from those; the calendar renders real `activity` events placed by date. No migration.

**Tech Stack:** Next.js 14 App Router / TypeScript / Drizzle / Neon (existing).

## Global Constraints

- **Specs:** `docs/superpowers/specs/2026-07-08-demock-dashboard-analytics-notifications-design.md` (Slice 2) + `…-demock-calendar-design.md` (Slice 3).
- **Git identity:** commit as the user only — `Ghousted <clydepadua091@gmail.com>`. **Never** a `Co-Authored-By: Claude` / AI-attribution line.
- **No push.** `.env.local` gitignored.
- **No unit-test framework, no migration.** Verification is `npx tsc --noEmit` (from `agentic-salesforce/`) clean + code review + manual.
- **User-scoping:** every read filters by session `userId`. Accepted leads only (`review='accepted'`), mirroring `getAgentStats`.
- **No invented data:** real aggregate or honest empty/drop. Money metrics (pipeline $/revenue) dropped; meetings 0; agent-**score** replaced by real output on these surfaces (the `agents.score` column stays for other pages); trend charts → real per-day activity.
- **Preserve layout/animation:** the dashboard hero + analytics are heavily styled — replace only the mock *values/cells* named; keep the surrounding structure, animations, and unrelated real bits (e.g. `recentConvs`, fleet-health status counts).
- **Deferred:** real meetings + deal $ (await engines).

---

## File Structure

- `lib/workspace/stats.ts` — CREATE: `getWorkspaceStats` + `listActivity` (server-only) + types.
- `lib/workspace/statsActions.ts` — CREATE: `"use server"` wrappers.
- `components/NotificationsBell.tsx` — MODIFY: real activity feed.
- `app/page.tsx` — MODIFY: real hero + spotlight + team cards.
- `app/analytics/page.tsx` — MODIFY: real KPIs + real chart + real ranking.
- `lib/calendar.ts` — MODIFY: `buildCalendar(events, agents)` from real events.
- `app/calendar/page.tsx` — MODIFY: load real events; real summary; empty state.
- `lib/data.ts` — MODIFY (Task 4): remove `ACTIVITY_FEED` (+ `parsePipeline`/`fmtMoney` if no other importer).

---

## Task 1: `lib/workspace/stats.ts` + actions

**Files:** Create `lib/workspace/stats.ts`, `lib/workspace/statsActions.ts`.

**Interfaces:** Produces `WorkspaceStats` + `getWorkspaceStats()`; `ActivityItem` + `listActivity(limit?)`; `"use server"` wrappers.

- [ ] **Step 1: Write `lib/workspace/stats.ts`.**

```ts
import "server-only";
// Real workspace-wide aggregates + the activity log, for the dashboard,
// analytics, notifications, and calendar. User-scoped; accepted leads only.
import { and, desc, eq } from "drizzle-orm";
import { getDb, isDbConfigured, leads, outreachDrafts, activity, jobs } from "@/lib/db";
import { getSession } from "@/lib/auth/session";

export interface WorkspaceStats {
  leadsWorked: number;
  drafted: number;
  sent: number;
  replies: number;
  replyRate: number; // 0-100
  activeAgents: number;
  tasksRunning: number;
  perAgent: { agentId: string; leadsWorked: number; drafted: number; sent: number }[];
  daily: { date: string; drafted: number; sent: number }[]; // last 14 days, oldest→newest (YYYY-MM-DD)
}
export interface ActivityItem { agentId: string; type: string; text: string; createdAt: string }

const EMPTY: WorkspaceStats = { leadsWorked: 0, drafted: 0, sent: 0, replies: 0, replyRate: 0, activeAgents: 0, tasksRunning: 0, perAgent: [], daily: [] };

async function uid(): Promise<string | null> {
  const s = await getSession();
  return s?.userId ?? null;
}

export async function getWorkspaceStats(): Promise<WorkspaceStats> {
  if (!isDbConfigured()) return EMPTY;
  const userId = await uid();
  if (!userId) return EMPTY;
  const db = getDb();

  const [leadRows, draftRows, runningJobs, actRows] = await Promise.all([
    db.select().from(leads).where(and(eq(leads.userId, userId), eq(leads.review, "accepted"))),
    db.select().from(outreachDrafts).where(eq(outreachDrafts.userId, userId)),
    db.select().from(jobs).where(and(eq(jobs.userId, userId), eq(jobs.status, "running"))),
    db.select().from(activity).where(eq(activity.userId, userId)).orderBy(desc(activity.createdAt)).limit(400),
  ]);

  const leadsWorked = leadRows.length;
  const replies = leadRows.filter((l) => l.status === "replied" || l.status === "meeting").length;
  const sent = draftRows.filter((d) => d.status === "sent").length;

  // per-agent output
  const pa: Record<string, { agentId: string; leadsWorked: number; drafted: number; sent: number }> = {};
  const bump = (id: string) => (pa[id] ??= { agentId: id, leadsWorked: 0, drafted: 0, sent: 0 });
  for (const l of leadRows) bump(l.agentId).leadsWorked++;
  for (const d of draftRows) { const r = bump(d.agentId); r.drafted++; if (d.status === "sent") r.sent++; }

  // 14-day series from activity (email_drafted / email_sent) keyed by YYYY-MM-DD
  const days: string[] = [];
  const now = new Date();
  for (let i = 13; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i); days.push(d.toISOString().slice(0, 10)); }
  const dayMap: Record<string, { date: string; drafted: number; sent: number }> = {};
  for (const key of days) dayMap[key] = { date: key, drafted: 0, sent: 0 };
  for (const a of actRows) {
    const key = a.createdAt.toISOString().slice(0, 10);
    const bucket = dayMap[key];
    if (!bucket) continue;
    if (a.type === "email_drafted") bucket.drafted++;
    else if (a.type === "email_sent") bucket.sent++;
  }

  return {
    leadsWorked,
    drafted: draftRows.length,
    sent,
    replies,
    replyRate: leadsWorked ? Math.round((replies / leadsWorked) * 100) : 0,
    activeAgents: new Set(runningJobs.map((j) => j.agentId)).size,
    tasksRunning: runningJobs.length,
    perAgent: Object.values(pa),
    daily: days.map((k) => dayMap[k]),
  };
}

export async function listActivity(limit = 30): Promise<ActivityItem[]> {
  if (!isDbConfigured()) return [];
  const userId = await uid();
  if (!userId) return [];
  const rows = await getDb().select().from(activity)
    .where(eq(activity.userId, userId)).orderBy(desc(activity.createdAt)).limit(limit);
  return rows.map((a) => ({ agentId: a.agentId, type: a.type, text: a.text, createdAt: a.createdAt.toISOString() }));
}
```

- [ ] **Step 2: Write `lib/workspace/statsActions.ts`.**

```ts
"use server";
// Client-facing wrappers for the server-only workspace reads.
import { getWorkspaceStats as _stats, listActivity as _activity, type WorkspaceStats, type ActivityItem } from "./stats";

export async function getWorkspaceStats(): Promise<WorkspaceStats> { return _stats(); }
export async function listActivity(limit?: number): Promise<ActivityItem[]> { return _activity(limit); }
```

- [ ] **Step 3: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors.

- [ ] **Step 4: Commit.**

```bash
git add agentic-salesforce/lib/workspace/stats.ts agentic-salesforce/lib/workspace/statsActions.ts
git commit -m "Add getWorkspaceStats + listActivity (real workspace aggregates + activity log)"
```

---

## Task 2: Notifications → real activity

**Files:** Modify `components/NotificationsBell.tsx`.

**Interfaces:** Consumes `listActivity`. Replaces `ACTIVITY_FEED`/`feedExtra`.

- [ ] **Step 1: Imports + a type→chip map + load.** In `components/NotificationsBell.tsx`, replace the `ACTIVITY_FEED` import (line 6) with:

```ts
import { listActivity } from "@/lib/workspace/statsActions";
import type { ActivityItem } from "@/lib/workspace/stats";
```

Add a top-level map (after the imports, before the component):

```ts
const ACT_CHIP: Record<string, { label: string; bg: string; fg: string }> = {
  lead_added: { label: "Lead", bg: "#E7F7EC", fg: "#1B7A3D" },
  lead_researched: { label: "Research", bg: "#F1EDFD", fg: "#5122C1" },
  email_drafted: { label: "Draft", bg: "#FEF6E8", fg: "#B45309" },
  email_sent: { label: "Sent", bg: "#E9F5FE", fg: "#0369A1" },
};
function actChip(type: string) { return ACT_CHIP[type] ?? { label: type, bg: "#F4F4F5", fg: "#71717A" }; }
function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "now"; if (m < 60) return m + "m"; const h = Math.round(m / 60);
  if (h < 24) return h + "h"; return Math.round(h / 24) + "d";
}
```

- [ ] **Step 2: Load activity into state; drop the seed feed.** In the component, replace the `items` derivation (lines 27-33) with a real load:

```ts
  const [acts, setActs] = useState<ActivityItem[]>([]);
  useEffect(() => { listActivity(12).then(setActs); }, []);
  const items = acts.map((f) => ({ f, a: byId(f.agentId) })).filter((x) => x.a);
  const unread = !seen && items.length > 0;
```

(`useEffect` is already imported.)

- [ ] **Step 3: Render real rows.** In the `items.map(({ f, a }, i) => (…))` block (lines 61-77), replace the chip/time cell to use the real fields — change the row's right-hand `<div>`:

```tsx
                    <div style={css("display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex:none")}>
                      <span style={css(chip(actChip(f.type).bg, actChip(f.type).fg))}>{actChip(f.type).label}</span>
                      <span style={css("font-size:10.5px;color:#A1A1AA")}>{relTime(f.createdAt)}</span>
                    </div>
```

(The `<strong>{a!.name}</strong> {f.text}` line stays — `f.text` is the real activity text.)

- [ ] **Step 4: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors. (`useState`/`useEffect`/`chip`/`av`/`byId` already available.)

- [ ] **Step 5: Commit.**

```bash
git add agentic-salesforce/components/NotificationsBell.tsx
git commit -m "Notifications: real activity-log feed (drop ACTIVITY_FEED seed)"
```

---

## Task 3: Dashboard → real

**Files:** Modify `app/page.tsx`.

**Interfaces:** Consumes `getWorkspaceStats` + `listActivity`. Replaces meetings/pipeline/score/hubPools/feed with real values; preserves the hub animation/layout.

- [ ] **Step 1: Imports + load.** In `app/page.tsx`, change the `@/lib/data` import (line 5) to drop `parsePipeline`/`fmtMoney`:

```ts
import { statusMeta } from "@/lib/data";
```

Add after the other imports:

```ts
import { getWorkspaceStats } from "@/lib/workspace/statsActions";
import { listActivity } from "@/lib/workspace/statsActions";
import type { WorkspaceStats, ActivityItem } from "@/lib/workspace/stats";
```

In the component body (after `const { s, set, agents, teams, byId } = useApp();`), add:

```ts
  const [ws, setWs] = useState<WorkspaceStats | null>(null);
  const [acts, setActs] = useState<ActivityItem[]>([]);
  useEffect(() => { getWorkspaceStats().then(setWs); listActivity(6).then(setActs); }, []);
  const paMap = new Map((ws?.perAgent ?? []).map((p) => [p.agentId, p]));
  const maxOut = Math.max(1, ...(ws?.perAgent ?? []).map((p) => p.leadsWorked));
```

- [ ] **Step 2: Delete the mock consts.** Remove `feedBase` (lines 9-15), `hubPools` (16-25). Keep `hubTypes`/`hubIcons` (they drive the decorative per-agent icon, which is fine to keep as visual flavor keyed by capability — but since `hubPools` is gone, the badge text changes below).

- [ ] **Step 3: Real hub stats.** Replace the hero-stat block (lines 63-82: `hubWorking` through `hubLive2`) with:

```ts
  const hubWorking = ws?.activeAgents ?? 0;
  const leadsWorked = ws?.leadsWorked ?? 0;
  const tasksRunning = ws?.tasksRunning ?? 0;
  const monthLabel = new Date().toLocaleString("en-US", { month: "long" }).toUpperCase();

  const actLine = (f?: ActivityItem) => (f ? (byId(f.agentId)?.name ?? "Agent") + " " + f.text : "");
  const hubLive = actLine(acts[0]).slice(0, 90);
  const hubLive2 = actLine(acts[1]).slice(0, 90);
```

And update the `nodes` map's `badge` (line 59): change `badge: pool[(tick + i) % pool.length]` to the agent's latest activity (or Idle):

```ts
    const latest = acts.find((f) => f.agentId === a.id);
    return { a, i, x, y, m, ic, badge: latest ? latest.text.slice(0, 40) : (a.status === "working" ? "Working…" : "Idle") };
```

(remove the now-unused `const pool = …` line above it.)

- [ ] **Step 4: Ring center → Leads worked.** In the goal-ring JSX (lines 129-133), replace the conic `goalPct` fill with a fixed decorative fill and the center number with `leadsWorked`:
  - Change the conic-gradient `" + goalPct + "%` usages (line 129) → a static ring: replace the whole `background:conic-gradient(...)` value with `background:conic-gradient(#B57BFF 0 100%,rgba(255,255,255,.12) 100% 100%)` (a full ring; purely decorative).
  - Change the center number block (lines 131-132) to:

```tsx
                  <div style={css("font-family:'Poetsen One',sans-serif;font-size:24px;font-weight:700;color:#fff;line-height:1")}>{leadsWorked}</div>
                  <div style={css("font-size:8.5px;font-weight:700;letter-spacing:.12em;color:#A99BD8;margin-top:3px")}>LEADS WORKED · {monthLabel}</div>
```

- [ ] **Step 5: Badges → real, drop pipeline.** In the two badges (lines 137-138): keep the `⚡ {hubWorking} working · {tasksRunning} tasks` badge; **delete** the `{fmtMoney(scopePipeline)} pipeline` badge `<div>` (line 138).

- [ ] **Step 6: Score bar → real output bar.** In the agent node (line 151), replace the score-bar inner width `n.a.score` with the agent's real output scaled to `maxOut`:

```tsx
                <div style={css("width:60px;height:3px;border-radius:2px;background:rgba(255,255,255,.14);overflow:hidden")}><div style={css("width:" + Math.round(((paMap.get(n.a.id)?.leadsWorked ?? 0) / maxOut) * 100) + "%;height:100%;border-radius:2px;background:linear-gradient(90deg," + n.a.color + ",#B57BFF)")} /></div>
```

- [ ] **Step 7: Team cards → real.** Replace the per-team 3-tile block (lines 184-188) with real tiles (Leads worked / Members / Working):

```tsx
              <div style={css("display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:16px")}>
                <div style={css("background:#FAFAFB;border-radius:10px;padding:10px 12px")}><div style={css("font-size:10.5px;color:#A1A1AA")}>Leads</div><div style={css("font-size:17px;font-weight:700;margin-top:2px")}>{t.members.reduce((n, id) => n + (paMap.get(id)?.leadsWorked ?? 0), 0)}</div></div>
                <div style={css("background:#FAFAFB;border-radius:10px;padding:10px 12px")}><div style={css("font-size:10.5px;color:#A1A1AA")}>Members</div><div style={css("font-size:17px;font-weight:700;margin-top:2px")}>{t.members.length}</div></div>
                <div style={css("background:#FAFAFB;border-radius:10px;padding:10px 12px")}><div style={css("font-size:10.5px;color:#A1A1AA")}>Working</div><div style={css("font-size:17px;font-weight:700;margin-top:2px")}>{t.members.filter((id) => byId(id)?.status === "working").length}</div></div>
              </div>
```

- [ ] **Step 8: Remove the now-dead scope/goal consts.** Delete lines 67-74's mock consts that are no longer referenced: `scopeTeams`, `meetingsBooked`, `scopePipeline`, `meetingsTarget`, `goalPct`, `goalDone` (all replaced above). Keep `monthLabel` (moved into Step 3). Verify nothing else references them.

- [ ] **Step 9: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors. Confirm no `parsePipeline`/`fmtMoney`/`hubPools`/`feedBase`/`goalPct`/`scopePipeline` references remain (`grep -n "parsePipeline\|fmtMoney\|hubPools\|feedBase\|goalPct\|scopePipeline" app/page.tsx` empty).

- [ ] **Step 10: Commit.**

```bash
git add agentic-salesforce/app/page.tsx
git commit -m "Dashboard: real hero (leads worked/working/tasks), real spotlight + team cards; drop money/meetings/hubPools"
```

---

## Task 4: Analytics → real

**Files:** Modify `app/analytics/page.tsx`; Modify `lib/data.ts`.

**Interfaces:** Consumes `getWorkspaceStats` + `listActivity`. Replaces money/score/fake-trend with real; then removes `ACTIVITY_FEED` from `lib/data.ts`.

- [ ] **Step 1: Imports + load.** In `app/analytics/page.tsx`, change the `@/lib/data` import (line 4) to drop `parsePipeline`/`fmtMoney` (remove the whole import if nothing else from data is used):

```ts
```

(delete line 4 entirely — `parsePipeline`/`fmtMoney` are the only imports from `@/lib/data` here.)

Add after the other imports:

```ts
import { useEffect, useState } from "react";
import { getWorkspaceStats, listActivity } from "@/lib/workspace/statsActions";
import type { WorkspaceStats, ActivityItem } from "@/lib/workspace/stats";
```

In the component (after `const ct = s.countT;`), add:

```ts
  const [ws, setWs] = useState<WorkspaceStats | null>(null);
  const [acts, setActs] = useState<ActivityItem[]>([]);
  useEffect(() => { getWorkspaceStats().then(setWs); listActivity(8).then(setActs); }, []);
  const paMap = new Map((ws?.perAgent ?? []).map((p) => [p.agentId, p]));
```

- [ ] **Step 2: Delete mock consts + real KPIs.** Remove `feedBase` (lines 8-14), `pipeMonths`/`pipeRamp` (18-19), and the mock aggregates `totalMeetings`/`totalPipeline`/`revenue`/`avgScore` (28,30,31,32) + `pipeSeries`/`pipeMax`/`trendData` (54,55,58-61) + `maxMeetings` (53). Replace `metricDefs` (37-42) with real KPIs:

```ts
  const metricDefs: [string, string, string, string, boolean][] = [
    ["Active Agents", String(ws?.activeAgents ?? 0), "of " + agents.length, (ws?.tasksRunning ?? 0) + " running", true],
    ["Leads Worked", String(ws?.leadsWorked ?? 0), "accepted", "▲ pipeline", true],
    ["Emails Sent", String(ws?.sent ?? 0), "of " + (ws?.drafted ?? 0) + " drafts", "▲ outreach", true],
    ["Reply Rate", (ws?.replyRate ?? 0) + "%", "", (ws?.replyRate ?? 0) >= 20 ? "▲ healthy" : "building", (ws?.replyRate ?? 0) >= 20],
  ];
```

- [ ] **Step 3: Real activity feed.** Replace the `feed` derivation (lines 71-75) with real activity:

```ts
  const feed = acts.map((f) => ({ f, a: byId(f.agentId) })).filter((x) => x.a).slice(0, 6);
```

And in the feed row JSX (lines 113-118), replace the chip/time cell (which used `f.chip`/`f.chipBg`/`f.time`) with type-derived values — change the right-hand cell to:

```tsx
                <div style={css("margin-left:auto;display:flex;align-items:center;gap:8px;flex:none")}><span style={css(chip(actChip(f.type).bg, actChip(f.type).fg))}>{actChip(f.type).label}</span><span style={css("font-size:11px;color:#A1A1AA")}>{relTime(f.createdAt)}</span></div>
```

And the row text (line 116) `{f.text}` stays. Add the same `ACT_CHIP`/`actChip`/`relTime` helpers as Task 2 at the top of this file (before the component).

- [ ] **Step 4: Real outreach-trend chart.** Replace the `trendData.map(...)` bars (lines 163-168) with the real 14-day series from `ws.daily` (drafted purple + sent pink), scaled:

```tsx
          {(ws?.daily ?? []).map((d, i) => {
            const max = Math.max(1, ...(ws?.daily ?? []).map((x) => x.drafted + x.sent));
            return (
              <div key={i} style={css("flex:1;display:flex;flex-direction:column;gap:2px;justify-content:flex-end;height:100%")}>
                <div style={css("background:#5122C1;border-radius:4px 4px 0 0;height:" + Math.round((d.drafted / max) * 90) + "%")} />
                <div style={css("background:#F9BDD3;border-radius:0 0 4px 4px;height:" + Math.round((d.sent / max) * 90) + "%")} />
              </div>
            );
          })}
```

Change the legend labels (lines 158-159) "Emails"/"Replies" → "Drafts"/"Sent".

- [ ] **Step 5: Header line + Organization section.** Replace the header summary line (line 88) with real counts:

```tsx
        <div style={css("font-size:13px;color:#71717A")}>{ws?.activeAgents ?? 0} agents active · {ws?.leadsWorked ?? 0} leads worked · {ws?.sent ?? 0} emails sent</div>
```

Replace `orgKpiDefs` (44-49) with real cuts (drop money):

```ts
  const orgKpiDefs: [string, string, string][] = [
    ["Leads worked", String(ws?.leadsWorked ?? 0), "▲ accepted"],
    ["Drafts", String(ws?.drafted ?? 0), "▲ written"],
    ["Sent", String(ws?.sent ?? 0), "▲ outreach"],
    ["Reply rate", (ws?.replyRate ?? 0) + "%", "▲ engaged"],
  ];
```

- [ ] **Step 6: Team comparison → leads; drop pipeline-by-month; ranking → output; fleet ring → reply rate.**
  - Team comparison title (line 185) "meetings booked" → "leads". The bar width + value (190-191) use real team lead count: replace `t.meetings`/`maxMeetings` with a computed `teamLeads(t)` = sum of members' `paMap` leadsWorked, and `maxTeamLeads`. Add near the other consts:

```ts
  const teamLeads = (t: typeof teams[number]) => t.members.reduce((n, id) => n + (paMap.get(id)?.leadsWorked ?? 0), 0);
  const maxTeamLeads = Math.max(1, ...teams.map(teamLeads));
```

  Then in the bar (190): width `Math.round((teamLeads(t) / maxTeamLeads) * 100)`, value (191) `{teamLeads(t)}`.
  - **Delete** the "Pipeline by month" block entirely (lines 195-204).
  - Agent ranking (83): sort by real output instead of score: `const ranking = agents.slice().sort((a, b) => (paMap.get(b.id)?.leadsWorked ?? 0) - (paMap.get(a.id)?.leadsWorked ?? 0)).slice(0, 5);` and the ranking value (215) `{a.score}` → `{paMap.get(a.id)?.leadsWorked ?? 0}`.
  - Fleet health (223): the conic `avgScore` ring → reply rate. Replace `avgScore` in the conic + center label with `(ws?.replyRate ?? 0)`: the conic `#5122C1 0 " + (ws?.replyRate ?? 0) + "%…` and center `{(ws?.replyRate ?? 0)}%`. (The working/waiting/attention status counts below stay — they're real.)

- [ ] **Step 7: Remove `ACTIVITY_FEED` from `lib/data.ts`.** In `lib/data.ts`, delete the `ACTIVITY_FEED` export (the `ActivityItem` interface + `ACTIVITY_FEED` array). Leave `parsePipeline`/`fmtMoney` (they may be imported elsewhere — check: `grep -rn "parsePipeline\|fmtMoney" app lib components` → if only `lib/data.ts` defines them and nothing imports, they can go too; otherwise keep).

- [ ] **Step 8: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors. Confirm no `parsePipeline`/`fmtMoney`/`avgScore`/`totalPipeline`/`pipeSeries`/`trendData`/`ACTIVITY_FEED` references remain in analytics.

- [ ] **Step 9: Commit.**

```bash
git add agentic-salesforce/app/analytics/page.tsx agentic-salesforce/lib/data.ts
git commit -m "Analytics: real KPIs, per-day chart, output ranking, team-leads bars; drop money/score/fake trends + ACTIVITY_FEED"
```

---

## Task 5: Calendar data — real events

**Files:** Modify `lib/calendar.ts`.

**Interfaces:** `buildCalendar(events, agents)` places real `ActivityItem`s; `CalEvent` carries `createdAt`. `buildMonthGrid` places by real date.

- [ ] **Step 1: Rewrite `lib/calendar.ts`.** Replace the file's fabrication with real-event placement:

```ts
// Calendar model built from real activity events (lib/workspace listActivity),
// placed by their real timestamps. No fabricated events.
import type { Agent } from "./types";
import { av } from "./visuals";
import type { ActivityItem } from "./workspace/stats";

export interface CalEvent {
  createdAt: string;           // ISO — the real event time
  dayIdx: number;              // 0-6 (Mon-Sun) of createdAt
  hourIdx: number;             // 0-9 (8 AM-5 PM), clamped
  title: string;
  initials: string;
  avStyle: string;
  colors: [string, string];    // [bg, fg]
}
export interface CalSummary { label: string; value: string; emoji: string; bg: string; }
export interface CalendarModel {
  summary: CalSummary[];
  hours: string[];
  dayLabels: string[];
  weekRows: { hour: string; cells: CalEvent[][] }[];
  events: CalEvent[];
}
export interface MonthCell { day: number | null; events: CalEvent[]; }
export interface MonthModel { label: string; weeks: MonthCell[][]; }

const CAL_HOURS = ["8 AM", "9 AM", "10 AM", "11 AM", "Noon", "1 PM", "2 PM", "3 PM", "4 PM", "5 PM"];
const CAL_DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const TYPE_META: Record<string, { label: string; colors: [string, string] }> = {
  lead_added: { label: "Lead", colors: ["#E7F7EC", "#1B7A3D"] },
  lead_researched: { label: "Research", colors: ["#F1EDFD", "#5122C1"] },
  email_drafted: { label: "Draft", colors: ["#FEF6E8", "#B45309"] },
  email_sent: { label: "Sent", colors: ["#E9F5FE", "#0369A1"] },
};

function toCalEvent(a: ActivityItem, agent: Agent | undefined): CalEvent {
  const d = new Date(a.createdAt);
  const dayIdx = (d.getDay() + 6) % 7;               // Mon-first
  const hourIdx = Math.max(0, Math.min(9, d.getHours() - 8)); // clamp to 8AM-5PM band
  const meta = TYPE_META[a.type] ?? { label: a.type, colors: ["#F4F4F5", "#71717A"] as [string, string] };
  return {
    createdAt: a.createdAt, dayIdx, hourIdx,
    title: (meta.label + " · " + a.text).slice(0, 60),
    initials: agent?.initials ?? "?",
    avStyle: agent ? av(agent, 24) : "",
    colors: meta.colors,
  };
}

/** Build the week grid + summary from real events (agents used for avatars). */
export function buildCalendar(events: ActivityItem[], agents: Agent[]): CalendarModel {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const cal = events.map((e) => toCalEvent(e, byId.get(e.agentId)));
  const weekRows = CAL_HOURS.map((hour, hourIdx) => ({
    hour,
    cells: CAL_DAY_LABELS.map((_, dayIdx) => cal.filter((e) => e.dayIdx === dayIdx && e.hourIdx === hourIdx)),
  }));
  const activeAgents = new Set(events.map((e) => e.agentId)).size;
  const drafts = events.filter((e) => e.type === "email_drafted").length;
  const sent = events.filter((e) => e.type === "email_sent").length;
  const summary: CalSummary[] = [
    { label: "Events", value: String(events.length), emoji: "🗓", bg: "#E7F7EC" },
    { label: "Drafts", value: String(drafts), emoji: "✍️", bg: "#FEF6E8" },
    { label: "Sent", value: String(sent), emoji: "📨", bg: "#E9F5FE" },
    { label: "Active agents", value: String(activeAgents), emoji: "🤖", bg: "#F1EDFD" },
  ];
  return { summary, hours: CAL_HOURS, dayLabels: CAL_DAY_LABELS, weekRows, events: cal };
}

/** Month grid (Monday-first) placing events on their real day-of-month. */
export function buildMonthGrid(events: CalEvent[], year: number, monthIndex: number): MonthModel {
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const byDay: Record<number, CalEvent[]> = {};
  for (const e of events) {
    const d = new Date(e.createdAt);
    if (d.getFullYear() === year && d.getMonth() === monthIndex) (byDay[d.getDate()] ??= []).push(e);
  }
  const firstWeekday = (new Date(year, monthIndex, 1).getDay() + 6) % 7;
  const cells: MonthCell[] = [];
  for (let b = 0; b < firstWeekday; b++) cells.push({ day: null, events: [] });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, events: byDay[d] ?? [] });
  while (cells.length % 7 !== 0) cells.push({ day: null, events: [] });
  const weeks: MonthCell[][] = [];
  for (let w = 0; w < cells.length; w += 7) weeks.push(cells.slice(w, w + 7));
  return { label: MONTH_NAMES[monthIndex] + " " + year, weeks };
}
```

- [ ] **Step 2: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → this will error at `app/calendar/page.tsx` (it calls `buildCalendar(agents)` + reads `CalEvent.chip`/`withWho`/`type` which are gone). That's expected — Task 6 fixes the page. To keep this task tsc-green on its own, **Task 5 and Task 6 are committed together is NOT allowed** (separate reviewable commits). Instead: after Step 1, run tsc and note the calendar-page errors are the only ones; proceed — Task 6 immediately resolves them. (If the SDD gate requires green tsc per task, treat Tasks 5+6 as one combined task; the implementer should do both before the tsc gate. **Recommended: implement Task 5 + Task 6 together, single tsc gate + commit.**)

- [ ] **Step 3: (Deferred to Task 6's commit.)**

> **NOTE:** Because `lib/calendar.ts` and `app/calendar/page.tsx` are tightly coupled (the type change breaks the page), the implementer does Task 5 **and** Task 6 in one pass, with a single `npx tsc --noEmit` gate and one commit. The split here is descriptive only.

---

## Task 6: Calendar page → real events (paired with Task 5)

**Files:** Modify `app/calendar/page.tsx` (+ the Task 5 `lib/calendar.ts` change; commit together).

**Interfaces:** Loads `listActivity(200)`; passes to `buildCalendar(events, agents)`; renders real summary + grids; empty state.

- [ ] **Step 1: Read the current `app/calendar/page.tsx`** to anchor. It calls `buildCalendar(agents)` and renders `cal.summary`, `cal.weekRows`, `buildMonthGrid(cal.events, …)`, and per-event `ev.chip`/`ev.title`/`ev.initials`/`ev.avStyle`/`ev.colors`/`ev.withWho`.

- [ ] **Step 2: Load real events + pass to the builder.** Add imports:

```ts
import { useEffect, useState } from "react";
import { listActivity } from "@/lib/workspace/statsActions";
import type { ActivityItem } from "@/lib/workspace/stats";
```

Add state + load, and change the `buildCalendar` call from `buildCalendar(agents)` to use the real events:

```ts
  const [events, setEvents] = useState<ActivityItem[]>([]);
  useEffect(() => { listActivity(200).then(setEvents); }, []);
  const cal = useMemo(() => buildCalendar(events, agents), [events, agents]);
```

(If the page already `useMemo`s `buildCalendar(agents)`, change that memo's body + deps.)

- [ ] **Step 3: Fix per-event field references.** `CalEvent` no longer has `chip`/`withWho`/`type`. In the week-grid + month-grid event rendering, use the surviving fields: `ev.title`, `ev.initials`, `ev.avStyle`, `ev.colors` (`[bg,fg]`). Replace any `ev.chip`/`ev.withWho`/`ev.type` usage with `ev.title` + `ev.colors`. (Read the exact JSX and adjust — likely the chip label becomes `ev.title` and the color comes from `ev.colors[0]`/`[1]`.)

- [ ] **Step 4: Empty state.** If `events.length === 0`, the grids render empty (cells just show nothing) — that's the honest empty calendar. Optionally add a subtitle note when `cal.events.length === 0`: "No activity yet — it fills as your agents work." (small `<div>` under the existing subtitle).

- [ ] **Step 5: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors (both `lib/calendar.ts` and the page now agree). Confirm no `CAL_RAW`/`COMPANIES`/`PURPOSES`/`ev.chip`/`ev.withWho` references remain.

- [ ] **Step 6: Manual check.** With `pnpm dev`: a fresh workspace shows the calendar subtitle + empty grid + zero summary. After running the pipeline, `lead_researched`/`email_drafted`/`email_sent` events appear on their real days/hours (week) and days (month), colored by type, with the acting agent's avatar; Week/Month toggle + nav still work.

- [ ] **Step 7: Commit (Tasks 5 + 6 together).**

```bash
git add agentic-salesforce/lib/calendar.ts "agentic-salesforce/app/calendar/page.tsx"
git commit -m "Calendar: render real activity events by date (drop fabricated events)"
```

---

## Self-Review

**Spec coverage:**
- Slice 2 Part A (`getWorkspaceStats`+`listActivity`) → Task 1. Part B (notifications) → Task 2. Part C (dashboard) → Task 3. Part D (analytics) → Task 4. `ACTIVITY_FEED` removed → Task 4.
- Slice 3 (calendar real events) → Tasks 5+6 (paired). `buildCalendar(events,agents)` + `buildMonthGrid` by real date → Task 5; page load + render + empty state → Task 6.

**Placeholder scan:** every step has complete code or an exact edit target. The "lines ~N" are read-anchors, not omitted code. Tasks 5+6 are explicitly paired for a single tsc gate (the type change couples them).

**Type consistency:** `WorkspaceStats`/`ActivityItem` (Task 1) are consumed by Tasks 2/3/4 (notifications/dashboard/analytics) and (`ActivityItem`) by Tasks 5/6 (calendar). `getWorkspaceStats`/`listActivity` action signatures (Task 1) match all call sites. `buildCalendar(events, agents)` new signature (Task 5) matches the page call (Task 6), and `CalEvent`'s new field set (`createdAt`/`title`/`initials`/`avStyle`/`colors`, no `chip`/`withWho`/`type`) matches the page's event rendering (Task 6). `ACT_CHIP`/`actChip`/`relTime` helpers are defined in both Task 2 and Task 4 (each file needs its own copy — they're small and file-local). Money/score/meeting references are all removed by Tasks 3/4; `ACTIVITY_FEED` by Task 4.
