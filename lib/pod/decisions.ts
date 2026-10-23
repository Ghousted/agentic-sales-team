import "server-only";
// Proceed and Cancel of a step an agent asked about, for a known user. The
// buttons (lib/pod/actions) and a typed "yes"/"no" in the chat (lib/chat/actions)
// both land here. Server-only: the caller has already resolved the session.
import { and, asc, desc, eq, gte, inArray, lt, ne } from "drizzle-orm";
import { getDb, isDbConfigured, jobs, messages } from "@/lib/db";
import { postTeamMessage } from "@/lib/chat/teamMessages";
import { bookMeeting } from "@/lib/meetings/store";
import { bookedText } from "@/lib/chat/clarify";
import { cancelSummary, startText } from "./summary";

const teamOf = (params: unknown) => (params as { teamId?: string } | null)?.teamId;
const isPod = (params: unknown) => !!(params as { pod?: boolean } | null)?.pod;

/** What a Proceed/Cancel did. `kind` is the job's kind when the client should
 *  follow the job, or null when there is nothing to follow: the step was no
 *  longer waiting (handled elsewhere), or it was done on the spot (a meeting is
 *  booked during Proceed). `pod` jobs narrate their own outcome through the
 *  chain; others need reportTeamJob. */
export type ApprovalResult = { ok: true; kind: string | null; pod: boolean } | { error: string };

/** The booking a meeting ask carries (see askBook in lib/chat/actions). */
interface MeetingParams { teamId?: string; leadIds?: string[]; names?: Record<string, string>; iso?: string; label?: string; type?: string }

/** The step the user can answer now: the newest ⟦approve:…⟧ ask among `jobIds`
 *  (newest first) that is still waiting. Null when none is. */
export async function openApproval(userId: string, jobIds: string[]): Promise<string | null> {
  if (!isDbConfigured() || !jobIds.length) return null;
  const rows = await getDb().select({ id: jobs.id }).from(jobs)
    .where(and(eq(jobs.userId, userId), inArray(jobs.id, jobIds), eq(jobs.status, "needs_approval")));
  const waiting = new Set(rows.map((r) => r.id));
  return jobIds.find((id) => waiting.has(id)) ?? null;
}

/** Store a meeting the agent will book on Proceed, as a waiting job. Its id goes
 *  in the ask's ⟦approve:…⟧ marker. Null when there is no database. */
export async function createMeetingAsk(userId: string, agent: { id: string; name: string }, booking: MeetingParams & { teamId: string; leadIds: string[] }): Promise<string | null> {
  if (!isDbConfigured()) return null;
  const [row] = await getDb().insert(jobs).values({
    userId, agentId: agent.id, kind: "book-meeting", status: "needs_approval",
    params: { agent, ...booking, leadCount: booking.leadIds.length },
  }).returning({ id: jobs.id });
  return row?.id ?? null;
}

/** Proceed: queue the step and say so. The caller then kicks the runner. A
 *  meeting has no runner: it is booked here and the result posted. */
export async function approveStep(userId: string, id: string): Promise<ApprovalResult> {
  if (!isDbConfigured()) return { error: "Server not configured." };
  try {
    const [row] = await getDb().update(jobs).set({ status: "queued" })
      .where(and(eq(jobs.id, id), eq(jobs.userId, userId), eq(jobs.status, "needs_approval"), ne(jobs.kind, "book-meeting")))
      .returning({ agentId: jobs.agentId, kind: jobs.kind, params: jobs.params });
    // Not a waiting runner step: a meeting ask, or a step no longer waiting.
    if (!row) return await bookApproved(userId, id);
    const teamId = teamOf(row.params);
    if (teamId) await postTeamMessage(userId, teamId, row.agentId, startText(row.kind, id));
    return { ok: true, kind: row.kind, pod: isPod(row.params) };
  } catch (e) {
    console.error("[pod] approve failed:", e);
    return { error: "I couldn't start that. Please try again." };
  }
}

/** Book an approved meeting ask. The claim (needs_approval → running) makes a
 *  double Proceed book once; the job's result records how many were booked. */
async function bookApproved(userId: string, id: string): Promise<ApprovalResult> {
  const db = getDb();
  const [row] = await db.update(jobs).set({ status: "running", startedAt: new Date() })
    .where(and(eq(jobs.id, id), eq(jobs.userId, userId), eq(jobs.status, "needs_approval"), eq(jobs.kind, "book-meeting")))
    .returning({ agentId: jobs.agentId, params: jobs.params });
  if (!row) return { ok: true, kind: null, pod: false };
  const p = (row.params ?? {}) as MeetingParams;
  const leadIds = p.leadIds ?? [];
  const booked: string[] = [];
  if (p.iso && p.label) {
    for (const lead of leadIds) if (await bookMeeting(userId, row.agentId, lead, p.iso, p.label, p.type ?? "Meeting")) booked.push(lead);
  }
  await db.update(jobs).set({ status: "done", finishedAt: new Date(), result: { booked: booked.length } }).where(eq(jobs.id, id));
  const nameOf = (lead: string) => p.names?.[lead] ?? "the lead";
  if (p.teamId) await postTeamMessage(userId, p.teamId, row.agentId, bookedText(p.type ?? "Meeting", p.label ?? "", leadIds.map(nameOf), booked.map(nameOf)));
  return { ok: true, kind: null, pod: false };
}

/** Cancel: stop the whole run. This step and every other waiting step of the
 *  team are dismissed, then the agent posts what the run did so far. "The run"
 *  is the team's jobs since the user's last message in the thread. A typed "no"
 *  is itself a message, so the caller passes `beforeMsgId` (its row id) to
 *  look past it. A step already running still finishes, and chainNext sees the
 *  cancel and doesn't hand on. */
export async function cancelStep(userId: string, id: string, beforeMsgId?: number): Promise<ApprovalResult> {
  if (!isDbConfigured()) return { error: "Server not configured." };
  try {
    const db = getDb();
    const now = new Date();
    const [row] = await db.update(jobs).set({ status: "dismissed", finishedAt: now })
      .where(and(eq(jobs.id, id), eq(jobs.userId, userId), eq(jobs.status, "needs_approval")))
      .returning({ agentId: jobs.agentId, kind: jobs.kind, params: jobs.params, createdAt: jobs.createdAt });
    if (!row) return { ok: true, kind: null, pod: false };
    const teamId = teamOf(row.params);
    if (!teamId) return { ok: true, kind: row.kind, pod: isPod(row.params) };

    const waiting = ["needs_approval", "queued"];
    const others = await db.select({ id: jobs.id, params: jobs.params }).from(jobs)
      .where(and(eq(jobs.userId, userId), inArray(jobs.status, waiting)));
    const ids = others.filter((j) => teamOf(j.params) === teamId).map((j) => j.id);
    if (ids.length) {
      await db.update(jobs).set({ status: "dismissed", finishedAt: now })
        .where(and(eq(jobs.userId, userId), inArray(jobs.id, ids), inArray(jobs.status, waiting)));
    }

    // A cancelled meeting ask has no run behind it to sum up.
    if (row.kind === "book-meeting") {
      await postTeamMessage(userId, teamId, row.agentId, "Okay, I won't book it.");
      return { ok: true, kind: row.kind, pod: false };
    }

    const mine = [eq(messages.userId, userId), eq(messages.agentId, teamId), eq(messages.who, "me")];
    if (beforeMsgId !== undefined) mine.push(lt(messages.id, beforeMsgId));
    const [lastMine] = await db.select({ createdAt: messages.createdAt }).from(messages)
      .where(and(...mine)).orderBy(desc(messages.createdAt)).limit(1);
    const since = lastMine?.createdAt ?? row.createdAt;
    const run = await db.select({ kind: jobs.kind, status: jobs.status, result: jobs.result, params: jobs.params }).from(jobs)
      .where(and(eq(jobs.userId, userId), gte(jobs.createdAt, since))).orderBy(asc(jobs.createdAt));
    const summary = cancelSummary(run
      .filter((j) => teamOf(j.params) === teamId)
      .map((j) => ({ kind: j.kind, status: j.status, result: j.result, agentName: (j.params as { agent?: { name?: string } } | null)?.agent?.name ?? "" })));
    await postTeamMessage(userId, teamId, row.agentId, summary);
    return { ok: true, kind: row.kind, pod: isPod(row.params) };
  } catch (e) {
    console.error("[pod] cancel failed:", e);
    return { error: "I couldn't cancel that. Please try again." };
  }
}
