"use server";
// Job queue: enqueue an outreach run (a `jobs` row) and read job status.
// The run itself is done by POST /api/jobs/run (a Node route handler).
import { and, eq, gte, sql } from "drizzle-orm";
import { getDb, isDbConfigured, jobs } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { agentInfo } from "@/lib/pod/orchestrate";
import type { AgentSnapshot } from "@/lib/leads/types";
import type { ScrapeStep } from "@/lib/scrape/steps";
import { limitJobSize, jobQuotaError, QUOTA_WINDOW_MS } from "./limits";
import { inAccountWorkspaces } from "@/lib/workspaces/scope";

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
  const session = await getSession();
  const userId = session?.userId;
  if (!session || !userId) return { error: "Not signed in." };
  const info = await agentInfo(userId, input.agent.id);
  if (!info) return { error: "This agent is paused or no longer exists." };
  // Capability gating: an agent can only run a kind its stored capabilities include.
  if (!info.capabilities.includes(input.kind)) {
    return { error: "This agent can't run " + input.kind + "." };
  }
  // Size and quota are checked here, where every user-started job is created, so
  // neither the run route nor the cron can be handed a job that skipped them.
  const size = limitJobSize(input);
  if ("error" in size) return size;
  const db = getDb();
  const [recent] = await db.select({
    total: sql<number>`count(*)::int`,
    scrapes: sql<number>`(count(*) filter (where ${jobs.kind} = 'scrape'))::int`,
    // Counted across all the account's workspaces, not just this one.
  }).from(jobs).where(and(inAccountWorkspaces(jobs.userId, session.accountId), gte(jobs.createdAt, new Date(Date.now() - QUOTA_WINDOW_MS))));
  const quota = jobQuotaError(input.kind, { total: Number(recent?.total ?? 0), scrapes: Number(recent?.scrapes ?? 0) });
  if (quota) return { error: quota };
  const agent = { id: info.id, name: info.name, role: info.role, goal: info.goal, task: info.task };
  const [row] = await db.insert(jobs).values({
    userId, agentId: agent.id, kind: input.kind, status: "queued",
    params: { agent, leadIds: size.leadIds, batchSize: size.batchSize, target: size.target, instruction: size.instruction, pod: input.pod === true, teamId: typeof input.teamId === "string" ? input.teamId : null },
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

/** A scrape job's live steps for the chat timeline. The user's own jobs only. */
export async function getScrapeProgress(jobId: string): Promise<{ status: string; steps: ScrapeStep[]; error: string | null } | null> {
  if (!isDbConfigured() || typeof jobId !== "string" || !/^[0-9a-f-]{36}$/i.test(jobId)) return null;
  const userId = await uid();
  if (!userId) return null;
  const [job] = await getDb().select({ status: jobs.status, kind: jobs.kind, result: jobs.result, error: jobs.error })
    .from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.userId, userId))).limit(1);
  if (!job || job.kind !== "scrape") return null;
  const steps = (job.result as { steps?: ScrapeStep[] } | null)?.steps;
  return { status: job.status, steps: Array.isArray(steps) ? steps : [], error: job.status === "failed" ? "That search didn't complete." : null };
}
