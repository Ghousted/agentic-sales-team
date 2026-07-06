"use server";
// Persistence for a user's workspace: created agents, created teams, and
// per-agent removed/paused flags. The 8 seed agents / 4 seed teams stay static;
// only a user's own changes are stored (and merged client-side on load).
import { eq } from "drizzle-orm";
import { getDb, isDbConfigured, agents, teams, agentStates } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import type { Agent, Team, StatusKey } from "@/lib/types";

export interface WorkspaceData {
  extraAgents: Agent[];
  extraTeams: Team[];
  removed: string[];
  paused: string[];
}

async function uid(): Promise<string | null> {
  const s = await getSession();
  return s?.userId ?? null;
}

/** Load the signed-in user's persisted workspace (for hydrating the store). */
export async function loadWorkspace(): Promise<WorkspaceData> {
  const empty: WorkspaceData = { extraAgents: [], extraTeams: [], removed: [], paused: [] };
  if (!isDbConfigured()) return empty;
  const userId = await uid();
  if (!userId) return empty;
  const db = getDb();

  const [agentRows, teamRows, stateRows] = await Promise.all([
    db.select().from(agents).where(eq(agents.userId, userId)),
    db.select().from(teams).where(eq(teams.userId, userId)),
    db.select().from(agentStates).where(eq(agentStates.userId, userId)),
  ]);

  return {
    extraAgents: agentRows.map((r) => ({
      id: r.id, name: r.name, initials: r.initials, role: r.role, color: r.color,
      status: r.status as StatusKey, task: r.task, score: r.score, goal: r.goal,
      char: r.char ?? undefined,
    })),
    extraTeams: teamRows.map((r) => ({
      id: r.id, name: r.name, icon: r.icon, iconBg: r.iconBg, desc: r.description,
      goal: r.goal, members: r.members, activity: r.activity,
      meetings: r.meetings, pipeline: r.pipeline, leads: r.leads,
    })),
    removed: stateRows.filter((r) => r.removed).map((r) => r.agentId),
    paused: stateRows.filter((r) => r.paused).map((r) => r.agentId),
  };
}

/** Persist a newly created agent. */
export async function saveAgent(agent: Agent): Promise<void> {
  if (!isDbConfigured()) return;
  const userId = await uid();
  if (!userId) return;
  await getDb().insert(agents).values({
    userId, id: agent.id, name: agent.name, initials: agent.initials, role: agent.role,
    color: agent.color, status: agent.status, task: agent.task, score: agent.score,
    goal: agent.goal, char: agent.char ?? null,
  });
}

/** Persist a newly created team. */
export async function saveTeam(team: Team): Promise<void> {
  if (!isDbConfigured()) return;
  const userId = await uid();
  if (!userId) return;
  await getDb().insert(teams).values({
    userId, id: team.id, name: team.name, icon: team.icon, iconBg: team.iconBg,
    description: team.desc, goal: team.goal, members: team.members, activity: team.activity,
    meetings: team.meetings, pipeline: team.pipeline, leads: team.leads,
  });
}

/** Set the soft-delete flag for an agent (seed or created). */
export async function setAgentRemoved(agentId: string, removed: boolean): Promise<void> {
  if (!isDbConfigured()) return;
  const userId = await uid();
  if (!userId) return;
  await getDb()
    .insert(agentStates)
    .values({ userId, agentId, removed })
    .onConflictDoUpdate({ target: [agentStates.userId, agentStates.agentId], set: { removed } });
}

/** Set the paused flag for an agent (seed or created). */
export async function setAgentPaused(agentId: string, paused: boolean): Promise<void> {
  if (!isDbConfigured()) return;
  const userId = await uid();
  if (!userId) return;
  await getDb()
    .insert(agentStates)
    .values({ userId, agentId, paused })
    .onConflictDoUpdate({ target: [agentStates.userId, agentStates.agentId], set: { paused } });
}
