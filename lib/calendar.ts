// Calendar model built from real agent-booked meetings, placed by their real
// timestamps. No fabricated events.
import type { Agent } from "./types";
import { av } from "./visuals";

export interface CalEvent {
  createdAt: string;           // ISO — the real event time
  dayIdx: number;              // 0-6 (Mon-Sun) of createdAt
  hourIdx: number;              // 0-9 (8 AM-5 PM), clamped
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
  dayNums: string[];           // day-of-month for each column of the shown week ("" before mount)
  weekLabel: string;           // e.g. "Oct 19 – 25" ("" before mount)
  weekRows: { hour: string; cells: CalEvent[][] }[];
  events: CalEvent[];
}
/** The browser's current time and which week is shown (0 = this week). Absent
 *  during server render, so dates are only ever computed in the viewer's timezone. */
export interface WeekView { now: Date; weekOffset: number }
export interface MonthCell { day: number | null; events: CalEvent[]; }
export interface MonthModel { label: string; weeks: MonthCell[][]; }

const CAL_HOURS = ["8 AM", "9 AM", "10 AM", "11 AM", "Noon", "1 PM", "2 PM", "3 PM", "4 PM", "5 PM"];
const CAL_DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
interface MeetingLike { agentId: string; leadName: string; whenAt: string; whenLabel: string }

/** Local midnight of the Monday that starts the week `weekOffset` weeks from `now`. */
export function startOfWeek(now: Date, weekOffset: number): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7) + weekOffset * 7);
}

/** "Oct 19 – 25", "Oct 27 – Nov 2", with the year added when it isn't `now`'s. */
export function weekRangeLabel(start: Date, now: Date): string {
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  const sameYear = start.getFullYear() === end.getFullYear();
  const showYear = !sameYear || start.getFullYear() !== now.getFullYear();
  const from = MONTH_SHORT[start.getMonth()] + " " + start.getDate() + (sameYear ? "" : ", " + start.getFullYear());
  const to = (end.getMonth() === start.getMonth() ? "" : MONTH_SHORT[end.getMonth()] + " ") + end.getDate() + (showYear ? ", " + end.getFullYear() : "");
  return from + " – " + to;
}

/** Build the calendar from booked meetings only — each placed at its real time,
 *  labelled with the lead ("with whom"). This is the sole calendar source.
 *  The week grid only holds meetings inside the Mon–Sun week chosen by `view`. */
export function buildCalendarFromMeetings(meetings: MeetingLike[], agents: Agent[], view?: WeekView): CalendarModel {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const cal: CalEvent[] = meetings.map((m) => {
    const d = new Date(m.whenAt);
    const agent = byId.get(m.agentId);
    return {
      createdAt: m.whenAt,
      dayIdx: (d.getDay() + 6) % 7,
      hourIdx: Math.max(0, Math.min(9, d.getHours() - 8)),
      title: m.leadName,
      initials: agent?.initials ?? "?",
      avStyle: agent ? av(agent, 24) : "",
      colors: ["#EAF2FF", "#006AFF"],
    };
  });
  const start = view ? startOfWeek(view.now, view.weekOffset) : null;
  const end = start ? new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7) : null;
  const inWeek = start && end
    ? cal.filter((e) => { const t = new Date(e.createdAt).getTime(); return t >= start.getTime() && t < end.getTime(); })
    : [];
  const weekRows = CAL_HOURS.map((hour, hourIdx) => ({
    hour,
    cells: CAL_DAY_LABELS.map((_, dayIdx) => inWeek.filter((e) => e.dayIdx === dayIdx && e.hourIdx === hourIdx)),
  }));
  const dayNums = CAL_DAY_LABELS.map((_, i) => (start ? String(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i).getDate()) : ""));
  const weekLabel = start && view ? weekRangeLabel(start, view.now) : "";
  const now = view?.now.getTime();
  const weekMs = 7 * 24 * 3600 * 1000;
  const upcoming = now === undefined ? "–" : String(meetings.filter((m) => new Date(m.whenAt).getTime() >= now).length);
  const thisWeek = now === undefined ? "–" : String(meetings.filter((m) => { const t = new Date(m.whenAt).getTime(); return t >= now && t < now + weekMs; }).length);
  const leadCount = new Set(meetings.map((m) => m.leadName)).size;
  const summary: CalSummary[] = [
    { label: "Meetings", value: String(meetings.length), emoji: "🗓", bg: "#EAF2FF" },
    { label: "Upcoming", value: upcoming, emoji: "⏭", bg: "#E7F7EC" },
    { label: "This week", value: thisWeek, emoji: "📅", bg: "#FEF6E8" },
    { label: "Leads", value: String(leadCount), emoji: "🧑", bg: "#E9F5FE" },
  ];
  return { summary, hours: CAL_HOURS, dayLabels: CAL_DAY_LABELS, dayNums, weekLabel, weekRows, events: cal };
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
