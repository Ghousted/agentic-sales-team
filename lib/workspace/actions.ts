"use server";
// Persistence for a user's workspace: created agents, created teams, and
// per-agent removed/paused flags. The 8 seed agents / 4 seed teams stay static;
// only a user's own changes are stored (and merged client-side on load).
import { and, eq, asc } from "drizzle-orm";
import { getDb, isDbConfigured, agents, teams, agentStates, messages, agentConfig, teamMembers } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import type { Agent, Team, StatusKey, ChatMsg, Chats } from "@/lib/types";
import type { ThreadMsg } from "@/lib/chat/thread";

export interface AgentConfig {
  role?: string;
  goal?: string;
  permissions?: Record<string, boolean>;
  settings?: Record<string, Record<string, unknown>>;
}

export interface WorkspaceData {
  extraAgents: Agent[];
  extraTeams: Team[];
  removed: string[];
  paused: string[];
  chats: Chats;
  config: Record<string, AgentConfig>;
  teamMembers: Record<string, string[]>;
}

async function uid(): Promise<string | null> {
  const s = await getSession();
  return s?.userId ?? null;
}

/** Load the signed-in user's persisted workspace (for hydrating the store).
 *  Runs during the root layout's SSR, so it must never throw: on any DB/session
 *  failure it logs and falls back to an empty workspace, letting the dashboard
 *  render (empty) instead of crashing the whole app. */
export async function loadWorkspace(): Promise<WorkspaceData> {
  const empty: WorkspaceData = { extraAgents: [], extraTeams: [], removed: [], paused: [], chats: {}, config: {}, teamMembers: {} };
  if (!isDbConfigured()) return empty;
  try {
    const userId = await uid();
    if (!userId) return empty;
    const db = getDb();

    const [agentRows, teamRows, stateRows, msgRows, configRows, memberRows] = await Promise.all([
      db.select().from(agents).where(eq(agents.userId, userId)),
      db.select().from(teams).where(eq(teams.userId, userId)),
      db.select().from(agentStates).where(eq(agentStates.userId, userId)),
      db.select({ id: messages.id, agentId: messages.agentId, who: messages.who, text: messages.text })
        .from(messages).where(eq(messages.userId, userId)).orderBy(asc(messages.id)),
      db.select().from(agentConfig).where(eq(agentConfig.userId, userId)),
      db.select().from(teamMembers).where(eq(teamMembers.userId, userId)),
    ]);

    // Group persisted messages by agent, preserving insertion order. The id is
    // the team chat's poll cursor (lib/chat/thread).
    const chats: Chats = {};
    for (const m of msgRows) {
      const msg: ThreadMsg = { id: m.id, who: m.who as ChatMsg["who"], text: m.text };
      (chats[m.agentId] ??= []).push(msg);
    }

    const config: Record<string, AgentConfig> = {};
    for (const c of configRows) {
      config[c.agentId] = {
        role: c.role ?? undefined,
        goal: c.goal ?? undefined,
        permissions: c.permissions ?? undefined,
        settings: c.settings ?? undefined,
      };
    }

    const teamMembersMap: Record<string, string[]> = {};
    for (const m of memberRows) teamMembersMap[m.teamId] = m.members;

    return {
      chats,
      config,
      teamMembers: teamMembersMap,
      extraAgents: agentRows.map((r) => ({
        id: r.id, name: r.name, initials: r.initials, role: r.role, color: r.color,
        status: r.status as StatusKey, task: r.task, score: r.score, goal: r.goal,
        char: r.char ?? undefined, type: r.type, capabilities: r.capabilities,
      })),
      extraTeams: teamRows.map((r) => ({
        id: r.id, name: r.name, icon: r.icon, iconBg: r.iconBg, desc: r.description,
        goal: r.goal, members: r.members, activity: r.activity,
        meetings: r.meetings, pipeline: r.pipeline, leads: r.leads, template: r.template,
      })),
      removed: stateRows.filter((r) => r.removed).map((r) => r.agentId),
      paused: stateRows.filter((r) => r.paused).map((r) => r.agentId),
    };
  } catch (e) {
    console.error("[loadWorkspace] load failed; falling back to empty workspace:", e);
    return empty;
  }
}

/** Persist a newly created agent. Throws when it can't be stored (signed out,
 *  DB error), so the client never shows an agent the server doesn't have. */
export async function saveAgent(agent: Agent): Promise<void> {
  if (!isDbConfigured()) return;
  const userId = await uid();
  if (!userId) throw new Error("Not signed in.");
  await getDb().insert(agents).values({
    userId, id: agent.id, name: agent.name, initials: agent.initials, role: agent.role,
    color: agent.color, status: agent.status, task: agent.task, score: agent.score,
    goal: agent.goal, char: agent.char ?? null,
    type: agent.type, capabilities: agent.capabilities,
  });
}

/** Persist a newly created team. Throws when it can't be stored, like saveAgent. */
export async function saveTeam(team: Team): Promise<void> {
  if (!isDbConfigured()) return;
  const userId = await uid();
  if (!userId) throw new Error("Not signed in.");
  await getDb().insert(teams).values({
    userId, id: team.id, name: team.name, icon: team.icon, iconBg: team.iconBg,
    description: team.desc, goal: team.goal, members: team.members, activity: team.activity,
    meetings: team.meetings, pipeline: team.pipeline, leads: team.leads,
    template: team.template,
  });
}

/** Update a team's editable meta (name, icon, goal). Partial: only the provided
 *  fields are written, so an icon-only edit leaves name/goal untouched. */
export async function saveTeamMeta(
  teamId: string,
  patch: { name?: string; icon?: string; iconBg?: string; desc?: string; goal?: string },
): Promise<void> {
  if (!isDbConfigured()) return;
  const userId = await uid();
  if (!userId) return;
  const set: Record<string, string> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.icon !== undefined) set.icon = patch.icon;
  if (patch.iconBg !== undefined) set.iconBg = patch.iconBg;
  if (patch.desc !== undefined) set.description = patch.desc;
  if (patch.goal !== undefined) set.goal = patch.goal;
  if (Object.keys(set).length === 0) return;
  await getDb().update(teams).set(set).where(and(eq(teams.userId, userId), eq(teams.id, teamId)));
}

/** Delete a user-created team (and its member override). Seed teams have no row,
 * so this is a no-op for them — the UI only offers delete on created teams. */
export async function deleteTeam(teamId: string): Promise<void> {
  if (!isDbConfigured()) return;
  const userId = await uid();
  if (!userId) return;
  const db = getDb();
  await db.delete(teams).where(and(eq(teams.userId, userId), eq(teams.id, teamId)));
  await db.delete(teamMembers).where(and(eq(teamMembers.userId, userId), eq(teamMembers.teamId, teamId)));
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

/** Save a team's full member list (override for seed or created teams). */
export async function saveTeamMembers(teamId: string, members: string[]): Promise<void> {
  if (!isDbConfigured()) return;
  const userId = await uid();
  if (!userId) return;
  await getDb()
    .insert(teamMembers)
    .values({ userId, teamId, members })
    .onConflictDoUpdate({ target: [teamMembers.userId, teamMembers.teamId], set: { members } });
}

/** Save per-agent config overrides (role, goal, permissions, settings). Partial:
 *  only the provided fields are overwritten on conflict, so a settings-only save
 *  doesn't wipe role/goal/permissions (and vice versa). */
export async function saveAgentConfig(agentId: string, cfg: AgentConfig): Promise<void> {
  if (!isDbConfigured()) return;
  const userId = await uid();
  if (!userId) return;
  const set: Record<string, unknown> = {};
  if (cfg.role !== undefined) set.role = cfg.role;
  if (cfg.goal !== undefined) set.goal = cfg.goal;
  if (cfg.permissions !== undefined) set.permissions = cfg.permissions;
  if (cfg.settings !== undefined) set.settings = cfg.settings;
  await getDb()
    .insert(agentConfig)
    .values({ userId, agentId, role: cfg.role ?? null, goal: cfg.goal ?? null, permissions: cfg.permissions ?? null, settings: cfg.settings ?? null })
    .onConflictDoUpdate({ target: [agentConfig.userId, agentConfig.agentId], set });
}

/** Append the user's own chat turns for a conversation, in order. Only "me"
 *  rows are accepted: agent and system rows are written by the server (teamChat,
 *  the pod chain), so a client can't put words — or ⟦…⟧ markers — in an agent's
 *  mouth. */
export async function appendMessages(agentId: string, msgs: ChatMsg[]): Promise<void> {
  const mine = msgs.filter((m) => m.who === "me");
  if (!isDbConfigured() || mine.length === 0) return;
  const userId = await uid();
  if (!userId) return;
  await getDb().insert(messages).values(mine.map((m) => ({ userId, agentId, who: "me", text: m.text })));
}

/** Permanently delete one conversation's messages (a team thread or an agent
 *  chat, keyed by convId). Session-scoped, so it only touches the user's own.
 *  Returns the highest id deleted (0 if none) so the chat poll can move its
 *  cursor past them and never show them again. */
export async function clearMessages(convId: string): Promise<number> {
  if (!isDbConfigured()) return 0;
  const userId = await uid();
  if (!userId) return 0;
  const gone = await getDb().delete(messages).where(and(eq(messages.userId, userId), eq(messages.agentId, convId))).returning({ id: messages.id });
  return gone.reduce((max, r) => Math.max(max, r.id), 0);
}
