// Background scrape runner. Vercel Cron calls this every minute (vercel.json) with
// `Authorization: Bearer $CRON_SECRET`, so a queued scrape runs for any user even
// when no tab kicked /api/scrape. One job per tick: a scrape takes up to ~45s.
import { NextResponse } from "next/server";
import { isDbConfigured } from "@/lib/db";
import { cronAuthorized } from "@/lib/cron/auth";
import { drainOneScrapeJob } from "@/lib/jobs/scrape";

export const runtime = "nodejs";
export const maxDuration = 60; // keep equal to SCRAPE_MAX_DURATION_S
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!isDbConfigured()) return NextResponse.json({ processed: 0, leadsFound: 0 });
  return NextResponse.json(await drainOneScrapeJob());
}
