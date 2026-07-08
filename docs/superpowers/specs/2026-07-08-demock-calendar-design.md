# De-Mock Slice 3 — Calendar

Turn the calendar from fabricated events into a **real timeline of what agents actually did** — the `activity` log placed on real dates.

> Third and final de-mock slice (Slice 1 = agent detail, Slice 2 = dashboard/analytics/notifications). Keeps the seed roster; removes only fake *content*.

---

## Part A — Data read (`lib/calendar.ts` + a server read)

The `activity` log already stores real dated events (`lead_added`, `lead_researched`, `email_drafted`, `email_sent`) with `agentId` + `createdAt`. The calendar renders these instead of inventing.

- **New `getCalendarActivity()`** (server-only, user-scoped) → the user's `activity` events as `{ agentId, type, text, createdAt }` for a recent window (e.g. last ~60 days), newest first. Client wrapper `"use server"`.
- **`buildCalendar` becomes a placement helper, not a fabricator.** Its signature changes from `buildCalendar(agents)` (which invents `CAL_RAW` events) to `buildCalendar(events, agents)` — it buckets the **real** events into the week grid (by day-of-week + hour of `createdAt`) and returns the summary + week rows; `buildMonthGrid(events, …)` already places events by day and stays. The hardcoded `CAL_RAW`, random placement, and fake `COMPANIES`/`PURPOSES` are **deleted**. Event color/label come from the event `type` (researched / drafted / sent / added), and each event carries its acting agent's avatar (via the roster).

---

## Part B — Rendering (`app/calendar/page.tsx`)

- The page loads `getCalendarActivity()` into state and passes the real events to `buildCalendar`/`buildMonthGrid`.
- **Summary cards** → real counts derived from the events in view: e.g. **Events this week · Drafts · Sent · Active agents** (no fabricated "meetings booked" / "reach outs scheduled" tallies; real meetings = none until a book-meeting engine).
- **Week + month grids** → real events on their real days/hours; empty cells stay empty.
- **Empty state:** a fresh workspace shows an empty calendar (subtitle + empty grid) — it fills as agents work.

---

## File map

| File | Change |
|---|---|
| `lib/workspace/stats.ts` (or reuse) | `getCalendarActivity` server read (may reuse Slice 2's `listActivity` with a larger window) |
| `lib/workspace/statsActions.ts` | `"use server"` wrapper (if not already exposing activity) |
| `lib/calendar.ts` | `buildCalendar(events, agents)` — place real events; delete `CAL_RAW`/random/`COMPANIES`/`PURPOSES` |
| `app/calendar/page.tsx` | load real events; pass to builders; real summary cards; empty state |

> If Slice 2 ships first, `getCalendarActivity` can be `listActivity(200)` (a larger window) rather than a new read — the plan will reconcile.

---

## Verification

No unit-test framework — `npx tsc --noEmit` clean + manual (no migration):

- Fresh workspace: calendar shows the subtitle + an empty week/month grid; summary cards all 0.
- After running the pipeline: `lead_researched`/`email_drafted`/`email_sent` events appear on their real days/hours (week view) and days (month view), colored by type, tagged with the acting agent; Week/Month toggle + prev/next still work; summary cards show real counts.
- No fabricated events; `CAL_RAW`/`COMPANIES`/`PURPOSES` gone from `lib/calendar.ts`.
- `tsc` clean.

## Deferred

- Real meetings (await a book-meeting engine).
- Event-detail click-through (out of scope; display-only, as the calendar already is).
