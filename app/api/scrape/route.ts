// Synchronous scrape runner (Vercel Node route), kicked by the browser as a fast path.
// Claims one queued scrape job and runs it in a single ≤60s invocation (lib/jobs/scrape).
// The per-minute cron (/api/cron/scrape) runs it instead if no tab ever kicks it.
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, isDbConfigured, jobs } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { claimScrapeJob, failScrapeJob, runClaimedScrapeJob, scrapeConfigError } from "@/lib/jobs/scrape";
import { reapStaleJobs } from "@/lib/jobs/runtime";

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

  const config = scrapeConfigError();
  if (config) {
    await failScrapeJob(job, config.job);
    return NextResponse.json({ error: config.user }, { status: 400 });
  }

  if (!(await claimScrapeJob(job))) {
    if (job.status === "running" || job.status === "queued") return NextResponse.json({ ok: true, leadsFound: 0, note: "already running" });
    return NextResponse.json({ error: job.status === "failed" ? "That search stopped before it finished. Please try again." : "That search has already finished." }, { status: 409 });
  }

  try {
    const { leadsFound } = await runClaimedScrapeJob(job);
    return NextResponse.json({ ok: true, leadsFound });
  } catch (e) {
    return NextResponse.json({ error: "Scrape failed: " + String(e).slice(0, 200) }, { status: 500 });
  }
}
