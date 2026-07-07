# Capability-Driven Agent Details + Calendar Page — Design

Two related changes to how agent work surfaces in the UI:

- **Part A** — the Agent Details page shows **only the sections that match the agent's capabilities** (instead of all 8 for everyone), and gains a new per-agent **Meetings** section.
- **Part B** — a new top-level **Calendar** page, a faithful port of the v5 design's weekly schedule (plus a functional Month grid), showing every agent's meetings and reach-outs in one view.

> Design source: `Design/Agentic Salesforce v5.dc.html` (the "Calendar" screen, lines ~726–772, and its builder ~1725–1767).
> Both parts render **deterministic content derived from the live agent roster** — the same pattern as `lib/agentDetail.ts` today. No new DB tables; real event data arrives when the `book-meeting` / `follow-up` engines exist.

---

## Part A — Capability-driven Agent Details

### Section model

`app/agents/[id]/page.tsx` today renders 8 fixed sections and a static `TABS` array. Both become **derived from a single section map**:

```ts
// each section: [key, label, requiredCapability?]  — no capability ⇒ always shown
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

- A `visibleSections` list is computed as `SECTIONS.filter(([,,cap]) => !cap || sel.capabilities?.includes(cap))`.
- The sticky tab bar maps over `visibleSections` (not the old `TABS`).
- Each section body renders only when visible — i.e. the `Emails` / `Reach Outs` / `Meetings` blocks are wrapped so they appear only for agents with the matching capability.

Result:
- **Universal (every agent):** Overview · Leads · Tasks · Performance · Memory · Configuration. *(Leads stays universal — any agent can work assigned leads; the "Find leads" button inside it remains scrape-gated, unchanged.)*
- **`outreach`** → Emails · **`follow-up`** → Reach Outs · **`book-meeting`** → Meetings.
- A **Sales Manager** (no capabilities) shows only the six universal sections.

The existing capability-gated buttons ("Find leads" / "Run outreach") are unchanged.

### The new Meetings section

A per-agent list of upcoming meetings, generated deterministically — the same approach as `reach`/`tasks`:

- `lib/agentDetail.ts` gains a `MeetingItem` type and a `meetings: MeetingItem[]` field on `AgentDetailModel`, built inside `buildAgentDetail` from the agent's derived leads (a few upcoming meetings: `{ title, withWho, time, purpose, c: [bg, fg] }` — e.g. "Discovery call · Ramp", "Tue 10:00 AM").
- The Meetings section renders these as clean rows/cards (time · who · purpose), styled to match the Reach Outs / Tasks sections.

---

## Part B — Calendar page

A new top-level page at `/calendar`, ported from the v5 "Calendar" screen.

### Route & navigation

- New route `app/calendar/page.tsx` (client component, reads the roster from `useApp`).
- `components/Shell.tsx`: add `{ href: "/calendar", icon: "calendar", label: "Calendar" }` to `NAV` between Chats and Analytics (v5 order); add `if (path.startsWith("/calendar")) return "Calendar"` to the header-title map.
- `lib/visuals.ts`: add a `calendar` icon to the `navIcon` catalog (it isn't present yet) — ported from the v5 `calendar` glyph.

### Page content (ported from v5)

1. Subtitle: *"Every agent's meetings and reach outs, in one glance."*
2. **Four summary cards** (grid of 4): Meetings booked · Reach outs scheduled · Active agents on calendar · Week total — each an icon tile + value + label, computed from the event set.
3. **Schedule card** with:
   - Header: "Schedule" title · **Week / Month toggle** · prev / current-period / next nav.
   - **Week view** (default): a `64px` time gutter + 7 day columns (M–S with day numbers), hour rows **8 AM–5 PM**. Each `(day, hour)` cell holds its events as colored chips — agent avatar initials + title — colored by type (Meeting / Outreach / Alert / Leads / Ops / Reach). Wrapped in `overflow-x:auto` (min-width ~760px) so it scrolls on narrow screens, matching v5.
   - **Month view** (functional, behind the toggle): a standard month grid (weeks × 7 day cells) for the shown month; each day cell shows the day number + small **event dots** (colored by type) for events on that day, capped with a "+N" overflow. Clicking a day is not required (display-only, see below).
   - **Navigation:** prev/next shifts the shown week (Week view) or month (Month view); the center label reflects the current period ("This week" / month name). Faithful to v5, which shifts the week label + day numbers.

### Data — `lib/calendar.ts`

A new `buildCalendar(agents)` helper mirrors `buildAgentDetail`'s deterministic pattern (pure function, no DB):

- Maps the v5 event set onto the **real roster**: each agent is placed into deterministic day/hour slots (derived from its index), with the event **type chosen from the agent's capabilities** (`book-meeting` → Meeting, `follow-up` → Reach, `outreach` → Outreach, `scrape` → Leads, else Ops) and the title from the agent's name/task. Colors come from a `chipColors` map ported from v5.
- Returns `{ summary: SummaryCard[], week: { dayHeaders, grid }, month: { weeks } }` — everything the page needs, computed once from the roster.
- Because it keys off the live roster (real names, initials, avatar colors via `av()`), the calendar reflects the user's actual agents rather than hardcoded seed names.

### Two settled decisions

- **Event click → display-only.** v5 opens an activity modal that doesn't exist in the port; calendar chips are display-only (title shown on hover via `title=`). A real detail modal can come with real event data later.
- **Month toggle → functional month grid** (per the above), not a cosmetic toggle.

---

## File map

| File | Change |
|---|---|
| `app/agents/[id]/page.tsx` | section map + `visibleSections`; capability-gated Emails/Reach/**Meetings**; capability-driven tab bar |
| `lib/agentDetail.ts` | add `MeetingItem` + `meetings` to `AgentDetailModel` / `buildAgentDetail` |
| `lib/calendar.ts` | **new** — `buildCalendar(agents)` (summary + week grid + month grid), deterministic |
| `app/calendar/page.tsx` | **new** — Calendar page (subtitle, summary cards, week/month schedule, nav) |
| `components/Shell.tsx` | add Calendar `NAV` item + header-title entry |
| `lib/visuals.ts` | add `calendar` icon to `navIcon` |

---

## Verification

No unit-test framework in this project — verification is:

- `npx tsc --noEmit` clean.
- **Part A:** a Lead Scout (scrape) shows Overview · Leads · Tasks · Performance · Memory · Config (no Emails/Reach/Meetings); an Account Executive (outreach + book-meeting) additionally shows Emails + Meetings; a Sales Manager (no caps) shows only the six universal sections. The Meetings section lists upcoming meetings; the tab bar shows only visible sections.
- **Part B:** `/calendar` is reachable from the sidebar, shows the four summary cards and the weekly grid populated from the real roster; the Week/Month toggle switches between the week grid and a functional month grid; prev/next nav shifts the period; the grid scrolls horizontally on narrow widths.

## Deferred / out of scope

- Real meeting/reach-out data + an event-detail modal (arrive with the `book-meeting` / `follow-up` engines).
- Drag-to-reschedule, event creation, timezone handling — not in the v5 design, not built.
