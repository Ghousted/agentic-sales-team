import "server-only";
// Real workspace-wide aggregates + the activity log, for the dashboard,
// analytics, notifications, and calendar. User-scoped; accepted leads only.
import { and, desc, eq } from "drizzle-orm";
import { getDb, isDbConfigured, leads, outreachDrafts, activity, jobs } from "@/lib/db";
import { getSession } from "@/lib/auth/session";

export interface WorkspaceStats {
  leadsWorked: number;
  drafted: number;
  sent: number;
  replies: number;
  replyRate: number; // 0-100
  activeAgents: number;
  tasksRunning: number;
  perAgent: { agentId: string; leadsWorked: number; drafted: number; sent: number }[];
  daily: { date: string; drafted: number; sent: number }[]; // last 14 days, oldest→newest (YYYY-MM-DD)
}
export interface ActivityItem { agentId: string; type: string; text: string; createdAt: string }

const EMPTY: WorkspaceStats = { leadsWorked: 0, drafted: 0, sent: 0, replies: 0, replyRate: 0, activeAgents: 0, tasksRunning: 0, perAgent: [], daily: [] };

async function uid(): Promise<string | null> {
  const s = await getSession();
  return s?.userId ?? null;
}

export async function getWorkspaceStats(): Promise<WorkspaceStats> {
  if (!isDbConfigured()) return EMPTY;
  const userId = await uid();
  if (!userId) return EMPTY;
  const db = getDb();

  const [leadRows, draftRows, runningJobs, actRows] = await Promise.all([
    db.select().from(leads).where(and(eq(leads.userId, userId), eq(leads.review, "accepted"))),
    db.select().from(outreachDrafts).where(eq(outreachDrafts.userId, userId)),
    db.select().from(jobs).where(and(eq(jobs.userId, userId), eq(jobs.status, "running"))),
    db.select().from(activity).where(eq(activity.userId, userId)).orderBy(desc(activity.createdAt)).limit(400),
  ]);

  const leadsWorked = leadRows.length;
  const replies = leadRows.filter((l) => l.status === "replied" || l.status === "meeting").length;
  const sent = draftRows.filter((d) => d.status === "sent").length;

  // per-agent output
  const pa: Record<string, { agentId: string; leadsWorked: number; drafted: number; sent: number }> = {};
  const bump = (id: string) => (pa[id] ??= { agentId: id, leadsWorked: 0, drafted: 0, sent: 0 });
  for (const l of leadRows) bump(l.agentId).leadsWorked++;
  for (const d of draftRows) { const r = bump(d.agentId); r.drafted++; if (d.status === "sent") r.sent++; }

  // 14-day series from activity (email_drafted / email_sent) keyed by YYYY-MM-DD
  const days: string[] = [];
  const now = new Date();
  for (let i = 13; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i); days.push(d.toISOString().slice(0, 10)); }
  const dayMap: Record<string, { date: string; drafted: number; sent: number }> = {};
  for (const key of days) dayMap[key] = { date: key, drafted: 0, sent: 0 };
  for (const a of actRows) {
    const key = a.createdAt.toISOString().slice(0, 10);
    const bucket = dayMap[key];
    if (!bucket) continue;
    if (a.type === "email_drafted") bucket.drafted++;
    else if (a.type === "email_sent") bucket.sent++;
  }

  return {
    leadsWorked,
    drafted: draftRows.length,
    sent,
    replies,
    replyRate: leadsWorked ? Math.round((replies / leadsWorked) * 100) : 0,
    activeAgents: new Set(runningJobs.map((j) => j.agentId)).size,
    tasksRunning: runningJobs.length,
    perAgent: Object.values(pa),
    daily: days.map((k) => dayMap[k]),
  };
}

export async function listActivity(limit = 30): Promise<ActivityItem[]> {
  if (!isDbConfigured()) return [];
  const userId = await uid();
  if (!userId) return [];
  const rows = await getDb().select().from(activity)
    .where(eq(activity.userId, userId)).orderBy(desc(activity.createdAt)).limit(limit);
  return rows.map((a) => ({ agentId: a.agentId, type: a.type, text: a.text, createdAt: a.createdAt.toISOString() }));
}

// ── Notifications bell ───────────────────────────────────────────────────────
// The bell reads its own view of the activity log so a user can clear it without
// touching the dashboard/analytics/calendar (which all read listActivity raw).
// Each row carries its `id` so a single notification can be dismissed.
export interface NotificationItem extends ActivityItem { id: string }

export async function listNotifications(limit = 30): Promise<NotificationItem[]> {
  if (!isDbConfigured()) return [];
  const userId = await uid();
  if (!userId) return [];
  const rows = await getDb().select().from(activity)
    .where(and(eq(activity.userId, userId), eq(activity.dismissed, false)))
    .orderBy(desc(activity.createdAt)).limit(limit);
  return rows.map((a) => ({ id: a.id, agentId: a.agentId, type: a.type, text: a.text, createdAt: a.createdAt.toISOString() }));
}

/** Clear one notification from the bell (soft-hide; the row stays for analytics). */
export async function dismissNotification(id: string): Promise<void> {
  if (!isDbConfigured()) return;
  const userId = await uid();
  if (!userId) return;
  await getDb().update(activity).set({ dismissed: true })
    .where(and(eq(activity.id, id), eq(activity.userId, userId)));
}

/** Clear every current notification. Returns how many were cleared. */
export async function clearAllNotifications(): Promise<number> {
  if (!isDbConfigured()) return 0;
  const userId = await uid();
  if (!userId) return 0;
  const rows = await getDb().update(activity).set({ dismissed: true })
    .where(and(eq(activity.userId, userId), eq(activity.dismissed, false)))
    .returning({ id: activity.id });
  return rows.length;
}
