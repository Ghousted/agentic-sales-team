"use server";
// Job queue: enqueue an outreach run (a `jobs` row) and read job status.
// The run itself is done by POST /api/jobs/run (a Node route handler).
import { and, eq } from "drizzle-orm";
import { getDb, isDbConfigured, jobs } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import type { AgentSnapshot } from "@/lib/leads/types";

async function uid(): Promise<string | null> {
  const s = await getSession();
  return s?.userId ?? null;
}

export async function enqueueJob(input: { agent: AgentSnapshot; kind: string; capabilities?: string[]; leadIds?: string[]; batchSize?: number; target?: number }): Promise<{ jobId: string } | { error: string }> {
  if (!isDbConfigured()) return { error: "Server not configured." };
  const userId = await uid();
  if (!userId) return { error: "Not signed in." };
  // Capability gating: an agent can only run a kind its capabilities include.
  if (input.capabilities && !input.capabilities.includes(input.kind)) {
    return { error: "This agent can't run " + input.kind + "." };
  }
  const [row] = await getDb().insert(jobs).values({
    userId, agentId: input.agent.id, kind: input.kind, status: "queued",
    params: { agent: input.agent, leadIds: input.leadIds ?? null, batchSize: input.batchSize ?? 5, target: input.target ?? 10 },
  }).returning({ id: jobs.id });
  return { jobId: row.id };
}

export async function enqueueOutreachJob(input: { agent: AgentSnapshot; leadIds?: string[]; batchSize?: number }): Promise<{ jobId: string } | { error: string }> {
  return enqueueJob({ agent: input.agent, kind: "outreach", leadIds: input.leadIds, batchSize: input.batchSize });
}

export async function getJob(id: string): Promise<{ status: string; result: unknown; error: string | null } | null> {
  if (!isDbConfigured()) return null;
  const userId = await uid();
  if (!userId) return null;
  const [row] = await getDb().select({ status: jobs.status, result: jobs.result, error: jobs.error })
    .from(jobs).where(and(eq(jobs.id, id), eq(jobs.userId, userId))).limit(1);
  return row ?? null;
}
