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
import { createStepLog, STEP_ITEMS_MAX, trunc, type ScrapeStepItem } from "@/lib/scrape/steps";
import { chainNext, agentInfo, podStageFailed } from "@/lib/pod/orchestrate";
import { jobErrorMessage } from "@/lib/jobs/errors";
import { isAIConfigured } from "@/lib/ai/openrouter";
import { AI_JOB_KINDS } from "@/lib/jobs/limits";
import { reapStaleJobs, withDeadline, LEAD_TIMEOUT_MS, RUN_CLAIM_BUDGET_MS, RUN_LEAD_BUDGET_MS } from "@/lib/jobs/runtime";

const RUNNER_KINDS = ["outreach", "research", "qualify", "proposal", "match", "assess"];

export type DrainResult = { processed: number; drafts: number; briefed: number };

/** What a lead step did with one lead, for its row in the chat timeline. */
type LeadOutcome = { meta: string; kind?: "done" | "dropped" };

/** The running label of each lead step: "Reviewing Ana Cruz (1 of 2)". */
const DOING: Record<string, string> = {
  assess: "Reviewing", research: "Researching", qualify: "Scoring", match: "Matching",
  outreach: "Drafting a first email for", proposal: "Writing a proposal for",
};

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/** Claim and run queued jobs, oldest first. `userId` limits it to one user's jobs;
 *  null drains every user's. Stops at `maxJobs`, or when the claim budget runs out. */
export async function drainJobs(opts: { userId: string | null; maxJobs: number }): Promise<DrainResult> {
  const db = getDb();
  const scope = opts.userId;

  // Jobs a killed invocation left 'running' would block their stage for good.
  try {
    // A reaped pod stage would leave the chat on "starting now": say it stopped.
    for (const j of await reapStaleJobs(db, scope)) {
      const p = (j.params ?? {}) as { pod?: boolean; teamId?: string };
      if (p.pod && p.teamId && j.kind !== "scrape") await podStageFailed(j.userId, p.teamId, j.kind, j.agentId, "error");
    }
  } catch (e) { console.error("[jobs] reap failed:", e); }

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
    // The live steps, written into the job row so the chat shows a timeline:
    // the leads picked, each lead as it finishes with its result, then a summary.
    const log = createStepLog(async (steps) => {
      await db.update(jobs).set({ result: { steps } })
        .where(and(eq(jobs.id, candidate.id), eq(jobs.userId, userId), eq(jobs.status, "running")));
    });
    const items: ScrapeStepItem[] = [];
    const listed = () => ({ items: items.slice(0, STEP_ITEMS_MAX), more: Math.max(0, items.length - STEP_ITEMS_MAX) });
    const doing = DOING[candidate.kind] ?? "Working on";
    const eachLead = async <L extends { name: string; company: string }>(batch: L[], label: string, work: (lead: L) => Promise<LeadOutcome>) => {
      log.put({ id: "pick", status: "done", label: batch.length ? `Picked ${plural(batch.length, "lead")}` : "No leads need this step now" });
      for (let k = 0; k < batch.length; k++) {
        if (elapsed() > RUN_LEAD_BUDGET_MS) { skipped += batch.length - k; break; }
        const lead = batch[k];
        const title = trunc(lead.company ? `${lead.name} · ${lead.company}` : lead.name, 70);
        log.put({ id: "work", status: "active", label: `${doing} ${lead.name} (${k + 1} of ${batch.length})`, ...listed() });
        try {
          const o = await withDeadline(work(lead), LEAD_TIMEOUT_MS, label);
          items.push({ title, meta: o.meta, kind: o.kind ?? "done" });
        } catch (e) {
          console.error(`[jobs] ${label} failed:`, e);
          failed++;
          items.push({ title, meta: "Failed", kind: "failed" });
        }
      }
    };
    // Leads left unstarted when time ran out are picked up by the next run.
    const done = async (result: Record<string, number>, summary: string) => {
      const tail = [failed ? `${failed} failed` : "", skipped ? `${skipped} left for the next run` : ""].filter(Boolean);
      log.put({ id: "work", status: "done", label: [summary, ...tail].join(" · "), ...listed() });
      await log.flush();
      await db.update(jobs).set({ status: "done", finishedAt: new Date(), result: { ...result, ...(skipped ? { skipped } : {}), steps: log.all() } })
        .where(and(eq(jobs.id, candidate.id), eq(jobs.userId, userId)));
      finished = true;
    };
    try {
      // The user may have paused or removed the agent after approving the step.
      // Without the AI key, an AI step would only save sample output.
      const stop = !(await agentInfo(userId, candidate.agentId)) ? "paused" : AI_JOB_KINDS.has(candidate.kind) && !isAIConfigured() ? "no-ai" : null;
      if (stop) {
        const error = stop === "paused" ? "The agent is paused or removed, so the run did not start." : "AI isn't set up on this server (OPENROUTER_API_KEY), so the run did not start.";
        await db.update(jobs).set({ status: "failed", finishedAt: new Date(), error })
          .where(and(eq(jobs.id, candidate.id), eq(jobs.userId, userId)));
        if (params.pod && params.teamId) {
          try { await podStageFailed(userId, params.teamId, candidate.kind, candidate.agentId, stop); } catch (e) { console.error("[jobs] notify failed:", e); }
        }
        continue;
      }
      if (candidate.kind === "outreach") {
        const batch = await pickLeadsForRun(userId, params.agent.id, params.leadIds ?? undefined, params.batchSize ?? 5, params.teamId);
        await eachLead(batch, "lead", async (lead) => {
          const products = await searchProducts(userId, [lead.title, lead.company, lead.research?.summary].filter(Boolean).join(" ") || lead.company || lead.name, 3);
          const result = await draftOutreach(params.agent, { name: lead.name, title: lead.title, company: lead.company, email: lead.email, platform: lead.platform, research: lead.research }, products);
          if (!(await applyOutreachResult(userId, params.agent.id, lead, result))) return { meta: "Already had a draft", kind: "dropped" }; // another run drafted it first
          created++;
          drafts++;
          return { meta: "Draft ready" };
        });
        await done({ draftsCreated: created, failed }, `Drafted ${plural(created, "email")}`);
      } else if (candidate.kind === "research") {
        const batch = await pickLeadsForResearch(userId, params.agent.id, params.leadIds ?? undefined, params.batchSize ?? 5, params.teamId);
        await eachLead(batch, "research", async (lead) => {
          const brief = await draftResearch(params.agent, { name: lead.name, title: lead.title, company: lead.company, platform: lead.platform });
          await applyResearchResult(userId, params.agent.id, lead, brief);
          created++;
          briefed++;
          return { meta: "Brief ready" };
        });
        await done({ briefed: created, failed }, `Researched ${plural(created, "lead")}`);
      } else if (candidate.kind === "qualify") {
        const batch = await pickLeadsForQualify(userId, params.agent.id, params.leadIds ?? undefined, params.batchSize ?? 5, params.teamId);
        await eachLead(batch, "qualify", async (lead) => {
          const q = await qualifyLead(params.agent, { name: lead.name, title: lead.title, company: lead.company, email: lead.email, research: lead.research });
          await applyQualifyResult(userId, params.agent.id, lead, q);
          created++;
          return { meta: `Score ${Math.max(1, Math.min(100, Math.round(q.score)))} · ${q.tier}` };
        });
        await done({ qualified: created, failed }, `Scored ${plural(created, "lead")}`);
      } else if (candidate.kind === "proposal") {
        const batch = await pickLeadsForProposal(userId, params.agent.id, params.leadIds ?? undefined, params.batchSize ?? 5, params.teamId);
        await eachLead(batch, "proposal", async (lead) => {
          const products = await searchProducts(userId, [lead.title, lead.company, lead.research?.summary].filter(Boolean).join(" ") || lead.company || lead.name, 5);
          const p = await draftProposal(params.agent, { name: lead.name, title: lead.title, company: lead.company, research: lead.research }, products);
          if (!(await addProposal(userId, params.agent.id, lead.id, p))) return { meta: "Already had one", kind: "dropped" }; // another run wrote it first
          created++;
          return { meta: "Proposal ready" };
        });
        await done({ proposals: created, failed }, `Wrote ${plural(created, "proposal")}`);
      } else if (candidate.kind === "match") {
        const batch = await pickLeadsForMatch(userId, params.agent.id, params.leadIds ?? undefined, params.batchSize ?? 5, params.teamId);
        await eachLead(batch, "match", async (lead) => {
          const listings = await searchProducts(userId, [lead.title, lead.company, lead.research?.summary].filter(Boolean).join(" ") || lead.company || lead.name, 8);
          const m = await matchLead(params.agent, { name: lead.name, title: lead.title, company: lead.company, research: lead.research }, listings);
          if (!m) return { meta: "Not matched yet", kind: "dropped" }; // couldn't run: the lead stays unstamped for a later run
          await addMatches(userId, params.agent.id, lead.id, m);
          if (!m.length) return { meta: "No fit", kind: "dropped" };
          created++; // only leads with at least one match count as matched
          return { meta: plural(m.length, "match", "matches") };
        });
        await done({ matched: created, failed }, `Matched ${created} of ${plural(batch.length, "lead")}`);
      } else if (candidate.kind === "assess") {
        const batch = await pickLeadsForAssess(userId, params.agent.id, params.leadIds ?? undefined, params.batchSize ?? 5, params.teamId);
        let dismissed = 0;
        await eachLead(batch, "assess", async (lead) => {
          const a = await assessLead(params.agent, { name: lead.name, title: lead.title, company: lead.company, research: lead.research });
          await applyAssessResult(userId, params.agent.id, lead, a);
          if (a.accept) created++; else dismissed++; // created = accepted (the count that moves forward)
          return a.accept ? { meta: "Accepted" } : { meta: "Dismissed", kind: "dropped" };
        });
        await done({ assessed: created + dismissed, accepted: created, dismissed, failed }, `Reviewed ${plural(created + dismissed, "lead")} · ${created} accepted · ${dismissed} dismissed`);
      } else {
        await db.update(jobs).set({ status: "failed", finishedAt: new Date(), error: "Unknown job kind: " + candidate.kind })
          .where(and(eq(jobs.id, candidate.id), eq(jobs.userId, userId)));
      }
    } catch (e) {
      // The error column reaches the browser: log the details, store a safe line.
      console.error(`[jobs] ${candidate.kind} job ${candidate.id} failed:`, e);
      await db.update(jobs).set({ status: "failed", finishedAt: new Date(), error: jobErrorMessage(candidate.kind, e) })
        .where(and(eq(jobs.id, candidate.id), eq(jobs.userId, userId)));
      // A pod stage has no chat follower: say so in the team chat.
      if (params.pod && params.teamId) {
        try { await podStageFailed(userId, params.teamId, candidate.kind, candidate.agentId, "error"); } catch (err) { console.error("[jobs] notify failed:", err); }
      }
    }

    // Auto-hand-off: after any pod-chain stage, narrate + enqueue the next stage
    // (or @mention the user at the end). `created` is the stage's forward count.
    // Its own try: a failed hand-off must not turn the finished stage into 'failed'.
    if (finished && params.pod && params.teamId) {
      try { await chainNext(userId, params.teamId, candidate.kind, created, candidate.agentId, undefined, candidate.createdAt, failed); }
      catch (e) { console.error("[jobs] chainNext failed:", e); }
    }
  }

  return { processed, drafts, briefed };
}
