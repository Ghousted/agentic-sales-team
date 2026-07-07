# Capability-Driven Agent Details + Calendar Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Agent Details page render only the sections matching an agent's capabilities (adding a per-agent Meetings section), and add a top-level Calendar page ported from the v5 design (weekly grid + functional month grid).

**Architecture:** Both features render deterministic content derived from the live agent roster — the same pattern `lib/agentDetail.ts` already uses. No new DB tables, no server work: a section map filters the agent-detail UI by `agent.capabilities`, and a new pure `lib/calendar.ts` builds the calendar model from the roster.

**Tech Stack:** Next.js 14 App Router / TypeScript / React client components / inline styles via the `css()` helper + `av()`/`chip()`/`navIcon()` visual helpers + `Box`/`Btn` primitives.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-07-capability-driven-agent-detail-and-calendar-design.md`.
- **Git identity:** commit as the user only — `Ghousted <clydepadua091@gmail.com>`. **Never** add a `Co-Authored-By: Claude` line or any AI attribution.
- **No push.** Commit locally only.
- **No unit-test framework.** Verification is `npx tsc --noEmit` (run from `agentic-salesforce/`) clean, plus the manual UI checks each task lists. Do **not** add a test framework or test files.
- **Deterministic mock, no DB.** Meetings and calendar events are derived from the roster (like `buildAgentDetail`). No new tables, migrations, or server actions.
- **Follow existing patterns.** Inline styles via `css("…")`; avatars via `av(agent, size)`; chips via `chip(bg, fg)`; nav glyphs via `navIcon(key, color)`; `Box`/`Btn` from `@/components/primitives`. Capability ids are `"scrape" | "outreach" | "follow-up" | "book-meeting"`.
- **Section order (agent detail):** Overview · Leads · Emails · Reach Outs · **Meetings** · Tasks · Performance · Memory · Configuration. The DOM render order must match this so tab-scroll works.

---

## File Structure

- `lib/agentDetail.ts` — MODIFY: add `MeetingItem` + `meetings` to the model/builder.
- `app/agents/[id]/page.tsx` — MODIFY: capability-driven section map + tab bar + gated Emails/Reach + new Meetings section.
- `lib/calendar.ts` — CREATE: `buildCalendar(agents)` + `buildMonthGrid(events, year, monthIndex)`.
- `lib/visuals.ts` — MODIFY: add a `calendar` glyph to `NAV_PATHS`.
- `app/calendar/page.tsx` — CREATE: the Calendar page.
- `components/Shell.tsx` — MODIFY: add the Calendar nav item + header-title entry.

---

## Task 1: Per-agent Meetings data in `buildAgentDetail`

**Files:**
- Modify: `lib/agentDetail.ts`

**Interfaces:**
- Produces: `MeetingItem` interface and a `meetings: MeetingItem[]` field on `AgentDetailModel`, consumed by Task 2's Meetings section.

- [ ] **Step 1: Add the `MeetingItem` type.** In `lib/agentDetail.ts`, after the `ReachItem` interface (line ~13), add:

```ts
export interface MeetingItem { title: string; withWho: string; purpose: string; time: string; c: [string, string]; }
```

- [ ] **Step 2: Add `meetings` to the model.** In the `AgentDetailModel` interface, after `reach: ReachItem[];`, add:

```ts
  meetings: MeetingItem[];
```

- [ ] **Step 3: Build the meetings.** In `buildAgentDetail`, immediately after the `reach` block (after the `const reach: ReachItem[] = …;` assignment, ~line 211), add:

```ts
  // ---- meetings (upcoming; deterministic from leads) ----
  const meetingTimes = ["Today 2:00p", "Tomorrow 10:30a", "Wed 3:15p", "Thu 11:00a", "Fri 9:30a"];
  const meetingPurposes: Record<Segment, string[]> = {
    recruiting: ["Phone screen", "Final panel", "Hiring debrief", "Offer chat"],
    success: ["Quarterly review", "Renewal call", "Health check", "Expansion review"],
    management: ["Team 1:1", "Pipeline review", "Forecast sync", "Coaching session"],
    fintech: ["Discovery call", "Proposal walkthrough", "Technical deep-dive", "Follow-up sync"],
    healthcare: ["Discovery call", "Proposal walkthrough", "Technical deep-dive", "Follow-up sync"],
    enterprise: ["Discovery call", "Proposal walkthrough", "Technical deep-dive", "Follow-up sync"],
    general: ["Discovery call", "Proposal walkthrough", "Technical deep-dive", "Follow-up sync"],
  };
  const meetings: MeetingItem[] = leads.slice(0, 4).map((l, i) => ({
    title: l.company + " — " + l.name,
    withWho: l.title,
    purpose: meetingPurposes[seg][i % meetingPurposes[seg].length],
    time: meetingTimes[(off + i) % meetingTimes.length],
    c: STATUS_COLORS.Meeting,
  }));
```

- [ ] **Step 4: Return it.** In the `return { … }` object of `buildAgentDetail`, add `meetings` to the list (e.g. after `reach,`):

```ts
    emailStats, emailTimeline, reach, meetings, tasks, kpis, weekVals, heat, memory,
```

- [ ] **Step 5: Type-check.**

Run: `cd agentic-salesforce && npx tsc --noEmit`
Expected: no errors. (`meetings` is now a required field; Task 2 will consume it. Nothing else references the model yet, so tsc stays green.)

- [ ] **Step 6: Commit.**

```bash
git add agentic-salesforce/lib/agentDetail.ts
git commit -m "Add per-agent upcoming meetings to buildAgentDetail"
```

---

## Task 2: Capability-driven sections + Meetings on the agent-detail page

**Files:**
- Modify: `app/agents/[id]/page.tsx`

**Interfaces:**
- Consumes: `detail.meetings` (Task 1); `sel.capabilities` (string[]) from the store agent.
- Produces: a capability-filtered tab bar + section set; a new Meetings section.

- [ ] **Step 1: Replace the static `TABS` with a section map.** In `app/agents/[id]/page.tsx`, replace the `TABS` const (lines 14–17) with:

```ts
// [key, label, requiredCapability?] — no capability ⇒ always shown.
const SECTIONS: [string, string, string?][] = [
  ["overview", "Overview"],
  ["leads", "Leads"],
  ["emails", "Emails", "outreach"],
  ["reach", "Reach Outs", "follow-up"],
  ["meetings", "Meetings", "book-meeting"],
  ["tasks", "Tasks"],
  ["analytics", "Performance"],
  ["memory", "Memory"],
  ["settings", "Configuration"],
];
```

- [ ] **Step 2: Compute the visible sections.** In the component body, right after the guard `if (!sel || !detail) return null;` and the `const selM = …` line (~line 151), add:

```ts
  const caps = sel.capabilities ?? [];
  const visibleSections = SECTIONS.filter(([, , cap]) => !cap || caps.includes(cap));
  const isVisible = (key: string) => visibleSections.some(([k]) => k === key);
```

- [ ] **Step 3: Drive the tab bar from visible sections.** In the sticky tab bar (line ~190), change `{TABS.map(([key, label]) => (` to `{visibleSections.map(([key, label]) => (`. Leave the inner `<Box>` markup unchanged.

- [ ] **Step 4: Gate the Emails section.** Wrap the entire Emails block — the `<SectionTitle id="sec-emails">Emails</SectionTitle>` and its following `<div>…</div>` (lines ~273–298) — in a capability guard:

```tsx
      {isVisible("emails") && (<>
        <SectionTitle id="sec-emails">Emails</SectionTitle>
        <div style={css("display:flex;flex-direction:column;gap:14px;animation:fadeUp .25s ease")}>
          {/* …existing Emails body unchanged… */}
        </div>
      </>)}
```

(Keep the existing Emails body exactly as-is inside the `<div>` — only add the `{isVisible("emails") && (<>` … `</>)}` wrapper around the title + div.)

- [ ] **Step 5: Gate the Reach Outs section.** Wrap the Reach Outs block — `<SectionTitle id="sec-reach">Reach outs</SectionTitle>` and its following `<div>…</div>` (lines ~300–318) — the same way:

```tsx
      {isVisible("reach") && (<>
        <SectionTitle id="sec-reach">Reach outs</SectionTitle>
        <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:20px 22px;animation:fadeUp .25s ease")}>
          {/* …existing Reach Outs body unchanged… */}
        </div>
      </>)}
```

- [ ] **Step 6: Add the Meetings section.** Immediately AFTER the Reach Outs block and BEFORE the `{/* Tasks */}` section, insert:

```tsx
      {/* Meetings */}
      {isVisible("meetings") && (<>
        <SectionTitle id="sec-meetings">Meetings</SectionTitle>
        <div style={css("display:flex;flex-direction:column;gap:10px;animation:fadeUp .25s ease")}>
          {detail.meetings.length === 0 ? (
            <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:22px;font-size:12.5px;color:#A1A1AA")}>No meetings scheduled.</div>
          ) : detail.meetings.map((m, i) => (
            <div key={i} style={css("background:#fff;border:1px solid #ECECF1;border-radius:14px;padding:14px 18px;display:flex;align-items:center;gap:14px")}>
              <span style={css(chip(m.c[0], m.c[1]))}>{m.purpose}</span>
              <div style={css("font-size:13px;font-weight:600")}>{m.title}<div style={css("font-size:11.5px;color:#A1A1AA;font-weight:400;margin-top:1px")}>{m.withWho}</div></div>
              <div style={css("margin-left:auto;font-size:11px;color:#A1A1AA")}>{m.time}</div>
            </div>
          ))}
        </div>
      </>)}
```

- [ ] **Step 7: Type-check.**

Run: `cd agentic-salesforce && npx tsc --noEmit`
Expected: no errors. (`chip` is already imported at the top of this file; `detail.meetings` now exists from Task 1.)

- [ ] **Step 8: Manual UI check.** With `pnpm dev` running: open a **Lead Scout** (scrape only) — the tab bar and body show Overview · Leads · Tasks · Performance · Memory · Configuration (no Emails/Reach/Meetings). Open an **Account Executive** (outreach + book-meeting) — additionally shows Emails + Meetings (not Reach Outs). Open a **Sales Manager** (no caps) — only the six universal sections. Clicking a tab scrolls to its section.

- [ ] **Step 9: Commit.**

```bash
git add "agentic-salesforce/app/agents/[id]/page.tsx"
git commit -m "Capability-driven agent-detail sections + per-agent Meetings section"
```

---

## Task 3: Calendar data model (`lib/calendar.ts`) + nav icon

**Files:**
- Create: `lib/calendar.ts`
- Modify: `lib/visuals.ts`

**Interfaces:**
- Produces (consumed by Task 4): `CalEvent`, `CalSummary`, `CalendarModel`, `MonthCell`, `MonthModel`; `buildCalendar(agents: Agent[]): CalendarModel`; `buildMonthGrid(events: CalEvent[], year: number, monthIndex: number): MonthModel`. Adds a `calendar` key to `NAV_PATHS`.

- [ ] **Step 1: Add the `calendar` nav glyph.** In `lib/visuals.ts`, add one entry to the `NAV_PATHS` map (after the `leads:` entry, ~line 89). It is fill-based (the outer shapes inherit the svg `fill=color`; the dots are white cutouts), matching the other glyphs:

```ts
  calendar: '<rect x="3.5" y="5.5" width="17" height="15" rx="2.6"/><rect x="6.8" y="3" width="1.8" height="4" rx="0.9"/><rect x="15.4" y="3" width="1.8" height="4" rx="0.9"/><rect x="3.5" y="9.2" width="17" height="1.5" fill="#fff" fill-opacity="0.55"/><circle cx="8" cy="13.6" r="1.05" fill="#fff"/><circle cx="12" cy="13.6" r="1.05" fill="#fff"/><circle cx="16" cy="13.6" r="1.05" fill="#fff"/><circle cx="8" cy="17" r="1.05" fill="#fff"/><circle cx="12" cy="17" r="1.05" fill="#fff"/>',
```

- [ ] **Step 2: Write `lib/calendar.ts`.** Create the file:

```ts
// Deterministic calendar model derived from the live agent roster (no DB).
// Mirrors lib/agentDetail.ts: same roster → same schedule. Real event data
// arrives when the book-meeting / follow-up engines exist.
import type { Agent } from "./types";
import { av } from "./visuals";

export interface CalEvent {
  dayIdx: number;   // 0-6 (Mon-Sun)
  hourIdx: number;  // 0-9 (8 AM-5 PM)
  chip: string;     // Meeting | Outreach | Reach | Leads | Ops | Alert
  title: string;
  withWho: string;
  type: "meeting" | "reach";
  initials: string;
  avStyle: string;             // css-ready avatar style (via av())
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
const CHIP_COLORS: Record<string, [string, string]> = {
  Meeting: ["#FDF0F5", "#DB2777"], Outreach: ["#FEF6E8", "#B45309"], Alert: ["#FEECEC", "#B91C1C"],
  Leads: ["#E7F7EC", "#1B7A3D"], Ops: ["#F1EDFD", "#5122C1"], Reach: ["#E9F5FE", "#0369A1"],
};
const COMPANIES = ["Datadog", "Snowflake", "Brex", "Ramp", "Plaid", "Mercury", "Notion", "Vercel"];
const PURPOSES = ["Discovery call", "Proposal walkthrough", "CTO intro", "Reply follow-up", "Team sync", "Demo"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function primaryChip(caps: string[]): string {
  if (caps.includes("book-meeting")) return "Meeting";
  if (caps.includes("follow-up")) return "Reach";
  if (caps.includes("outreach")) return "Outreach";
  if (caps.includes("scrape")) return "Leads";
  return "Ops";
}

export function buildCalendar(agents: Agent[]): CalendarModel {
  const events: CalEvent[] = [];
  agents.forEach((ag, i) => {
    const caps = ag.capabilities ?? [];
    const first = ag.name.split(" ")[0];
    const mk = (dayIdx: number, hourIdx: number, chip: string, purposeIdx: number, coIdx: number) => {
      const colors = CHIP_COLORS[chip] ?? CHIP_COLORS.Ops;
      const isMeeting = chip === "Meeting";
      events.push({
        dayIdx, hourIdx, chip,
        title: isMeeting ? first + " × " + COMPANIES[coIdx % COMPANIES.length] : PURPOSES[purposeIdx % PURPOSES.length] + " · " + first,
        withWho: isMeeting ? COMPANIES[coIdx % COMPANIES.length] : PURPOSES[purposeIdx % PURPOSES.length],
        type: isMeeting ? "meeting" : "reach",
        initials: ag.initials, avStyle: av(ag, 24), colors,
      });
    };
    // primary event keyed to the agent's main capability
    mk((i * 2) % 7, (i * 3 + 1) % 10, primaryChip(caps), i, i);
    // a second complementary event for busier agents
    if ((ag.score ?? 0) >= 85 || i % 2 === 0) {
      const chip2 = caps.includes("outreach") ? "Outreach" : caps.includes("follow-up") ? "Reach" : "Ops";
      mk((i * 3 + 4) % 7, (i * 2 + 5) % 10, chip2, i + 3, i + 4);
    }
  });

  const weekRows = CAL_HOURS.map((hour, hourIdx) => ({
    hour,
    cells: CAL_DAY_LABELS.map((_, dayIdx) => events.filter((e) => e.dayIdx === dayIdx && e.hourIdx === hourIdx)),
  }));
  const meetingCount = events.filter((e) => e.type === "meeting").length;
  const reachCount = events.filter((e) => e.type === "reach").length;
  const summary: CalSummary[] = [
    { label: "Meetings booked", value: String(meetingCount), emoji: "📅", bg: "#FDF0F5" },
    { label: "Reach outs scheduled", value: String(reachCount), emoji: "📨", bg: "#FEF6E8" },
    { label: "Active agents on calendar", value: String(agents.length), emoji: "🤖", bg: "#F1EDFD" },
    { label: "This week total", value: String(events.length), emoji: "🗓", bg: "#E7F7EC" },
  ];
  return { summary, hours: CAL_HOURS, dayLabels: CAL_DAY_LABELS, weekRows, events };
}

// A real month grid (Monday-first) for the given month, with events distributed
// deterministically across the month's days so the grid is populated.
export function buildMonthGrid(events: CalEvent[], year: number, monthIndex: number): MonthModel {
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const byDay: Record<number, CalEvent[]> = {};
  events.forEach((e, i) => {
    const dom = ((i * 3) % daysInMonth) + 1;
    (byDay[dom] ??= []).push(e);
  });
  // Monday-first leading blanks.
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

- [ ] **Step 3: Type-check.**

Run: `cd agentic-salesforce && npx tsc --noEmit`
Expected: no errors. (`av` is exported from `lib/visuals`; `Agent` from `lib/types`.)

- [ ] **Step 4: Commit.**

```bash
git add agentic-salesforce/lib/calendar.ts agentic-salesforce/lib/visuals.ts
git commit -m "Add deterministic calendar model + calendar nav glyph"
```

---

## Task 4: Calendar page + sidebar nav

**Files:**
- Create: `app/calendar/page.tsx`
- Modify: `components/Shell.tsx`

**Interfaces:**
- Consumes: `buildCalendar`, `buildMonthGrid`, and their types from `lib/calendar.ts`; `useApp().agents`; `av`/`navIcon` are not needed directly in the page except styles already embedded in the model.

- [ ] **Step 1: Add the Calendar nav item.** In `components/Shell.tsx`, add to the `NAV` array (between the Chats and Analytics entries, ~line 13):

```ts
  { href: "/calendar", icon: "calendar", label: "Calendar" },
```

- [ ] **Step 2: Add the header title.** In `components/Shell.tsx`'s title helper (the block around line 30 with `if (path.startsWith("/analytics")) return "Analytics";`), add:

```ts
  if (path.startsWith("/calendar")) return "Calendar";
```

- [ ] **Step 3: Write the Calendar page.** Create `app/calendar/page.tsx`:

```tsx
"use client";
import { useMemo, useState } from "react";
import { useApp } from "@/lib/store";
import { css, Box } from "@/components/primitives";
import { buildCalendar, buildMonthGrid } from "@/lib/calendar";

const WEEK_LABELS = ["Last week", "This week", "Next week", "In 2 weeks"];

export default function CalendarPage() {
  const { agents } = useApp();
  const cal = useMemo(() => buildCalendar(agents), [agents]);
  const [view, setView] = useState<"week" | "month">("week");
  const [weekOffset, setWeekOffset] = useState(0);
  const [monthOffset, setMonthOffset] = useState(0);

  const dayNums = cal.dayLabels.map((_, i) => String(i + 1 + weekOffset * 7));
  const weekLabel = WEEK_LABELS[Math.min(Math.max(weekOffset + 1, 0), WEEK_LABELS.length - 1)];

  const now = new Date();
  const monthDate = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const month = useMemo(
    () => buildMonthGrid(cal.events, monthDate.getFullYear(), monthDate.getMonth()),
    [cal.events, monthDate.getFullYear(), monthDate.getMonth()]
  );

  const isWeek = view === "week";
  const periodLabel = isWeek ? weekLabel : month.label;
  const prev = () => (isWeek ? setWeekOffset((o) => o - 1) : setMonthOffset((o) => o - 1));
  const next = () => (isWeek ? setWeekOffset((o) => o + 1) : setMonthOffset((o) => o + 1));
  const reset = () => (isWeek ? setWeekOffset(0) : setMonthOffset(0));

  const segBtn = (active: boolean) =>
    "padding:6px 16px;font-size:12.5px;font-weight:600;border-radius:99px;cursor:pointer;transition:all .12s;" +
    (active ? "background:#fff;color:#18181B;box-shadow:0 1px 2px rgba(0,0,0,.08)" : "color:#71717A");
  const navBtn = "width:32px;height:32px;border-radius:8px;background:#F4F4F5;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:15px;color:#52525B";

  return (
    <div style={css("padding:24px 26px;display:flex;flex-direction:column;gap:18px;animation:fadeUp .3s ease")}>
      <div style={css("font-size:13px;color:#71717A")}>Every agent&rsquo;s meetings and reach outs, in one glance</div>

      {/* summary cards */}
      <div style={css("display:grid;grid-template-columns:repeat(4,1fr);gap:14px")}>
        {cal.summary.map((cs) => (
          <div key={cs.label} style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:18px;display:flex;align-items:center;gap:14px")}>
            <div style={css("width:40px;height:40px;border-radius:12px;background:" + cs.bg + ";display:flex;align-items:center;justify-content:center;flex:none;font-size:19px")}>{cs.emoji}</div>
            <div><div style={css("font-size:22px;font-weight:700;color:#18181B;letter-spacing:-.02em")}>{cs.value}</div><div style={css("font-size:11.5px;color:#71717A;margin-top:2px")}>{cs.label}</div></div>
          </div>
        ))}
      </div>

      {/* schedule card */}
      <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:20px;overflow-x:auto")}>
        <div style={css("display:flex;align-items:center;gap:14px;margin-bottom:18px")}>
          <div style={css("font-family:'Poetsen One',sans-serif;font-size:18px;font-weight:400")}>Schedule</div>
          <div style={css("display:flex;background:#F4F4F5;border-radius:99px;padding:3px")}>
            <Box onClick={() => setView("week")} style={segBtn(isWeek)}>Week</Box>
            <Box onClick={() => setView("month")} style={segBtn(!isWeek)}>Month</Box>
          </div>
          <div style={css("margin-left:auto;display:flex;align-items:center;gap:10px")}>
            <Box onClick={prev} style={navBtn} styleHover="background:#E4E4E7">‹</Box>
            <Box onClick={reset} style="font-size:13px;font-weight:600;color:#18181B;background:#F4F4F5;border-radius:99px;padding:7px 16px;cursor:pointer" styleHover="background:#E4E4E7">{periodLabel}</Box>
            <Box onClick={next} style={navBtn} styleHover="background:#E4E4E7">›</Box>
          </div>
        </div>

        {isWeek ? (
          <div style={css("display:grid;grid-template-columns:64px repeat(7,minmax(90px,1fr));min-width:760px")}>
            <div />
            {cal.dayLabels.map((label, i) => (
              <div key={i} style={css("text-align:center;padding-bottom:10px;border-bottom:1px solid #F0F0F3")}>
                <div style={css("font-size:11px;color:#A1AEBE;font-weight:600")}>{label}</div>
                <div style={css("font-size:14px;font-weight:700;color:#18181B;margin-top:2px")}>{dayNums[i]}</div>
              </div>
            ))}
            {cal.weekRows.map((row, ri) => (
              <div key={ri} style={css("display:contents")}>
                <div style={css("font-size:11px;color:#A1AEBE;padding:6px 8px 0 0;text-align:right;border-top:1px solid #F4F4F6")}>{row.hour}</div>
                {row.cells.map((cell, ci) => (
                  <div key={ci} style={css("border-top:1px solid #F4F4F6;border-left:1px solid #F4F4F6;min-height:52px;padding:3px")}>
                    {cell.map((ev, ei) => (
                      <div key={ei} title={ev.title + " · " + ev.withWho} style={css("background:" + ev.colors[0] + ";border-radius:8px;padding:3px;display:flex;align-items:center;gap:4px;overflow:hidden;height:100%")}>
                        <div style={css(ev.avStyle)}>{ev.initials}</div>
                        <div style={css("font-size:10px;font-weight:600;color:#3F3F46;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0")}>{ev.title}</div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div style={css("min-width:640px")}>
            <div style={css("display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-bottom:8px")}>
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                <div key={d} style={css("text-align:center;font-size:11px;color:#A1AEBE;font-weight:600")}>{d}</div>
              ))}
            </div>
            <div style={css("display:flex;flex-direction:column;gap:6px")}>
              {month.weeks.map((week, wi) => (
                <div key={wi} style={css("display:grid;grid-template-columns:repeat(7,1fr);gap:6px")}>
                  {week.map((cell, di) => (
                    <div key={di} style={css("min-height:74px;border:1px solid #F0F0F3;border-radius:10px;padding:6px 7px;" + (cell.day ? "background:#fff" : "background:#FAFAFB"))}>
                      {cell.day && <div style={css("font-size:11.5px;font-weight:600;color:#52525B")}>{cell.day}</div>}
                      <div style={css("display:flex;flex-wrap:wrap;gap:3px;margin-top:5px")}>
                        {cell.events.slice(0, 4).map((ev, ei) => (
                          <div key={ei} title={ev.title} style={css("width:7px;height:7px;border-radius:50%;background:" + ev.colors[1])} />
                        ))}
                        {cell.events.length > 4 && <div style={css("font-size:9px;color:#A1AEBE;font-weight:600")}>+{cell.events.length - 4}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Type-check.**

Run: `cd agentic-salesforce && npx tsc --noEmit`
Expected: no errors. (Confirm `Box` is exported from `@/components/primitives` — it is used by other pages the same way; `useApp` returns `agents`.)

- [ ] **Step 5: Manual UI check.** With `pnpm dev`: the sidebar shows a **Calendar** item (with the calendar glyph) between Chats and Analytics; clicking it opens `/calendar`. The page shows the subtitle, four summary cards, and the weekly grid populated with the real agents' avatars/titles. The **Week/Month** toggle switches to a month grid with day cells + colored event dots. Prev/next shifts the week (week view) or month (month view); the center label updates and resets on click. The week grid scrolls horizontally when the window is narrow.

- [ ] **Step 6: Commit.**

```bash
git add agentic-salesforce/app/calendar/page.tsx agentic-salesforce/components/Shell.tsx
git commit -m "Add Calendar page (weekly + monthly schedule) and sidebar nav"
```

---

## Self-Review

**Spec coverage:**
- Part A section map + capability-gated Emails/Reach/Meetings + capability-driven tab bar → Task 2. Per-agent Meetings data → Task 1.
- Part B Calendar: route + nav + subtitle + summary cards + week grid + functional month grid + display-only events → Tasks 3 (data + icon) & 4 (page + nav). `buildCalendar` keyed to the live roster → Task 3.
- Universal-vs-gated mapping (Leads universal; Emails=outreach, Reach=follow-up, Meetings=book-meeting) → Task 2's `SECTIONS`.

**Placeholder scan:** no TBD/vague steps; every code step shows complete code. The one judgment call (deterministic event distribution) is fully specified in `buildCalendar`/`buildMonthGrid`.

**Type consistency:** `MeetingItem` (Task 1) is consumed by Task 2's Meetings section (`m.purpose/title/withWho/time/c`). `CalEvent`/`CalSummary`/`CalendarModel`/`MonthModel` (Task 3) are consumed by Task 4 with matching field names (`ev.colors`, `ev.avStyle`, `ev.initials`, `cs.emoji/bg/value/label`, `cell.day/events`, `month.weeks/label`, `row.hour/cells`). `buildCalendar(agents)` / `buildMonthGrid(events, year, monthIndex)` signatures match their call sites. The `calendar` `NAV_PATHS` key (Task 3) matches the `icon: "calendar"` nav item (Task 4).
