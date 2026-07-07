import "server-only";
// Team membership resolution: which agents share a team with a given agent, for
// this user. Teams = static TEAMS_BASE seeds + the user's created `teams` rows;
// effective membership = the `team_members` override if present, else the team's
// base members. Used to expand a capability's lead pool to the shared team book.
import { and, eq } from "drizzle-orm";
import { getDb, isDbConfigured, teams as teamsTable, teamMembers } from "@/lib/db";
import { TEAMS_BASE } from "@/lib/data";

export async function teammatesOf(userId: string, agentId: string): Promise<string[]> {
  if (!isDbConfigured()) return [agentId];
  const db = getDb();
  const [userTeams, overrides] = await Promise.all([
    db.select().from(teamsTable).where(eq(teamsTable.userId, userId)),
    db.select().from(teamMembers).where(eq(teamMembers.userId, userId)),
  ]);
  const overrideMap = new Map(overrides.map((o) => [o.teamId, o.members]));
  const allTeams: { id: string; members: string[] }[] = [
    ...TEAMS_BASE.map((t) => ({ id: t.id, members: t.members })),
    ...userTeams.map((t) => ({ id: t.id, members: t.members })),
  ];
  const mates = new Set<string>([agentId]);
  for (const t of allTeams) {
    const members = overrideMap.get(t.id) ?? t.members;
    if (members.includes(agentId)) for (const m of members) mates.add(m);
  }
  return Array.from(mates);
}

/** The agent ids on a team (team_members override, else base members). */
export async function membersOfTeam(userId: string, teamId: string): Promise<string[]> {
  if (!isDbConfigured()) return TEAMS_BASE.find((t) => t.id === teamId)?.members ?? [];
  const db = getDb();
  const [override] = await db.select().from(teamMembers)
    .where(and(eq(teamMembers.userId, userId), eq(teamMembers.teamId, teamId))).limit(1);
  if (override) return override.members;
  const seed = TEAMS_BASE.find((t) => t.id === teamId);
  if (seed) return seed.members;
  const [userTeam] = await db.select().from(teamsTable)
    .where(and(eq(teamsTable.userId, userId), eq(teamsTable.id, teamId))).limit(1);
  return userTeam?.members ?? [];
}
