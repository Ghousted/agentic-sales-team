"use server";
// Client-facing pod actions: list pending approvals, and Proceed (approve) or
// Cancel (reject) a step an agent asked about. All user-scoped.
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { getDb, isDbConfigured, jobs, messages } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import type { ApprovalDTO } from "./types";
import { postTeamMessage } from "@/lib/chat/teamMessages";
import { runMarker } from "@/lib/scrape/steps";
import { cancelSummary } from "./summary";

async function uid(): Promise<string | null> {
  const s = await getSession();
  return s?.userId ?? null;
}

const teamOf = (params: unknown) => (params as { teamId?: string } | null)?.teamId;
const isPod = (params: unknown) => !!(params as { pod?: boolean } | null)?.pod;

/** What a Proceed/Cancel click did. `kind` is the job's kind, or null when the
 *  step was no longer waiting (already handled elsewhere). `pod` jobs narrate
 *  their own outcome through the chain; others need reportTeamJob. */
export type ApprovalResult = { ok: true; kind: string | null; pod: boolean } | { error: string };

export async function listPendingApprovals(teamId: string): Promise<ApprovalDTO[]> {
  if (!isDbConfigured()) return [];
  const userId = await uid();
  if (!userId) return [];
  const rows = await getDb().select().from(jobs)
    .where(and(eq(jobs.userId, userId), eq(jobs.status, "needs_approval"))).orderBy(desc(jobs.createdAt));
  return rows
    .filter((r) => teamOf(r.params) === teamId)
    .map((r) => {
      const p = r.params as { agent?: { name?: string }; leadCount?: number };
      return { id: r.id, agentName: p.agent?.name ?? "Agent", capability: r.kind, leadCount: p.leadCount ?? 0 };
    });
}

/** Proceed: queue the step and say so. A scrape's reply carries the ⟦run:…⟧
 *  marker, so its live timeline shows under it. The caller then kicks the runner. */
export async function approveJob(id: string): Promise<ApprovalResult> {
  if (!isDbConfigured()) return { error: "Server not configured." };
  const userId = await uid();
  if (!userId) return { error: "Not signed in." };
  try {
    const [row] = await getDb().update(jobs).set({ status: "queued" })
      .where(and(eq(jobs.id, id), eq(jobs.userId, userId), eq(jobs.status, "needs_approval")))
      .returning({ agentId: jobs.agentId, kind: jobs.kind, params: jobs.params });
    if (!row) return { ok: true, kind: null, pod: false };
    const teamId = teamOf(row.params);
    if (teamId) {
      const text = row.kind === "scrape" ? "Okay, starting the search now. I will post the results here." + runMarker(id) : "Okay, starting now.";
      await postTeamMessage(userId, teamId, row.agentId, text);
    }
    return { ok: true, kind: row.kind, pod: isPod(row.params) };
  } catch (e) {
    console.error("[pod] approve failed:", e);
    return { error: "I couldn't start that. Please try again." };
  }
}

/** Cancel: stop the whole run. This step and every other waiting step of the
 *  team are dismissed, then the agent posts what the run did so far. "The run"
 *  is the team's jobs since the user's last message in the thread (Proceed and
 *  Cancel clicks add no message). A step already running still finishes, and
 *  chainNext sees the cancel and doesn't hand on. */
export async function rejectJob(id: string): Promise<ApprovalResult> {
  if (!isDbConfigured()) return { error: "Server not configured." };
  const userId = await uid();
  if (!userId) return { error: "Not signed in." };
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

    const [lastMine] = await db.select({ createdAt: messages.createdAt }).from(messages)
      .where(and(eq(messages.userId, userId), eq(messages.agentId, teamId), eq(messages.who, "me")))
      .orderBy(desc(messages.createdAt)).limit(1);
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
