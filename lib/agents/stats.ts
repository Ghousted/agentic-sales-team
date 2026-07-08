import "server-only";
// Real per-agent stats for the agent-detail sub-tabs, from the agent's own rows
// in leads / outreach_drafts / activity / jobs. User-scoped. Replaces the mock
// lib/agentDetail.ts builder.
import { and, desc, eq } from "drizzle-orm";
import { getDb, isDbConfigured, leads, outreachDrafts, activity, jobs } from "@/lib/db";
import { getSession } from "@/lib/auth/session";

export interface AgentStats {
  leadsWorked: number;
  researched: number;
  drafted: number;
  sent: number;
  replies: number;
  replyRate: number; // 0-100
  activity: { type: string; text: string; createdAt: string }[];
  jobs: { kind: string; status: string; createdAt: string; finishedAt: string | null }[];
}

const EMPTY: AgentStats = { leadsWorked: 0, researched: 0, drafted: 0, sent: 0, replies: 0, replyRate: 0, activity: [], jobs: [] };

export async function getAgentStats(agentId: string): Promise<AgentStats> {
  if (!isDbConfigured()) return EMPTY;
  const s = await getSession();
  const userId = s?.userId;
  if (!userId) return EMPTY;
  const db = getDb();

  const [leadRows, draftRows, actRows, jobRows] = await Promise.all([
    db.select().from(leads).where(and(eq(leads.userId, userId), eq(leads.agentId, agentId))),
    db.select().from(outreachDrafts).where(and(eq(outreachDrafts.userId, userId), eq(outreachDrafts.agentId, agentId))),
    db.select().from(activity).where(and(eq(activity.userId, userId), eq(activity.agentId, agentId))).orderBy(desc(activity.createdAt)).limit(12),
    db.select().from(jobs).where(and(eq(jobs.userId, userId), eq(jobs.agentId, agentId))).orderBy(desc(jobs.createdAt)).limit(10),
  ]);

  const leadsWorked = leadRows.length;
  const researched = leadRows.filter((l) => l.research).length;
  const replies = leadRows.filter((l) => l.status === "replied" || l.status === "meeting").length;
  const sent = draftRows.filter((d) => d.status === "sent").length;

  return {
    leadsWorked,
    researched,
    drafted: draftRows.length,
    sent,
    replies,
    replyRate: leadsWorked ? Math.round((replies / leadsWorked) * 100) : 0,
    activity: actRows.map((a) => ({ type: a.type, text: a.text, createdAt: a.createdAt.toISOString() })),
    jobs: jobRows.map((j) => ({ kind: j.kind, status: j.status, createdAt: j.createdAt.toISOString(), finishedAt: j.finishedAt ? j.finishedAt.toISOString() : null })),
  };
}
