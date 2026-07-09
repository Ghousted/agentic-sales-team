import "server-only";
// Meetings persistence: book a meeting (+ advance the lead) and list the booked
// meetings (joined to their lead) for the calendar.
import { and, asc, eq } from "drizzle-orm";
import { getDb, isDbConfigured, meetings, leads } from "@/lib/db";
import { getSession } from "@/lib/auth/session";

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

/** Book a meeting (caller supplies userId) and advance the lead to the 'meeting' stage. */
export async function bookMeeting(userId: string, agentId: string, leadId: string, whenAtIso: string, whenLabel: string, title = "Meeting"): Promise<void> {
  if (!isDbConfigured()) return;
  const db = getDb();
  await db.insert(meetings).values({ userId, agentId, leadId, title, whenAt: new Date(whenAtIso), whenLabel });
  await db.update(leads).set({ status: "meeting", updatedAt: new Date() }).where(and(eq(leads.id, leadId), eq(leads.userId, userId)));
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
    .innerJoin(leads, eq(meetings.leadId, leads.id))
    .where(eq(meetings.userId, userId)).orderBy(asc(meetings.whenAt));
  return rows.map((r) => ({
    id: r.id, agentId: r.agentId, leadId: r.leadId, leadName: r.leadName, title: r.title,
    whenAt: r.whenAt.toISOString(), whenLabel: r.whenLabel, createdAt: r.createdAt.toISOString(),
  }));
}
