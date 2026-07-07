import "server-only";
// All persistence for the leads/outreach domain. Plain async functions so the
// job runner (a route handler) can call them directly; the `use server`
// wrappers in ./actions.ts expose the client-facing subset.
import { and, desc, eq, inArray, asc } from "drizzle-orm";
import { getDb, isDbConfigured, leads, outreachDrafts, activity } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { LEAD_STAGES, type LeadDTO, type DraftDTO, type OutreachResult, type ResearchBrief } from "./types";
import { teammatesOf } from "@/lib/teams/membership";

type LeadRow = typeof leads.$inferSelect;

async function uid(): Promise<string | null> {
  const s = await getSession();
  return s?.userId ?? null;
}

function toLeadDTO(r: LeadRow): LeadDTO {
  return {
    id: r.id, agentId: r.agentId, name: r.name, title: r.title, company: r.company,
    email: r.email, status: r.status, score: r.score, source: r.source, review: r.review, profileUrl: r.profileUrl, platform: r.platform, research: r.research ?? null,
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  };
}

export async function addLead(input: { agentId: string; name: string; title?: string; company?: string; email: string }): Promise<LeadDTO | null> {
  if (!isDbConfigured()) return null;
  const userId = await uid();
  if (!userId) return null;
  const db = getDb();
  const [row] = await db.insert(leads).values({
    userId, agentId: input.agentId, name: input.name.trim(),
    title: (input.title ?? "").trim(), company: (input.company ?? "").trim(),
    email: input.email.trim(),
  }).returning();
  await db.insert(activity).values({
    userId, agentId: input.agentId, type: "lead_added", leadId: row.id,
    text: `Added lead ${row.name}${row.company ? " · " + row.company : ""}`,
  });
  return toLeadDTO(row);
}

export async function listLeads(filter?: { agentId?: string; status?: string; source?: string; review?: string }): Promise<LeadDTO[]> {
  if (!isDbConfigured()) return [];
  const userId = await uid();
  if (!userId) return [];
  const conds = [eq(leads.userId, userId), eq(leads.review, filter?.review ?? "accepted")];
  if (filter?.agentId) conds.push(eq(leads.agentId, filter.agentId));
  if (filter?.status) conds.push(eq(leads.status, filter.status));
  if (filter?.source) conds.push(eq(leads.source, filter.source));
  const rows = await getDb().select().from(leads).where(and(...conds)).orderBy(desc(leads.createdAt));
  return rows.map(toLeadDTO);
}

/** The agent's working book: leads assigned to any teammate (its shared team
 *  book), accepted-only, newest first. */
export async function listWorkbook(agentId: string): Promise<LeadDTO[]> {
  if (!isDbConfigured()) return [];
  const userId = await uid();
  if (!userId) return [];
  const mates = await teammatesOf(userId, agentId);
  const rows = await getDb().select().from(leads)
    .where(and(eq(leads.userId, userId), inArray(leads.agentId, mates), eq(leads.review, "accepted")))
    .orderBy(desc(leads.createdAt));
  return rows.map(toLeadDTO);
}

/** Accepted leads assigned to any of the given agents (a team's book). */
export async function listLeadsForAgents(agentIds: string[]): Promise<LeadDTO[]> {
  if (!isDbConfigured() || agentIds.length === 0) return [];
  const userId = await uid();
  if (!userId) return [];
  const rows = await getDb().select().from(leads)
    .where(and(eq(leads.userId, userId), inArray(leads.agentId, agentIds), eq(leads.review, "accepted")))
    .orderBy(desc(leads.createdAt));
  return rows.map(toLeadDTO);
}

/** Scraped candidates awaiting human review (review='pending'). */
export async function listCandidates(filter?: { agentId?: string }): Promise<LeadDTO[]> {
  if (!isDbConfigured()) return [];
  const userId = await uid();
  if (!userId) return [];
  const conds = [eq(leads.userId, userId), eq(leads.review, "pending")];
  if (filter?.agentId) conds.push(eq(leads.agentId, filter.agentId));
  const rows = await getDb().select().from(leads).where(and(...conds)).orderBy(desc(leads.createdAt));
  return rows.map(toLeadDTO);
}

/** Accept or dismiss candidate leads (bulk). Dismiss is a soft 'dismissed'. */
export async function setLeadReview(ids: string[], review: "accepted" | "dismissed"): Promise<void> {
  if (!isDbConfigured() || ids.length === 0) return;
  const userId = await uid();
  if (!userId) return;
  await getDb().update(leads).set({ review, updatedAt: new Date() })
    .where(and(eq(leads.userId, userId), inArray(leads.id, ids)));
}

export async function getLead(id: string): Promise<LeadDTO | null> {
  if (!isDbConfigured()) return null;
  const userId = await uid();
  if (!userId) return null;
  const [row] = await getDb().select().from(leads).where(and(eq(leads.id, id), eq(leads.userId, userId))).limit(1);
  return row ? toLeadDTO(row) : null;
}

export async function setStage(id: string, status: string): Promise<void> {
  if (!isDbConfigured()) return;
  const userId = await uid();
  if (!userId) return;
  if (!LEAD_STAGES.includes(status as (typeof LEAD_STAGES)[number])) return;
  await getDb().update(leads).set({ status, updatedAt: new Date() })
    .where(and(eq(leads.id, id), eq(leads.userId, userId)));
}

export async function listDraftsForAgent(agentId: string): Promise<DraftDTO[]> {
  if (!isDbConfigured()) return [];
  const userId = await uid();
  if (!userId) return [];
  const rows = await getDb().select({
    d: outreachDrafts, leadName: leads.name, leadCompany: leads.company, leadEmail: leads.email,
    leadProfileUrl: leads.profileUrl, leadPlatform: leads.platform,
  }).from(outreachDrafts)
    .innerJoin(leads, eq(outreachDrafts.leadId, leads.id))
    .where(and(eq(outreachDrafts.userId, userId), eq(outreachDrafts.agentId, agentId)))
    .orderBy(desc(outreachDrafts.createdAt));
  return rows.map(({ d, leadName, leadCompany, leadEmail, leadProfileUrl, leadPlatform }) => ({
    id: d.id, agentId: d.agentId, leadId: d.leadId, subject: d.subject, body: d.body,
    rationale: d.rationale, status: d.status, createdAt: d.createdAt.toISOString(),
    sentAt: d.sentAt ? d.sentAt.toISOString() : null, leadName, leadCompany, leadEmail, leadProfileUrl, leadPlatform,
  }));
}

export async function markDraftSent(draftId: string): Promise<void> {
  if (!isDbConfigured()) return;
  const userId = await uid();
  if (!userId) return;
  const db = getDb();
  const [d] = await db.select().from(outreachDrafts)
    .where(and(eq(outreachDrafts.id, draftId), eq(outreachDrafts.userId, userId))).limit(1);
  if (!d) return;
  await db.update(outreachDrafts).set({ status: "sent", sentAt: new Date() }).where(and(eq(outreachDrafts.id, draftId), eq(outreachDrafts.userId, userId)));
  // Advance the lead new → contacted (only if still 'new', so we never rewind a stage).
  await db.update(leads).set({ status: "contacted", updatedAt: new Date() })
    .where(and(eq(leads.id, d.leadId), eq(leads.userId, userId), eq(leads.status, "new")));
  await db.insert(activity).values({ userId, agentId: d.agentId, type: "email_sent", leadId: d.leadId, text: `Sent "${d.subject}"` });
}

// ── Runner helpers (called by /api/jobs/run) ────────────────────────────────

/** Pick the leads a run should process: the given ids, or the agent's leads
 *  that don't yet have a draft (idempotent re-runs), oldest first, capped. */
export async function pickLeadsForRun(userId: string, agentId: string, leadIds: string[] | undefined, batchSize: number): Promise<LeadRow[]> {
  const db = getDb();
  const mates = await teammatesOf(userId, agentId);
  if (leadIds && leadIds.length) {
    return db.select().from(leads)
      .where(and(eq(leads.userId, userId), inArray(leads.agentId, mates), inArray(leads.id, leadIds), eq(leads.review, "accepted")))
      .limit(batchSize);
  }
  const pool = await db.select().from(leads)
    .where(and(eq(leads.userId, userId), inArray(leads.agentId, mates), eq(leads.review, "accepted"))).orderBy(asc(leads.createdAt));
  if (!pool.length) return [];
  const poolIds = pool.map((l) => l.id);
  const drafted = await db.select({ leadId: outreachDrafts.leadId }).from(outreachDrafts)
    .where(and(eq(outreachDrafts.userId, userId), inArray(outreachDrafts.leadId, poolIds)));
  const draftedIds = new Set(drafted.map((r) => r.leadId));
  return pool.filter((l) => !draftedIds.has(l.id)).slice(0, batchSize);
}

/** Persist one engine result: the draft, the lead's new score/stage, and activity. */
export async function applyOutreachResult(userId: string, agentId: string, lead: LeadRow, result: OutreachResult): Promise<void> {
  const db = getDb();
  await db.insert(outreachDrafts).values({
    userId, agentId, leadId: lead.id, subject: result.subject, body: result.body, rationale: result.rationale,
  });
  const stage = LEAD_STAGES.includes(result.stage as (typeof LEAD_STAGES)[number]) ? result.stage : lead.status;
  await db.update(leads).set({
    score: Math.max(0, Math.min(100, Math.round(result.score || 0))), status: stage, updatedAt: new Date(),
  }).where(and(eq(leads.id, lead.id), eq(leads.userId, userId)));
  await db.insert(activity).values({ userId, agentId, type: "email_drafted", leadId: lead.id, text: `Drafted "${result.subject}" for ${lead.name}` });
}

/** Pick the agent's leads that don't have a research brief yet (or the given
 *  ids), oldest first, capped. */
export async function pickLeadsForResearch(userId: string, agentId: string, leadIds: string[] | undefined, batchSize: number): Promise<LeadRow[]> {
  const db = getDb();
  const mates = await teammatesOf(userId, agentId);
  if (leadIds && leadIds.length) {
    return db.select().from(leads)
      .where(and(eq(leads.userId, userId), inArray(leads.agentId, mates), inArray(leads.id, leadIds), eq(leads.review, "accepted")))
      .limit(batchSize);
  }
  const pool = await db.select().from(leads)
    .where(and(eq(leads.userId, userId), inArray(leads.agentId, mates), eq(leads.review, "accepted"))).orderBy(asc(leads.createdAt));
  return pool.filter((l) => !l.research).slice(0, batchSize);
}

/** Persist one research brief onto the lead + log activity. */
export async function applyResearchResult(userId: string, agentId: string, lead: LeadRow, brief: ResearchBrief): Promise<void> {
  const db = getDb();
  await db.update(leads).set({ research: brief, updatedAt: new Date() })
    .where(and(eq(leads.id, lead.id), eq(leads.userId, userId)));
  await db.insert(activity).values({ userId, agentId, type: "lead_researched", leadId: lead.id, text: `Researched ${lead.name}` });
}
