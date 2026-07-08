import "server-only";
// Read/write for a team group-chat thread (messages keyed by teamId) + the user's
// display name for @mentions. Used by the pod orchestration to narrate its work.
import { and, asc, eq } from "drizzle-orm";
import { getDb, isDbConfigured, messages, users } from "@/lib/db";

/** Post a message into a team's chat thread, spoken by an agent (or "system"). */
export async function postTeamMessage(userId: string, teamId: string, speakerAgentId: string, text: string): Promise<void> {
  if (!isDbConfigured()) return;
  await getDb().insert(messages).values({ userId, agentId: teamId, who: speakerAgentId, text });
}

/** The full team thread, oldest first. */
export async function listTeamMessages(userId: string, teamId: string): Promise<{ who: string; text: string }[]> {
  if (!isDbConfigured()) return [];
  const rows = await getDb().select({ who: messages.who, text: messages.text })
    .from(messages).where(and(eq(messages.userId, userId), eq(messages.agentId, teamId))).orderBy(asc(messages.id));
  return rows.map((r) => ({ who: r.who, text: r.text }));
}

/** The user's first name, for @mentions in narration. */
export async function userFirstName(userId: string): Promise<string> {
  if (!isDbConfigured()) return "there";
  const [u] = await getDb().select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
  return (u?.name ?? "there").split(" ")[0];
}
