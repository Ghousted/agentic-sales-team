"use server";
// Client-facing pod actions: start the pipeline, list pending approvals, and
// approve/reject a gated stage. All user-scoped.
import { and, desc, eq } from "drizzle-orm";
import { getDb, isDbConfigured, jobs } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import type { ApprovalDTO } from "./types";
import { postTeamMessage } from "@/lib/chat/teamMessages";

async function uid(): Promise<string | null> {
  const s = await getSession();
  return s?.userId ?? null;
}

export async function listPendingApprovals(teamId: string): Promise<ApprovalDTO[]> {
  if (!isDbConfigured()) return [];
  const userId = await uid();
  if (!userId) return [];
  const rows = await getDb().select().from(jobs)
    .where(and(eq(jobs.userId, userId), eq(jobs.status, "needs_approval"))).orderBy(desc(jobs.createdAt));
  return rows
    .filter((r) => (r.params as { teamId?: string })?.teamId === teamId)
    .map((r) => {
      const p = r.params as { agent?: { name?: string }; leadCount?: number };
      return { id: r.id, agentName: p.agent?.name ?? "Agent", capability: r.kind, leadCount: p.leadCount ?? 0 };
    });
}

export async function approveJob(id: string): Promise<void> {
  if (!isDbConfigured()) return;
  const userId = await uid();
  if (!userId) return;
  const [row] = await getDb().update(jobs).set({ status: "queued" })
    .where(and(eq(jobs.id, id), eq(jobs.userId, userId), eq(jobs.status, "needs_approval")))
    .returning({ agentId: jobs.agentId, params: jobs.params });
  if (!row) return; // wasn't pending (already handled) — no ack
  const teamId = (row.params as { teamId?: string } | null)?.teamId;
  if (teamId) await postTeamMessage(userId, teamId, row.agentId, "Thanks — starting now.");
}

export async function rejectJob(id: string): Promise<void> {
  if (!isDbConfigured()) return;
  const userId = await uid();
  if (!userId) return;
  const [row] = await getDb().update(jobs).set({ status: "dismissed", finishedAt: new Date() })
    .where(and(eq(jobs.id, id), eq(jobs.userId, userId), eq(jobs.status, "needs_approval")))
    .returning({ agentId: jobs.agentId, params: jobs.params });
  if (!row) return;
  const teamId = (row.params as { teamId?: string } | null)?.teamId;
  if (teamId) await postTeamMessage(userId, teamId, row.agentId, "No problem — holding off for now.");
}
