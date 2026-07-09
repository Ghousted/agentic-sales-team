import "server-only";
// Pod orchestration: resolve a team's members/capabilities/approval-modes and
// enqueue or chain pod-stage jobs. Server-only. No engine work here — it wires
// the existing research/outreach jobs into an auto-handed-off pipeline.
import { and, eq, inArray } from "drizzle-orm";
import { getDb, isDbConfigured, agents, agentConfig, jobs } from "@/lib/db";
import { AGENTS_BASE } from "@/lib/data";
import { membersOfTeam } from "@/lib/teams/membership";
import { pickLeadsForResearch, pickLeadsForRun } from "@/lib/leads/store";
import { POD_ORDER, POD_BATCH } from "./types";
import { postTeamMessage, userFirstName } from "@/lib/chat/teamMessages";

interface AgentInfo { id: string; name: string; role: string; goal: string; task: string; capabilities: string[] }

/** Merge the static seed roster + the user's created agents to look one up. */
export async function agentInfo(userId: string, agentId: string): Promise<AgentInfo | null> {
  const seed = AGENTS_BASE.find((a) => a.id === agentId);
  if (seed) return { id: seed.id, name: seed.name, role: seed.role, goal: seed.goal, task: seed.task, capabilities: seed.capabilities };
  if (!isDbConfigured()) return null;
  const [row] = await getDb().select().from(agents).where(and(eq(agents.userId, userId), eq(agents.id, agentId))).limit(1);
  if (!row) return null;
  return { id: row.id, name: row.name, role: row.role, goal: row.goal, task: row.task, capabilities: row.capabilities };
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

/** How many book leads the stage would process now (for the approval count). */
export async function countPending(userId: string, agentId: string, capability: string): Promise<number> {
  const pick = capability === "research" ? pickLeadsForResearch : pickLeadsForRun;
  const rows = await pick(userId, agentId, undefined, POD_BATCH);
  return rows.length;
}

export async function enqueuePodStage(userId: string, teamId: string, capability: string, agentId: string): Promise<void> {
  // Don't stack duplicates: skip if this team already has an active job for this capability.
  const active = await getDb().select().from(jobs)
    .where(and(eq(jobs.userId, userId), eq(jobs.kind, capability), inArray(jobs.status, ["queued", "running", "needs_approval"])));
  if (active.some((j) => (j.params as { teamId?: string })?.teamId === teamId)) return;
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

  const doing = capability === "research" ? "researching the book" : "drafting outreach";
  const verb = capability === "research" ? "research these leads" : "draft outreach";
  if (mode === "ask") {
    const first = await userFirstName(userId);
    await postTeamMessage(userId, teamId, info.id, `@${first} — ${leadCount} lead${leadCount === 1 ? "" : "s"} ${leadCount === 1 ? "is" : "are"} ready to ${verb}. Approve and I'll begin. ⟦approve:${row.id}⟧`);
  } else {
    await postTeamMessage(userId, teamId, info.id, `Understood. I'm ${doing} now.`);
  }
}

/** The first pod stage the team can cover + the member responsible. */
export async function firstStage(userId: string, teamId: string): Promise<{ capability: string; agentId: string } | null> {
  for (const cap of POD_ORDER) {
    const agentId = await memberWithCapability(userId, teamId, cap);
    if (agentId) return { capability: cap, agentId };
  }
  return null;
}

export function nextStageAfter(capability: string): string | null {
  const i = (POD_ORDER as readonly string[]).indexOf(capability);
  return i >= 0 && i + 1 < POD_ORDER.length ? POD_ORDER[i + 1] : null;
}

/** After a pod stage completes, enqueue the next stage for the right team agent. */
export async function chainNext(userId: string, teamId: string, completedKind: string): Promise<void> {
  const nextCap = nextStageAfter(completedKind);
  if (!nextCap) return;
  const agentId = await memberWithCapability(userId, teamId, nextCap);
  if (!agentId) return;
  // Narrate the hand-off from the finishing agent to the next.
  const finisherId = await memberWithCapability(userId, teamId, completedKind);
  const [finisher, nextInfo] = await Promise.all([
    finisherId ? agentInfo(userId, finisherId) : Promise.resolve(null),
    agentInfo(userId, agentId),
  ]);
  if (finisher && nextInfo) {
    const done = completedKind === "research" ? "researching the book" : "drafting outreach";
    const nextNoun = nextCap === "research" ? "research" : "outreach";
    await postTeamMessage(userId, teamId, finisher.id, `I've finished ${done}. @${nextInfo.name.split(" ")[0]} — the ${nextNoun} is yours from here.`);
  }
  await enqueuePodStage(userId, teamId, nextCap, agentId);
}
