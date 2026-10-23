"use server";
// Client-facing pod actions: list pending approvals, and Proceed (approve) or
// Cancel (reject) a step an agent asked about. All user-scoped: the work is in
// lib/pod/decisions, which a typed "yes"/"no" in the chat also uses.
import { and, desc, eq } from "drizzle-orm";
import { getDb, isDbConfigured, jobs } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import type { ApprovalDTO } from "./types";
import { approveStep, cancelStep, type ApprovalResult } from "./decisions";

export type { ApprovalResult };

async function uid(): Promise<string | null> {
  const s = await getSession();
  return s?.userId ?? null;
}

const teamOf = (params: unknown) => (params as { teamId?: string } | null)?.teamId;

export async function listPendingApprovals(teamId: string): Promise<ApprovalDTO[]> {
  if (!isDbConfigured()) return [];
  const userId = await uid();
  if (!userId) return [];
  const rows = await getDb().select().from(jobs)
    .where(and(eq(jobs.userId, userId), eq(jobs.status, "needs_approval"))).orderBy(desc(jobs.createdAt));
  return rows
    .filter((r) => teamOf(r.params) === teamId)
    .map((r) => {
      const p = r.params as { agent?: { name?: string }; leadCount?: number; leadIds?: string[] | null };
      return { id: r.id, agentName: p.agent?.name ?? "Agent", capability: r.kind, leadCount: p.leadCount ?? p.leadIds?.length ?? 0 };
    });
}

/** Proceed: queue the step and say so. The caller then kicks the runner. */
export async function approveJob(id: string): Promise<ApprovalResult> {
  if (!isDbConfigured()) return { error: "Server not configured." };
  const userId = await uid();
  if (!userId) return { error: "Not signed in." };
  return approveStep(userId, id);
}

/** Cancel: stop the whole run, then the agent posts what it did so far. */
export async function rejectJob(id: string): Promise<ApprovalResult> {
  if (!isDbConfigured()) return { error: "Server not configured." };
  const userId = await uid();
  if (!userId) return { error: "Not signed in." };
  return cancelStep(userId, id);
}
