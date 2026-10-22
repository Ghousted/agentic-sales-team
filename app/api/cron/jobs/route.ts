// Background job runner. Vercel Cron calls this every minute (vercel.json) with
// `Authorization: Bearer $CRON_SECRET`, so queued jobs run for every user even
// when no browser tab is open. Middleware lets this path through without a
// session; the secret is the only gate, and the route refuses when it is unset.
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { isDbConfigured } from "@/lib/db";
import { drainJobs } from "@/lib/jobs/drain";

export const runtime = "nodejs";
export const maxDuration = 300; // keep equal to RUN_MAX_DURATION_S
export const dynamic = "force-dynamic";

// Upper bound only; the claim budget in drainJobs normally stops it first.
const MAX_JOBS_PER_TICK = 50;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!isDbConfigured()) return NextResponse.json({ processed: 0, drafts: 0, briefed: 0 });
  return NextResponse.json(await drainJobs({ userId: null, maxJobs: MAX_JOBS_PER_TICK }));
}
