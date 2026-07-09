import { NextResponse } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb, isDbConfigured, jobs } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { pickLeadsForRun, applyOutreachResult, pickLeadsForResearch, applyResearchResult, pickLeadsForQualify, applyQualifyResult } from "@/lib/leads/store";
import { draftOutreach } from "@/lib/ai/outreach";
import { draftResearch } from "@/lib/ai/research";
import { qualifyLead } from "@/lib/ai/qualify";
import { draftProposal } from "@/lib/ai/proposal";
import { pickLeadsForProposal, addProposal } from "@/lib/proposals/store";
import { pickLeadsForMatch, addMatches } from "@/lib/matches/store";
import { matchLead } from "@/lib/ai/match";
import { searchProducts } from "@/lib/products/store";
import type { AgentSnapshot } from "@/lib/leads/types";
import { chainNext } from "@/lib/pod/orchestrate";

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
      .where(and(eq(jobs.userId, userId), eq(jobs.status, "queued"), inArray(jobs.kind, ["outreach", "research", "qualify", "proposal", "match"]))).orderBy(asc(jobs.createdAt)).limit(1);
    if (!candidate) break;

    // Atomic claim: the status='queued' guard means two runners can't grab it.
    const claimed = await db.update(jobs).set({ status: "running", startedAt: new Date() })
      .where(and(eq(jobs.id, candidate.id), eq(jobs.userId, userId), eq(jobs.status, "queued"))).returning({ id: jobs.id });
    if (!claimed.length) continue;
    processed++;

    const params = candidate.params as { agent: AgentSnapshot; leadIds: string[] | null; batchSize: number; pod?: boolean; teamId?: string };
    let created = 0;
    let failed = 0;
    try {
      if (candidate.kind === "outreach") {
        const batch = await pickLeadsForRun(userId, params.agent.id, params.leadIds ?? undefined, params.batchSize ?? 5);
        for (const lead of batch) {
          try {
            const products = await searchProducts(userId, [lead.title, lead.company, lead.research?.summary].filter(Boolean).join(" ") || lead.company || lead.name, 3);
            const result = await draftOutreach(params.agent, { name: lead.name, title: lead.title, company: lead.company, email: lead.email, platform: lead.platform, research: lead.research }, products);
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
      } else if (candidate.kind === "research") {
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
      } else if (candidate.kind === "qualify") {
        const batch = await pickLeadsForQualify(userId, params.agent.id, params.leadIds ?? undefined, params.batchSize ?? 5);
        for (const lead of batch) {
          try {
            const q = await qualifyLead(params.agent, { name: lead.name, title: lead.title, company: lead.company, email: lead.email, research: lead.research });
            await applyQualifyResult(userId, params.agent.id, lead, q);
            created++;
          } catch (e) { console.error("[jobs/run] qualify failed:", e); failed++; }
        }
        await db.update(jobs).set({ status: "done", finishedAt: new Date(), result: { qualified: created, failed } })
          .where(and(eq(jobs.id, candidate.id), eq(jobs.userId, userId)));
      } else if (candidate.kind === "proposal") {
        const batch = await pickLeadsForProposal(userId, params.agent.id, params.leadIds ?? undefined, params.batchSize ?? 5);
        for (const lead of batch) {
          try {
            const products = await searchProducts(userId, [lead.title, lead.company, lead.research?.summary].filter(Boolean).join(" ") || lead.company || lead.name, 5);
            const p = await draftProposal(params.agent, { name: lead.name, title: lead.title, company: lead.company, research: lead.research }, products);
            await addProposal(userId, params.agent.id, lead.id, p);
            created++;
          } catch (e) { console.error("[jobs/run] proposal failed:", e); failed++; }
        }
        await db.update(jobs).set({ status: "done", finishedAt: new Date(), result: { proposals: created, failed } })
          .where(and(eq(jobs.id, candidate.id), eq(jobs.userId, userId)));
      } else if (candidate.kind === "match") {
        const batch = await pickLeadsForMatch(userId, params.agent.id, params.leadIds ?? undefined, params.batchSize ?? 5);
        for (const lead of batch) {
          try {
            const listings = await searchProducts(userId, [lead.title, lead.company, lead.research?.summary].filter(Boolean).join(" ") || lead.company || lead.name, 8);
            const m = await matchLead(params.agent, { name: lead.name, title: lead.title, company: lead.company, research: lead.research }, listings);
            await addMatches(userId, params.agent.id, lead.id, m);
            created++;
          } catch (e) { console.error("[jobs/run] match failed:", e); failed++; }
        }
        await db.update(jobs).set({ status: "done", finishedAt: new Date(), result: { matched: created, failed } })
          .where(and(eq(jobs.id, candidate.id), eq(jobs.userId, userId)));
      } else {
        await db.update(jobs).set({ status: "failed", finishedAt: new Date(), error: "Unknown job kind: " + candidate.kind })
          .where(and(eq(jobs.id, candidate.id), eq(jobs.userId, userId)));
      }

      if (params.pod && params.teamId && (candidate.kind === "outreach" || candidate.kind === "research")) {
        await chainNext(userId, params.teamId, candidate.kind);
      }
    } catch (e) {
      await db.update(jobs).set({ status: "failed", finishedAt: new Date(), error: String(e).slice(0, 500) })
        .where(and(eq(jobs.id, candidate.id), eq(jobs.userId, userId)));
    }
  }

  return NextResponse.json({ processed, drafts, briefed });
}
