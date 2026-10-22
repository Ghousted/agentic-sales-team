"use server";
// Job queue: enqueue an outreach run (a `jobs` row) and read job status.
// The run itself is done by POST /api/jobs/run (a Node route handler).
import { and, eq } from "drizzle-orm";
import { getDb, isDbConfigured, jobs } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { agentInfo } from "@/lib/pod/orchestrate";
import type { AgentSnapshot } from "@/lib/leads/types";

// Callers still send a whole snapshot; only its id is read.
type AgentRef = Pick<AgentSnapshot, "id"> & Partial<AgentSnapshot>;

async function uid(): Promise<string | null> {
  const s = await getSession();
  return s?.userId ?? null;
}

// A server action is callable with any arguments, so only `agent.id` is taken
// from the caller. The agent's prompt fields and capabilities are loaded here,
// and a paused, removed or unknown agent gets no job.
export async function enqueueJob(input: { agent: AgentRef; kind: string; capabilities?: string[]; leadIds?: string[]; batchSize?: number; target?: number; instruction?: string; pod?: boolean; teamId?: string }): Promise<{ jobId: string } | { error: string }> {
  if (!isDbConfigured()) return { error: "Server not configured." };
  const userId = await uid();
  if (!userId) return { error: "Not signed in." };
  const info = await agentInfo(userId, input.agent.id);
  if (!info) return { error: "This agent is paused or no longer exists." };
  // Capability gating: an agent can only run a kind its stored capabilities include.
  if (!info.capabilities.includes(input.kind)) {
    return { error: "This agent can't run " + input.kind + "." };
  }
  const agent = { id: info.id, name: info.name, role: info.role, goal: info.goal, task: info.task };
  const [row] = await getDb().insert(jobs).values({
    userId, agentId: agent.id, kind: input.kind, status: "queued",
    params: { agent, leadIds: input.leadIds ?? null, batchSize: input.batchSize ?? 5, target: input.target ?? 10, instruction: input.instruction ?? null, pod: input.pod ?? false, teamId: input.teamId ?? null },
  }).returning({ id: jobs.id });
  return { jobId: row.id };
}

export async function enqueueOutreachJob(input: { agent: AgentRef; leadIds?: string[]; batchSize?: number }): Promise<{ jobId: string } | { error: string }> {
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
