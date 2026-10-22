import { NextResponse } from "next/server";
import { isDbConfigured } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { drainJobs } from "@/lib/jobs/drain";

// Needs the Node runtime (raw fetch to OpenRouter, no edge constraints) and room to
// run a small batch of LLM calls. Keep maxDuration equal to RUN_MAX_DURATION_S.
export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_JOBS_PER_INVOCATION = 5;

// A fast path only: the browser kicks this right after queueing a job so it starts
// at once. GET /api/cron/jobs runs whatever is still queued, every minute.
export async function POST() {
  if (!isDbConfigured()) return NextResponse.json({ processed: 0, drafts: 0 });
  const session = await getSession();
  if (!session) return NextResponse.json({ processed: 0, drafts: 0 }, { status: 401 });
  return NextResponse.json(await drainJobs({ userId: session.userId, maxJobs: MAX_JOBS_PER_INVOCATION }));
}
