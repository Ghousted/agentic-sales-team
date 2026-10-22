// Runs a scrape job: discovers public prospects via Firecrawl + LLM (lib/scrape/firecrawl),
// writes them as PENDING leads, finishes the job and hands off down the pod chain.
// Shared by POST /api/scrape (one job, kicked by the browser) and GET /api/cron/scrape
// (the oldest queued scrape job of any user, every minute from Vercel Cron).
import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { getDb, jobs } from "@/lib/db";
import { runFirecrawlScrape, isFirecrawlConfigured } from "@/lib/scrape/firecrawl";
import { isAIConfigured } from "@/lib/ai/openrouter";
import { addScrapedLeads } from "@/lib/leads/store";
import { chainNext } from "@/lib/pod/orchestrate";
import { reapStaleJobs, withDeadline, SCRAPE_TIMEOUT_MS } from "@/lib/jobs/runtime";

type Job = typeof jobs.$inferSelect;

/** Why scraping can't run on this deploy, or null when it can. */
export function scrapeConfigError(): { job: string; user: string } | null {
  if (!isFirecrawlConfigured()) return { job: "FIRECRAWL_API_KEY not set.", user: "Scraping isn't configured (FIRECRAWL_API_KEY)." };
  if (!isAIConfigured()) return { job: "OPENROUTER_API_KEY not set (needed to extract prospects).", user: "Lead extraction isn't configured (OPENROUTER_API_KEY)." };
  return null;
}

export async function failScrapeJob(job: Pick<Job, "id" | "userId">, error: string): Promise<void> {
  await getDb().update(jobs).set({ status: "failed", error: error.slice(0, 500), finishedAt: new Date() })
    .where(and(eq(jobs.id, job.id), eq(jobs.userId, job.userId)));
}

/** Atomic claim: only one runner (browser kick or cron tick) proceeds. */
export async function claimScrapeJob(job: Pick<Job, "id" | "userId">): Promise<boolean> {
  const claimed = await getDb().update(jobs).set({ status: "running", startedAt: new Date() })
    .where(and(eq(jobs.id, job.id), eq(jobs.userId, job.userId), eq(jobs.status, "queued")))
    .returning({ id: jobs.id });
  return claimed.length > 0;
}

/** Run a job this caller has claimed. Marks it done (and chains on) or failed;
 *  rethrows the failure so the caller can report it. */
export async function runClaimedScrapeJob(job: Job): Promise<{ leadsFound: number }> {
  const params = (job.params ?? {}) as { agent?: any; target?: number; instruction?: string | null; pod?: boolean; teamId?: string | null };
  const agent = params.agent ?? { id: job.agentId, name: "Agent", role: "", goal: "", task: "" };
  const target = typeof params.target === "number" ? params.target : 10;
  const instruction = params.instruction ?? undefined;

  let leadsFound: number;
  try {
    // Finish inside maxDuration so the job is marked failed, not left 'running'.
    const prospects = await withDeadline(runFirecrawlScrape(agent, target, instruction), SCRAPE_TIMEOUT_MS, "Search");
    leadsFound = await addScrapedLeads(job.userId, job.agentId, prospects);
    await getDb().update(jobs).set({ status: "done", result: { leadsFound }, finishedAt: new Date() })
      .where(and(eq(jobs.id, job.id), eq(jobs.userId, job.userId)));
  } catch (e) {
    await failScrapeJob(job, String(e));
    throw e;
  }
  // Autonomous chain: hand off to the Assessor (or ask the user to review).
  // Its own try: a failed hand-off must not turn the finished scrape into 'failed'.
  if (params.pod && params.teamId) {
    try { await chainNext(job.userId, params.teamId, "scrape", leadsFound, job.agentId); } catch (e) { console.error("[scrape] chainNext failed:", e); }
  }
  return { leadsFound };
}

/** Cron: claim and run the oldest queued scrape job of any user. One per tick,
 *  since a scrape can take most of the route's 60s. */
export async function drainOneScrapeJob(): Promise<{ processed: number; leadsFound: number }> {
  const db = getDb();
  // A scrape killed at maxDuration stays 'running' and would answer "already running" forever.
  try { await reapStaleJobs(db, null); } catch (e) { console.error("[scrape] reap failed:", e); }

  for (let attempt = 0; attempt < 3; attempt++) {
    const [job] = await db.select().from(jobs)
      .where(and(eq(jobs.status, "queued"), eq(jobs.kind, "scrape"))).orderBy(asc(jobs.createdAt)).limit(1);
    if (!job) return { processed: 0, leadsFound: 0 };
    if (!(await claimScrapeJob(job))) continue; // a browser kick got it first; try the next one

    const config = scrapeConfigError();
    if (config) { await failScrapeJob(job, config.job); return { processed: 1, leadsFound: 0 }; }
    try {
      const { leadsFound } = await runClaimedScrapeJob(job);
      return { processed: 1, leadsFound };
    } catch (e) {
      console.error("[scrape] cron job failed:", e);
      return { processed: 1, leadsFound: 0 };
    }
  }
  return { processed: 0, leadsFound: 0 };
}
