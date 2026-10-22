// Time limits for the job runners (/api/jobs/run and /api/scrape). A serverless
// function killed at maxDuration leaves its claimed job 'running' with nothing to
// finish it, so the runners keep inside a budget and reap jobs that outlived one.
import { and, eq, inArray } from "drizzle-orm";
import { jobs, type getDb } from "@/lib/db";

type Db = ReturnType<typeof getDb>;

// Must match the routes' `maxDuration` exports.
export const RUN_MAX_DURATION_S = 300;
export const SCRAPE_MAX_DURATION_S = 60;

// Extra time past maxDuration before a 'running' job counts as dead.
const STALE_GRACE_MS = 60_000;

/** Stop starting new leads after this long in /api/jobs/run. A lead can take
 *  LEAD_TIMEOUT_MS more, which still finishes before maxDuration. */
export const RUN_LEAD_BUDGET_MS = 180_000;
/** Don't claim another job after this long in /api/jobs/run. */
export const RUN_CLAIM_BUDGET_MS = 120_000;
/** One lead (product search + LLM call + save). the AI client has its own 30s timeout;
 *  this also covers the embedding call, which has none. */
export const LEAD_TIMEOUT_MS = 75_000;
/** The Firecrawl + LLM scrape, leaving time to save leads inside 60s. */
export const SCRAPE_TIMEOUT_MS = 45_000;

/** How long a job of this kind may stay 'running' before it is reaped. */
export function staleAfterMs(kind: string): number {
  const maxS = kind === "scrape" ? SCRAPE_MAX_DURATION_S : RUN_MAX_DURATION_S;
  return maxS * 1000 + STALE_GRACE_MS;
}

export function isStale(job: { kind: string; status: string; startedAt: Date | null }, now: Date): boolean {
  if (job.status !== "running" || !job.startedAt) return false;
  return now.getTime() - job.startedAt.getTime() > staleAfterMs(job.kind);
}

/** Mark this user's dead 'running' jobs as failed. Failed (not requeued) so a job
 *  that always overruns can't loop forever; a failed job no longer blocks
 *  enqueuePodStage or the scrape claim, so the user can run the stage again.
 *  The status='running' guard keeps a job that just finished as it is. */
export async function reapStaleJobs(db: Db, userId: string, now = new Date()): Promise<number> {
  const running = await db.select({ id: jobs.id, kind: jobs.kind, status: jobs.status, startedAt: jobs.startedAt })
    .from(jobs).where(and(eq(jobs.userId, userId), eq(jobs.status, "running")));
  const stale = running.filter((j) => isStale(j, now)).map((j) => j.id);
  if (!stale.length) return 0;
  const reaped = await db.update(jobs)
    .set({ status: "failed", finishedAt: now, error: "Timed out: the run was stopped before it finished." })
    .where(and(eq(jobs.userId, userId), eq(jobs.status, "running"), inArray(jobs.id, stale)))
    .returning({ id: jobs.id });
  return reaped.length;
}

/** Reject if `p` hasn't settled within `ms`. The underlying work isn't cancelled,
 *  but the caller gets control back in time to record the failure. */
export function withDeadline<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}
