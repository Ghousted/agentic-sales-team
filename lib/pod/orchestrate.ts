import "server-only";
// Pod orchestration: resolve a team's members/capabilities/approval-modes and
// enqueue or chain pod-stage jobs. Server-only. No engine work here. It wires
// the existing capability jobs into an auto-handed-off pipeline.
import { and, eq, inArray } from "drizzle-orm";
import { getDb, isDbConfigured, agents, agentConfig, agentStates, jobs } from "@/lib/db";
import { AGENTS_BASE } from "@/lib/data";
import { membersOfTeam } from "@/lib/teams/membership";
import { pickLeadsForResearch, pickLeadsForRun, pickLeadsForQualify, pickLeadsForAssess } from "@/lib/leads/store";
import { pickLeadsForMatch } from "@/lib/matches/store";
import { pickLeadsForProposal } from "@/lib/proposals/store";
import { POD_ORDER, POD_BATCH } from "./types";
import { postTeamMessage, userFirstName } from "@/lib/chat/teamMessages";
import { leadsMarker } from "@/lib/chat/thread";
import { isStale } from "@/lib/jobs/runtime";

interface AgentInfo { id: string; name: string; role: string; goal: string; task: string; capabilities: string[] }

// Per-stage phrasing for the hand-off narration.
const DOING: Record<string, string> = { scrape: "finding leads", assess: "reviewing the new leads", research: "researching the book", qualify: "qualifying the leads", match: "matching leads to listings", outreach: "drafting outreach", proposal: "drafting proposals" };
const VERB: Record<string, string> = { assess: "review these leads", research: "research these leads", qualify: "qualify the leads", match: "match these leads", outreach: "draft outreach", proposal: "draft proposals" };
const NOUN: Record<string, string> = { assess: "the review", research: "research", qualify: "qualification", match: "matching", outreach: "outreach", proposal: "proposals" };
// What the finisher says when its stage moved no leads forward.
const NOTHING: Record<string, string> = {
  scrape: "I found no new leads for that search. Try again with more detail, for example the industry, the company size or the location.",
  assess: "I reviewed the new leads, but none of them were a good fit.",
  research: "I had no leads to research.",
  qualify: "I had no leads to qualify.",
  match: "I found no listings that match these leads.",
  outreach: "I had no leads to write to.",
  proposal: "I had no leads that need a proposal.",
};
function donePhrase(cap: string, n: number): string {
  const s = n === 1 ? "" : "s";
  switch (cap) {
    case "scrape": return `found ${n} lead${s}`;
    case "assess": return `accepted ${n} lead${s}`;
    case "research": return `researched ${n} lead${s}`;
    case "qualify": return `qualified ${n} lead${s}`;
    case "match": return `matched ${n} lead${s} to listings`;
    case "outreach": return `drafted ${n} email${s}`;
    case "proposal": return `drafted ${n} proposal${s}`;
    default: return "finished";
  }
}
function finalAction(cap: string): string {
  switch (cap) {
    case "outreach": return "the drafts are ready for you to review and send";
    case "proposal": return "the proposals are ready for you to review and send";
    case "match": return "I've matched them to your catalog";
    case "assess": return "they're in your book now";
    default: return "it's over to you";
  }
}

/** The agent as this user has it now: the static seed roster or the user's
 *  created agents, with the user's role/goal edits applied. Null when the agent
 *  is unknown, removed or paused, so it gets no chat routing and no pod stages. */
export async function agentInfo(userId: string, agentId: string): Promise<AgentInfo | null> {
  const seed = AGENTS_BASE.find((a) => a.id === agentId);
  if (!isDbConfigured()) return seed ? { id: seed.id, name: seed.name, role: seed.role, goal: seed.goal, task: seed.task, capabilities: seed.capabilities } : null;
  const db = getDb();
  const [created, [state], [cfg]] = await Promise.all([
    seed ? Promise.resolve([]) : db.select().from(agents).where(and(eq(agents.userId, userId), eq(agents.id, agentId))).limit(1),
    db.select().from(agentStates).where(and(eq(agentStates.userId, userId), eq(agentStates.agentId, agentId))).limit(1),
    db.select().from(agentConfig).where(and(eq(agentConfig.userId, userId), eq(agentConfig.agentId, agentId))).limit(1),
  ]);
  const base = seed ?? created[0];
  if (!base || state?.removed || state?.paused) return null;
  return { id: base.id, name: base.name, role: cfg?.role ?? base.role, goal: cfg?.goal ?? base.goal, task: base.task, capabilities: base.capabilities };
}

export async function memberWithCapability(userId: string, teamId: string, capability: string): Promise<string | null> {
  const members = await membersOfTeam(userId, teamId);
  for (const id of members) {
    const info = await agentInfo(userId, id);
    if (info?.capabilities.includes(capability)) return id;
  }
  return null;
}

export async function approvalMode(userId: string, agentId: string, capability: string): Promise<"auto" | "ask"> {
  if (!isDbConfigured()) return "auto";
  const [row] = await getDb().select().from(agentConfig).where(and(eq(agentConfig.userId, userId), eq(agentConfig.agentId, agentId))).limit(1);
  const settings = row?.settings as Record<string, { mode?: string }> | null | undefined;
  return settings?.[capability]?.mode === "ask" ? "ask" : "auto";
}

/** How many book/pending leads the stage would process now (for the approval count). */
export async function countPending(userId: string, agentId: string, capability: string): Promise<number> {
  const pick = capability === "research" ? pickLeadsForResearch
    : capability === "assess" ? pickLeadsForAssess
    : capability === "qualify" ? pickLeadsForQualify
    : capability === "match" ? pickLeadsForMatch
    : capability === "proposal" ? pickLeadsForProposal
    : pickLeadsForRun; // outreach
  const rows = await pick(userId, agentId, undefined, POD_BATCH);
  return rows.length;
}

export async function enqueuePodStage(userId: string, teamId: string, capability: string, agentId: string): Promise<void> {
  // Don't stack duplicates: skip if this team already has an active job for this capability.
  // A 'running' job past its time limit is dead (the runner reaps it), so it doesn't count.
  const now = new Date();
  const active = await getDb().select().from(jobs)
    .where(and(eq(jobs.userId, userId), eq(jobs.kind, capability), inArray(jobs.status, ["queued", "running", "needs_approval"])));
  if (active.some((j) => !isStale(j, now) && (j.params as { teamId?: string })?.teamId === teamId)) return;
  const info = await agentInfo(userId, agentId);
  if (!info) return;
  const mode = await approvalMode(userId, agentId, capability);
  const leadCount = await countPending(userId, agentId, capability);
  const [row] = await getDb().insert(jobs).values({
    userId, agentId, kind: capability,
    status: mode === "ask" ? "needs_approval" : "queued",
    params: {
      agent: { id: info.id, name: info.name, role: info.role, goal: info.goal, task: info.task },
      teamId, pod: true, leadCount, batchSize: POD_BATCH, leadIds: null,
    },
  }).returning({ id: jobs.id });

  if (mode === "ask") {
    const first = await userFirstName(userId);
    await postTeamMessage(userId, teamId, info.id, `@${first}, ${leadCount} lead${leadCount === 1 ? "" : "s"} ready to ${VERB[capability] ?? capability}. Approve and I'll begin. ⟦approve:${row.id}⟧`);
  } else {
    await postTeamMessage(userId, teamId, info.id, `Understood. I'm ${DOING[capability] ?? capability} now.`);
  }
}

/** The next book stage after `completedKind` that this team can cover. Skips
 *  scrape (entry) and assess (only reachable right after scrape). */
export async function nextCoverableStage(userId: string, teamId: string, completedKind: string): Promise<{ capability: string; agentId: string } | null> {
  const i = (POD_ORDER as readonly string[]).indexOf(completedKind);
  if (i < 0) return null;
  for (let j = i + 1; j < POD_ORDER.length; j++) {
    const cap = POD_ORDER[j];
    if (cap === "scrape" || cap === "assess") continue;
    const agentId = await memberWithCapability(userId, teamId, cap);
    if (agentId) return { capability: cap, agentId };
  }
  return null;
}

/** After a pod stage completes, narrate the hand-off and enqueue the next stage.
 *  or, at the end of the chain, @mention the user for the final action. */
export async function chainNext(userId: string, teamId: string, completedKind: string, count = 0, ranBy?: string, leadIds?: string[]): Promise<void> {
  // ranBy is the agent that ran the job. It can be an agent from another team (a
  // cross-team hand-off), so do not look for it among this team's members only.
  const finisherId = ranBy ?? await memberWithCapability(userId, teamId, completedKind);
  const finisher = finisherId ? await agentInfo(userId, finisherId) : null;
  if (!finisher) return;
  const first = (info: AgentInfo) => info.name.split(" ")[0];

  // A stage that moved no leads forward ends the chain. The next stage has no
  // new work, so tell the user instead of running each later stage on 0 leads.
  if (count <= 0) {
    const userName = await userFirstName(userId);
    await postTeamMessage(userId, teamId, finisher.id, `@${userName}, ${NOTHING[completedKind] ?? "I had no leads to pass on."} I stopped the chain here.`);
    return;
  }

  // Scrape → the assessor gate (the only stage that turns pending into accepted).
  if (completedKind === "scrape") {
    const assessorId = await memberWithCapability(userId, teamId, "assess");
    if (assessorId) {
      const info = await agentInfo(userId, assessorId);
      if (info) {
        await postTeamMessage(userId, teamId, finisher.id, `I found ${count} new lead${count === 1 ? "" : "s"}. @${first(info)}, please review them.${leadsMarker(leadIds)}`);
        await enqueuePodStage(userId, teamId, "assess", assessorId);
      }
    } else {
      const userName = await userFirstName(userId);
      await postTeamMessage(userId, teamId, finisher.id, `I've ${donePhrase("scrape", count)}. @${userName}, they are ready for you to review and accept.${leadsMarker(leadIds)}`);
    }
    return;
  }

  const next = await nextCoverableStage(userId, teamId, completedKind);
  if (next) {
    const info = await agentInfo(userId, next.agentId);
    if (info) {
      await postTeamMessage(userId, teamId, finisher.id, `I've ${donePhrase(completedKind, count)}. @${first(info)}, please do the ${NOUN[next.capability] ?? next.capability}.`);
      await enqueuePodStage(userId, teamId, next.capability, next.agentId);
    }
  } else {
    const userName = await userFirstName(userId);
    await postTeamMessage(userId, teamId, finisher.id, `I've ${donePhrase(completedKind, count)}. @${userName}, ${finalAction(completedKind)}.`);
  }
}
