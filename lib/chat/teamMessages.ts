import "server-only";
// Read/write for a team group-chat thread (messages keyed by teamId) + the user's
// display name for @mentions. Used by the pod orchestration to narrate its work.
import { and, asc, eq, gt, like } from "drizzle-orm";
import { getDb, isDbConfigured, jobs, messages, users } from "@/lib/db";
import { jobMarker, jobOutcomeText, type StoredMsg } from "./thread";

/** Post a message into a team's chat thread, spoken by an agent (or "system"). */
export async function postTeamMessage(userId: string, teamId: string, speakerAgentId: string, text: string): Promise<void> {
  if (!isDbConfigured()) return;
  await getDb().insert(messages).values({ userId, agentId: teamId, who: speakerAgentId, text });
}

/** Store several rows in order and return them with their ids. */
export async function insertTeamMessages(userId: string, teamId: string, msgs: { who: string; text: string }[]): Promise<StoredMsg[]> {
  if (!isDbConfigured() || msgs.length === 0) return [];
  const rows = await getDb().insert(messages)
    .values(msgs.map((m) => ({ userId, agentId: teamId, who: m.who, text: m.text })))
    .returning({ id: messages.id, who: messages.who, text: messages.text });
  return rows.sort((a, b) => a.id - b.id);
}

/** The team thread, oldest first — only the rows after `afterId` when given. */
export async function listTeamMessages(userId: string, teamId: string, afterId = 0): Promise<StoredMsg[]> {
  if (!isDbConfigured()) return [];
  const scope = and(eq(messages.userId, userId), eq(messages.agentId, teamId));
  const rows = await getDb().select({ id: messages.id, who: messages.who, text: messages.text })
    .from(messages).where(afterId > 0 ? and(scope, gt(messages.id, afterId)) : scope).orderBy(asc(messages.id));
  return rows.map((r) => ({ id: r.id, who: r.who, text: r.text }));
}

/** Once a job the user started from this thread has ended, post its outcome
 *  as the agent — once: the ⟦job:id⟧ marker in the text makes a repeat call a
 *  no-op. The text comes from the job row, never from the client. Returns the
 *  job's status, or null when the job isn't this user's. */
export async function postJobOutcome(userId: string, teamId: string, jobId: string): Promise<string | null> {
  if (!isDbConfigured()) return null;
  const db = getDb();
  const [job] = await db.select({ kind: jobs.kind, agentId: jobs.agentId, status: jobs.status, result: jobs.result, params: jobs.params })
    .from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.userId, userId))).limit(1);
  if (!job) return null;
  const pod = !!(job.params as { pod?: boolean } | null)?.pod;
  const text = jobOutcomeText(job.kind, job.status, job.result, pod);
  if (!text) return job.status;
  const marker = jobMarker(jobId);
  const [seen] = await db.select({ id: messages.id }).from(messages)
    .where(and(eq(messages.userId, userId), eq(messages.agentId, teamId), like(messages.text, `%${marker}%`))).limit(1);
  if (!seen) await db.insert(messages).values({ userId, agentId: teamId, who: job.agentId, text: `${text} ${marker}` });
  return job.status;
}

/** The user's first name, for @mentions in narration. */
export async function userFirstName(userId: string): Promise<string> {
  if (!isDbConfigured()) return "there";
  const [u] = await getDb().select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
  return (u?.name ?? "there").split(" ")[0];
}
