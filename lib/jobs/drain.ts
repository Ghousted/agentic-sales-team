// Runs queued AI-stage jobs (outreach, research, qualify, proposal, match, assess).
// Shared by POST /api/jobs/run (one user's jobs, kicked by the browser as a fast
// path) and GET /api/cron/jobs (every user's jobs, every minute from Vercel Cron),
// so jobs finish even when no tab is open. Scrape jobs run in lib/jobs/scrape instead.
import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb, jobs } from "@/lib/db";
import { pickLeadsForRun, applyOutreachResult, pickLeadsForResearch, applyResearchResult, pickLeadsForQualify, applyQualifyResult, pickLeadsForAssess, applyAssessResult } from "@/lib/leads/store";
import { assessLead } from "@/lib/ai/assess";
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
import { reapStaleJobs, withDeadline, LEAD_TIMEOUT_MS, RUN_CLAIM_BUDGET_MS, RUN_LEAD_BUDGET_MS } from "@/lib/jobs/runtime";

const RUNNER_KINDS = ["outreach", "research", "qualify", "proposal", "match", "assess"];

export type DrainResult = { processed: number; drafts: number; briefed: number };

/** Claim and run queued jobs, oldest first. `userId` limits it to one user's jobs;
 *  null drains every user's. Stops at `maxJobs`, or when the claim budget runs out. */
export async function drainJobs(opts: { userId: string | null; maxJobs: number }): Promise<DrainResult> {
  const db = getDb();
  const scope = opts.userId;

  // Jobs a killed invocation left 'running' would block their stage for good.
  try { await reapStaleJobs(db, scope); } catch (e) { console.error("[jobs] reap failed:", e); }

  // Stay inside maxDuration: stop claiming jobs, then stop starting leads, while
  // there is still time to save the result. Unstarted leads stay for the next run.
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;

  let processed = 0;
  let drafts = 0;
  let briefed = 0;

  for (let i = 0; i < opts.maxJobs; i++) {
    if (i > 0 && elapsed() > RUN_CLAIM_BUDGET_MS) break;
    const queued = and(eq(jobs.status, "queued"), inArray(jobs.kind, RUNNER_KINDS));
    const [candidate] = await db.select().from(jobs)
      .where(scope ? and(eq(jobs.userId, scope), queued) : queued).orderBy(asc(jobs.createdAt)).limit(1);
    if (!candidate) break;
    const userId = candidate.userId;

    // Atomic claim: the status='queued' guard means two runners (the cron and a
    // browser kick, or two overlapping cron ticks) can't both grab it.
    const claimed = await db.update(jobs).set({ status: "running", startedAt: new Date() })
      .where(and(eq(jobs.id, candidate.id), eq(jobs.userId, userId), eq(jobs.status, "queued"))).returning({ id: jobs.id });
    if (!claimed.length) continue;
    processed++;

    const params = candidate.params as { agent: AgentSnapshot; leadIds: string[] | null; batchSize: number; pod?: boolean; teamId?: string };
    let created = 0;
    let failed = 0;
    let skipped = 0;
    let finished = false;
    const eachLead = async <L,>(batch: L[], label: string, work: (lead: L) => Promise<void>) => {
      for (let k = 0; k < batch.length; k++) {
        if (elapsed() > RUN_LEAD_BUDGET_MS) { skipped += batch.length - k; break; }
        try { await withDeadline(work(batch[k]), LEAD_TIMEOUT_MS, label); }
        catch (e) { console.error(`[jobs] ${label} failed:`, e); failed++; }
      }
    };
    // Leads left unstarted when time ran out are picked up by the next run.
    const done = async (result: Record<string, number>) => {
      await db.update(jobs).set({ status: "done", finishedAt: new Date(), result: skipped ? { ...result, skipped } : result })
        .where(and(eq(jobs.id, candidate.id), eq(jobs.userId, userId)));
      finished = true;
    };
    try {
      if (candidate.kind === "outreach") {
        const batch = await pickLeadsForRun(userId, params.agent.id, params.leadIds ?? undefined, params.batchSize ?? 5);
        await eachLead(batch, "lead", async (lead) => {
          const products = await searchProducts(userId, [lead.title, lead.company, lead.research?.summary].filter(Boolean).join(" ") || lead.company || lead.name, 3);
          const result = await draftOutreach(params.agent, { name: lead.name, title: lead.title, company: lead.company, email: lead.email, platform: lead.platform, research: lead.research }, products);
          if (!(await applyOutreachResult(userId, params.agent.id, lead, result))) return; // another run drafted it first
          created++;
          drafts++;
        });
        await done({ draftsCreated: created, failed });
      } else if (candidate.kind === "research") {
        const batch = await pickLeadsForResearch(userId, params.agent.id, params.leadIds ?? undefined, params.batchSize ?? 5);
        await eachLead(batch, "research", async (lead) => {
          const brief = await draftResearch(params.agent, { name: lead.name, title: lead.title, company: lead.company, platform: lead.platform });
          await applyResearchResult(userId, params.agent.id, lead, brief);
          created++;
          briefed++;
        });
        await done({ briefed: created, failed });
      } else if (candidate.kind === "qualify") {
        const batch = await pickLeadsForQualify(userId, params.agent.id, params.leadIds ?? undefined, params.batchSize ?? 5);
        await eachLead(batch, "qualify", async (lead) => {
          const q = await qualifyLead(params.agent, { name: lead.name, title: lead.title, company: lead.company, email: lead.email, research: lead.research });
          await applyQualifyResult(userId, params.agent.id, lead, q);
          created++;
        });
        await done({ qualified: created, failed });
      } else if (candidate.kind === "proposal") {
        const batch = await pickLeadsForProposal(userId, params.agent.id, params.leadIds ?? undefined, params.batchSize ?? 5);
        await eachLead(batch, "proposal", async (lead) => {
          const products = await searchProducts(userId, [lead.title, lead.company, lead.research?.summary].filter(Boolean).join(" ") || lead.company || lead.name, 5);
          const p = await draftProposal(params.agent, { name: lead.name, title: lead.title, company: lead.company, research: lead.research }, products);
          if (!(await addProposal(userId, params.agent.id, lead.id, p))) return; // another run wrote it first
          created++;
        });
        await done({ proposals: created, failed });
      } else if (candidate.kind === "match") {
        const batch = await pickLeadsForMatch(userId, params.agent.id, params.leadIds ?? undefined, params.batchSize ?? 5);
        await eachLead(batch, "match", async (lead) => {
          const listings = await searchProducts(userId, [lead.title, lead.company, lead.research?.summary].filter(Boolean).join(" ") || lead.company || lead.name, 8);
          const m = await matchLead(params.agent, { name: lead.name, title: lead.title, company: lead.company, research: lead.research }, listings);
          if (!m) return; // couldn't run: the lead stays unstamped for a later run
          await addMatches(userId, params.agent.id, lead.id, m);
          if (m.length) created++; // only leads with at least one match count as matched
        });
        await done({ matched: created, failed });
      } else if (candidate.kind === "assess") {
        const batch = await pickLeadsForAssess(userId, params.agent.id, params.leadIds ?? undefined, params.batchSize ?? 5);
        let dismissed = 0;
        await eachLead(batch, "assess", async (lead) => {
          const a = await assessLead(params.agent, { name: lead.name, title: lead.title, company: lead.company, research: lead.research });
          await applyAssessResult(userId, params.agent.id, lead, a);
          if (a.accept) created++; else dismissed++; // created = accepted (the count that moves forward)
        });
        await done({ assessed: created + dismissed, accepted: created, dismissed, failed });
      } else {
        await db.update(jobs).set({ status: "failed", finishedAt: new Date(), error: "Unknown job kind: " + candidate.kind })
          .where(and(eq(jobs.id, candidate.id), eq(jobs.userId, userId)));
      }
    } catch (e) {
      await db.update(jobs).set({ status: "failed", finishedAt: new Date(), error: String(e).slice(0, 500) })
        .where(and(eq(jobs.id, candidate.id), eq(jobs.userId, userId)));
    }

    // Auto-hand-off: after any pod-chain stage, narrate + enqueue the next stage
    // (or @mention the user at the end). `created` is the stage's forward count.
    // Its own try: a failed hand-off must not turn the finished stage into 'failed'.
    if (finished && params.pod && params.teamId) {
      try { await chainNext(userId, params.teamId, candidate.kind, created, candidate.agentId); }
      catch (e) { console.error("[jobs] chainNext failed:", e); }
    }
  }

  return { processed, drafts, briefed };
}
