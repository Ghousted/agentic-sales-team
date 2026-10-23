import "server-only";
// Meetings persistence: book a meeting (+ advance the lead) and list the booked
// meetings (joined to their lead) for the calendar.
import { and, asc, eq, sql } from "drizzle-orm";
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
  const owned = and(eq(leads.id, leadId), eq(leads.userId, userId));
  // One transaction. The meeting is inserted from the user's own lead row, so
  // the ownership check and both writes can't come apart. Drizzle's INSERT ...
  // SELECT wants every column, in table order.
  const [inserted] = await db.batch([
    db.insert(meetings).select(db.select({
      id: sql<string>`gen_random_uuid()`.as("id"),
      userId: leads.userId, agentId: sql<string>`${agentId}`.as("agent_id"), leadId: leads.id,
      title: sql<string>`${title}`.as("title"), whenAt: sql<Date>`${new Date(whenAtIso).toISOString()}::timestamptz`.as("when_at"),
      whenLabel: sql<string>`${whenLabel}`.as("when_label"), createdAt: sql<Date>`now()`.as("created_at"),
    }).from(leads).where(owned)).returning({ id: meetings.id }),
    db.update(leads).set({ status: "meeting", updatedAt: new Date() }).where(owned),
  ]);
  return inserted.length > 0;
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
  if (!iso) return { ok: false, error: "I could not read that time. Try “tomorrow 2pm”." };
  if (!(await bookMeeting(userId, agentId, leadId, iso, label, settings.type))) return { ok: false, error: "Lead not found." };
  return { ok: true, label };
}

/** Booked meetings joined to their lead, soonest first. Session-scoped.
 *  With an agentId, only that agent's meetings; a malformed agentId gets none. */
export async function listMeetings(agentId?: unknown): Promise<MeetingDTO[]> {
  if (!isDbConfigured()) return [];
  if (agentId !== undefined && (typeof agentId !== "string" || !agentId || agentId.length > 100)) return [];
  const userId = await uid();
  if (!userId) return [];
  const rows = await getDb().select({
    id: meetings.id, agentId: meetings.agentId, leadId: meetings.leadId, title: meetings.title,
    whenAt: meetings.whenAt, whenLabel: meetings.whenLabel, createdAt: meetings.createdAt, leadName: leads.name,
  }).from(meetings)
    .innerJoin(leads, and(eq(meetings.leadId, leads.id), eq(leads.userId, userId)))
    .where(and(eq(meetings.userId, userId), agentId === undefined ? undefined : eq(meetings.agentId, agentId)))
    .orderBy(asc(meetings.whenAt));
  return rows.map((r) => ({
    id: r.id, agentId: r.agentId, leadId: r.leadId, leadName: r.leadName, title: r.title,
    whenAt: r.whenAt.toISOString(), whenLabel: r.whenLabel, createdAt: r.createdAt.toISOString(),
  }));
}
