import "server-only";
// Meetings persistence: book a meeting (+ advance the lead) and list the booked
// meetings (joined to their lead) for the calendar.
import { and, asc, eq } from "drizzle-orm";
import { getDb, isDbConfigured, meetings, leads, agents, agentConfig } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { parseMeetingTime } from "@/lib/ai/meetingTime";

async function uid(): Promise<string | null> {
  const s = await getSession();
  return s?.userId ?? null;
}

export interface MeetingDTO {
  id: string;
  agentId: string;
  leadId: string;
  leadName: string;
  title: string;
  whenAt: string;
  whenLabel: string;
  createdAt: string;
}

export interface MeetingSettings { type: string; duration: number; windowStart: number; windowEnd: number; weekdaysOnly: boolean }
const DEFAULTS: MeetingSettings = { type: "Meeting", duration: 30, windowStart: 9, windowEnd: 17, weekdaysOnly: true };

/** The Meeting agent's book-meeting settings (title/duration/booking window), with defaults. */
export async function meetingSettings(userId: string, agentId: string): Promise<MeetingSettings> {
  if (!isDbConfigured()) return { ...DEFAULTS };
  const [row] = await getDb().select().from(agentConfig).where(and(eq(agentConfig.userId, userId), eq(agentConfig.agentId, agentId))).limit(1);
  const s: Record<string, unknown> = ((row?.settings as Record<string, Record<string, unknown>> | null | undefined)?.["book-meeting"]) ?? {};
  const hour = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    type: String(s.type ?? "").trim() || DEFAULTS.type,
    duration: Number(s.duration) > 0 ? Number(s.duration) : DEFAULTS.duration,
    windowStart: hour(s.windowStart, DEFAULTS.windowStart),
    windowEnd: hour(s.windowEnd, DEFAULTS.windowEnd),
    weekdaysOnly: s.weekdaysOnly !== false,
  };
}

/** The user's first book-meeting-capable agent, if any (for direct "Book a meeting"). */
export async function findMeetingAgent(userId: string): Promise<{ id: string; name: string; role: string; goal: string; task: string } | null> {
  if (!isDbConfigured()) return null;
  const rows = await getDb().select().from(agents).where(eq(agents.userId, userId));
  const m = rows.find((r) => (r.capabilities as string[]).includes("book-meeting"));
  return m ? { id: m.id, name: m.name, role: m.role, goal: m.goal, task: m.task } : null;
}

/** Book a meeting (caller supplies userId) and advance the lead to the 'meeting' stage.
 *  Returns false, booking nothing, when the lead isn't the user's. */
export async function bookMeeting(userId: string, agentId: string, leadId: string, whenAtIso: string, whenLabel: string, title = "Meeting"): Promise<boolean> {
  if (!isDbConfigured()) return false;
  const db = getDb();
  const [owned] = await db.select({ id: leads.id }).from(leads).where(and(eq(leads.id, leadId), eq(leads.userId, userId))).limit(1);
  if (!owned) return false;
  await db.insert(meetings).values({ userId, agentId, leadId, title, whenAt: new Date(whenAtIso), whenLabel });
  await db.update(leads).set({ status: "meeting", updatedAt: new Date() }).where(and(eq(leads.id, leadId), eq(leads.userId, userId)));
  return true;
}

/** Book a meeting for a lead directly (from the lead modal): parse the time in
 *  the user's timezone, honor the Meeting agent's settings, and book. Session-scoped. */
export async function bookMeetingForLead(leadId: string, whenText: string, timeZone?: string): Promise<{ ok: boolean; label?: string; error?: string }> {
  if (!isDbConfigured()) return { ok: false, error: "Server not configured." };
  const userId = await uid();
  if (!userId) return { ok: false, error: "Not signed in." };
  const [lead] = await getDb().select({ id: leads.id, agentId: leads.agentId }).from(leads).where(and(eq(leads.id, leadId), eq(leads.userId, userId))).limit(1);
  if (!lead) return { ok: false, error: "Lead not found." };
  const meetingAgent = await findMeetingAgent(userId);
  const agentId = meetingAgent?.id ?? lead.agentId;
  const settings = await meetingSettings(userId, agentId);
  const { iso, label } = await parseMeetingTime(whenText, { ...settings, timeZone });
  if (!iso) return { ok: false, error: "I couldn't read that time — try “tomorrow 2pm”." };
  if (!(await bookMeeting(userId, agentId, leadId, iso, label, settings.type))) return { ok: false, error: "Lead not found." };
  return { ok: true, label };
}

/** All booked meetings joined to their lead, soonest first. Session-scoped. */
export async function listMeetings(): Promise<MeetingDTO[]> {
  if (!isDbConfigured()) return [];
  const userId = await uid();
  if (!userId) return [];
  const rows = await getDb().select({
    id: meetings.id, agentId: meetings.agentId, leadId: meetings.leadId, title: meetings.title,
    whenAt: meetings.whenAt, whenLabel: meetings.whenLabel, createdAt: meetings.createdAt, leadName: leads.name,
  }).from(meetings)
    .innerJoin(leads, and(eq(meetings.leadId, leads.id), eq(leads.userId, userId)))
    .where(eq(meetings.userId, userId)).orderBy(asc(meetings.whenAt));
  return rows.map((r) => ({
    id: r.id, agentId: r.agentId, leadId: r.leadId, leadName: r.leadName, title: r.title,
    whenAt: r.whenAt.toISOString(), whenLabel: r.whenLabel, createdAt: r.createdAt.toISOString(),
  }));
}
