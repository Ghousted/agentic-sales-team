// Synchronous scrape runner (Vercel Node route). Claims a queued scrape job, discovers
// public prospects via Firecrawl + Gemini (lib/scrape/firecrawl), writes them as PENDING
// leads, and finishes the job — all in one ≤60s invocation. Replaces the Python worker.
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, isDbConfigured, jobs } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { runFirecrawlScrape, isFirecrawlConfigured } from "@/lib/scrape/firecrawl";
import { isGeminiConfigured } from "@/lib/ai/gemini";
import { addScrapedLeads } from "@/lib/leads/store";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Server not configured." }, { status: 500 });
  const s = await getSession();
  const userId = s?.userId;
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { jobId } = (await req.json().catch(() => ({}))) as { jobId?: string };
  if (!jobId) return NextResponse.json({ error: "Missing jobId." }, { status: 400 });

  const db = getDb();
  const [job] = await db.select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.userId, userId))).limit(1);
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  if (job.kind !== "scrape") return NextResponse.json({ error: "Not a scrape job." }, { status: 400 });

  if (!isFirecrawlConfigured()) {
    await db.update(jobs).set({ status: "failed", error: "FIRECRAWL_API_KEY not set.", finishedAt: new Date() })
      .where(and(eq(jobs.id, jobId), eq(jobs.userId, userId)));
    return NextResponse.json({ error: "Scraping isn't configured (FIRECRAWL_API_KEY)." }, { status: 400 });
  }

  if (!isGeminiConfigured()) {
    await db.update(jobs).set({ status: "failed", error: "GEMINI_API_KEY not set (needed to extract prospects).", finishedAt: new Date() })
      .where(and(eq(jobs.id, jobId), eq(jobs.userId, userId)));
    return NextResponse.json({ error: "Lead extraction isn't configured (GEMINI_API_KEY)." }, { status: 400 });
  }

  // Atomic claim: only one invocation proceeds.
  const claimed = await db.update(jobs).set({ status: "running", startedAt: new Date() })
    .where(and(eq(jobs.id, jobId), eq(jobs.userId, userId), eq(jobs.status, "queued")))
    .returning({ id: jobs.id });
  if (claimed.length === 0) return NextResponse.json({ ok: true, leadsFound: 0, note: "already running" });

  const params = (job.params ?? {}) as { agent?: any; target?: number; instruction?: string | null };
  const agent = params.agent ?? { id: job.agentId, name: "Agent", role: "", goal: "", task: "" };
  const target = typeof params.target === "number" ? params.target : 10;
  const instruction = params.instruction ?? undefined;

  try {
    const prospects = await runFirecrawlScrape(agent, target, instruction);
    const leadsFound = await addScrapedLeads(userId, job.agentId, prospects);
    await db.update(jobs).set({ status: "done", result: { leadsFound }, finishedAt: new Date() })
      .where(and(eq(jobs.id, jobId), eq(jobs.userId, userId)));
    return NextResponse.json({ ok: true, leadsFound });
  } catch (e) {
    await db.update(jobs).set({ status: "failed", error: String(e).slice(0, 500), finishedAt: new Date() })
      .where(and(eq(jobs.id, jobId), eq(jobs.userId, userId)));
    return NextResponse.json({ error: "Scrape failed: " + String(e).slice(0, 200) }, { status: 500 });
  }
}
