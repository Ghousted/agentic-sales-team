// Calendar model built from real activity events (lib/workspace listActivity),
// placed by their real timestamps. No fabricated events.
import type { Agent } from "./types";
import { av } from "./visuals";
import type { ActivityItem } from "./workspace/stats";

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

interface MeetingLike { agentId: string; leadName: string; whenAt: string; whenLabel: string }

/** Build the calendar from booked meetings only — each placed at its real time,
 *  labelled with the lead ("with whom"). This is the sole calendar source. */
export function buildCalendarFromMeetings(meetings: MeetingLike[], agents: Agent[]): CalendarModel {
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
      colors: ["#F1EDFD", "#5122C1"],
    };
  });
  const weekRows = CAL_HOURS.map((hour, hourIdx) => ({
    hour,
    cells: CAL_DAY_LABELS.map((_, dayIdx) => cal.filter((e) => e.dayIdx === dayIdx && e.hourIdx === hourIdx)),
  }));
  const now = Date.now();
  const weekMs = 7 * 24 * 3600 * 1000;
  const upcoming = meetings.filter((m) => new Date(m.whenAt).getTime() >= now).length;
  const thisWeek = meetings.filter((m) => { const t = new Date(m.whenAt).getTime(); return t >= now && t < now + weekMs; }).length;
  const leadCount = new Set(meetings.map((m) => m.leadName)).size;
  const summary: CalSummary[] = [
    { label: "Meetings", value: String(meetings.length), emoji: "🗓", bg: "#F1EDFD" },
    { label: "Upcoming", value: String(upcoming), emoji: "⏭", bg: "#E7F7EC" },
    { label: "This week", value: String(thisWeek), emoji: "📅", bg: "#FEF6E8" },
    { label: "Leads", value: String(leadCount), emoji: "🧑", bg: "#E9F5FE" },
  ];
  return { summary, hours: CAL_HOURS, dayLabels: CAL_DAY_LABELS, weekRows, events: cal };
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
