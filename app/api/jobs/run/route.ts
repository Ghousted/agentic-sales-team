import { NextResponse } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb, isDbConfigured, jobs } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { pickLeadsForRun, applyOutreachResult, pickLeadsForResearch, applyResearchResult } from "@/lib/leads/store";
import { draftOutreach } from "@/lib/ai/outreach";
import { draftResearch } from "@/lib/ai/research";
import type { AgentSnapshot } from "@/lib/leads/types";

// Needs the Node runtime (raw fetch to Gemini, no edge constraints) and room to
// run a small batch of Gemini calls.
export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_JOBS_PER_INVOCATION = 5;

export async function POST() {
  if (!isDbConfigured()) return NextResponse.json({ processed: 0, drafts: 0 });
  const session = await getSession();
  if (!session) return NextResponse.json({ processed: 0, drafts: 0 }, { status: 401 });
  const userId = session.userId;
  const db = getDb();

  let processed = 0;
  let drafts = 0;
  let briefed = 0;

  for (let i = 0; i < MAX_JOBS_PER_INVOCATION; i++) {
    const [candidate] = await db.select().from(jobs)
      .where(and(eq(jobs.userId, userId), eq(jobs.status, "queued"), inArray(jobs.kind, ["outreach", "research"]))).orderBy(asc(jobs.createdAt)).limit(1);
    if (!candidate) break;

    // Atomic claim: the status='queued' guard means two runners can't grab it.
    const claimed = await db.update(jobs).set({ status: "running", startedAt: new Date() })
      .where(and(eq(jobs.id, candidate.id), eq(jobs.userId, userId), eq(jobs.status, "queued"))).returning({ id: jobs.id });
    if (!claimed.length) continue;
    processed++;

    const params = candidate.params as { agent: AgentSnapshot; leadIds: string[] | null; batchSize: number };
    let created = 0;
    let failed = 0;
    try {
      if (candidate.kind === "outreach") {
        const batch = await pickLeadsForRun(userId, params.agent.id, params.leadIds ?? undefined, params.batchSize ?? 5);
        for (const lead of batch) {
          try {
            const result = await draftOutreach(params.agent, { name: lead.name, title: lead.title, company: lead.company, email: lead.email, platform: lead.platform, research: lead.research });
            await applyOutreachResult(userId, params.agent.id, lead, result);
            created++;
            drafts++;
          } catch (e) {
            console.error("[jobs/run] lead failed:", e);
            failed++;
          }
        }
        await db.update(jobs).set({ status: "done", finishedAt: new Date(), result: { draftsCreated: created, failed } })
          .where(and(eq(jobs.id, candidate.id), eq(jobs.userId, userId)));
      } else {
        // research
        const batch = await pickLeadsForResearch(userId, params.agent.id, params.leadIds ?? undefined, params.batchSize ?? 5);
        for (const lead of batch) {
          try {
            const brief = await draftResearch(params.agent, { name: lead.name, title: lead.title, company: lead.company, platform: lead.platform });
            await applyResearchResult(userId, params.agent.id, lead, brief);
            created++;
            briefed++;
          } catch (e) {
            console.error("[jobs/run] research failed:", e);
            failed++;
          }
        }
        await db.update(jobs).set({ status: "done", finishedAt: new Date(), result: { briefed: created, failed } })
          .where(and(eq(jobs.id, candidate.id), eq(jobs.userId, userId)));
      }
    } catch (e) {
      await db.update(jobs).set({ status: "failed", finishedAt: new Date(), error: String(e).slice(0, 500) })
        .where(and(eq(jobs.id, candidate.id), eq(jobs.userId, userId)));
    }
  }

  return NextResponse.json({ processed, drafts, briefed });
}
