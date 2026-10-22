// Synchronous scrape runner (Vercel Node route). Claims a queued scrape job, discovers
// public prospects via Firecrawl + LLM (lib/scrape/firecrawl), writes them as PENDING
// leads, and finishes the job — all in one ≤60s invocation. Replaces the Python worker.
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, isDbConfigured, jobs } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { runFirecrawlScrape, isFirecrawlConfigured } from "@/lib/scrape/firecrawl";
import { isAIConfigured } from "@/lib/ai/openrouter";
import { addScrapedLeads } from "@/lib/leads/store";
import { chainNext } from "@/lib/pod/orchestrate";
import { reapStaleJobs, withDeadline, SCRAPE_TIMEOUT_MS } from "@/lib/jobs/runtime";

export const runtime = "nodejs";
export const maxDuration = 60; // keep equal to SCRAPE_MAX_DURATION_S

export async function POST(req: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Server not configured." }, { status: 500 });
  const s = await getSession();
  const userId = s?.userId;
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { jobId } = (await req.json().catch(() => ({}))) as { jobId?: string };
  if (!jobId) return NextResponse.json({ error: "Missing jobId." }, { status: 400 });

  const db = getDb();
  // A scrape killed at maxDuration stays 'running' and would answer "already running" forever.
  try { await reapStaleJobs(db, userId); } catch (e) { console.error("[scrape] reap failed:", e); }
  const [job] = await db.select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.userId, userId))).limit(1);
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  if (job.kind !== "scrape") return NextResponse.json({ error: "Not a scrape job." }, { status: 400 });

  if (!isFirecrawlConfigured()) {
    await db.update(jobs).set({ status: "failed", error: "FIRECRAWL_API_KEY not set.", finishedAt: new Date() })
      .where(and(eq(jobs.id, jobId), eq(jobs.userId, userId)));
    return NextResponse.json({ error: "Scraping isn't configured (FIRECRAWL_API_KEY)." }, { status: 400 });
  }

  if (!isAIConfigured()) {
    await db.update(jobs).set({ status: "failed", error: "OPENROUTER_API_KEY not set (needed to extract prospects).", finishedAt: new Date() })
      .where(and(eq(jobs.id, jobId), eq(jobs.userId, userId)));
    return NextResponse.json({ error: "Lead extraction isn't configured (OPENROUTER_API_KEY)." }, { status: 400 });
  }

  // Atomic claim: only one invocation proceeds.
  const claimed = await db.update(jobs).set({ status: "running", startedAt: new Date() })
    .where(and(eq(jobs.id, jobId), eq(jobs.userId, userId), eq(jobs.status, "queued")))
    .returning({ id: jobs.id });
  if (claimed.length === 0) {
    if (job.status === "running") return NextResponse.json({ ok: true, leadsFound: 0, note: "already running" });
    return NextResponse.json({ error: job.status === "failed" ? "That search stopped before it finished. Please try again." : "That search has already finished." }, { status: 409 });
  }

  const params = (job.params ?? {}) as { agent?: any; target?: number; instruction?: string | null; pod?: boolean; teamId?: string | null };
  const agent = params.agent ?? { id: job.agentId, name: "Agent", role: "", goal: "", task: "" };
  const target = typeof params.target === "number" ? params.target : 10;
  const instruction = params.instruction ?? undefined;

  try {
    // Finish inside maxDuration so the job is marked failed, not left 'running'.
    const prospects = await withDeadline(runFirecrawlScrape(agent, target, instruction), SCRAPE_TIMEOUT_MS, "Search");
    const leadsFound = await addScrapedLeads(userId, job.agentId, prospects);
    await db.update(jobs).set({ status: "done", result: { leadsFound }, finishedAt: new Date() })
      .where(and(eq(jobs.id, jobId), eq(jobs.userId, userId)));
    // Autonomous chain: hand off to the Assessor (or ask the user to review).
    if (params.pod && params.teamId) {
      try { await chainNext(userId, params.teamId, "scrape", leadsFound); } catch (e) { console.error("[scrape] chainNext failed:", e); }
    }
    return NextResponse.json({ ok: true, leadsFound });
  } catch (e) {
    await db.update(jobs).set({ status: "failed", error: String(e).slice(0, 500), finishedAt: new Date() })
      .where(and(eq(jobs.id, jobId), eq(jobs.userId, userId)));
    return NextResponse.json({ error: "Scrape failed: " + String(e).slice(0, 200) }, { status: 500 });
  }
}
