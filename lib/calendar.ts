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
