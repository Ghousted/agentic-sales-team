import "server-only";
// Generated proposals: per-agent list + create + mark-sent, and the lead pool
// for the proposal job (accepted teammate leads without a proposal yet).
import { and, asc, desc, eq, inArray, notExists } from "drizzle-orm";
import { getDb, isDbConfigured, proposals, leads } from "@/lib/db";
import { teammatesOf } from "@/lib/teams/membership";
import type { ProposalResult } from "@/lib/leads/types";

// Mirrors the unexported LeadRow idiom in lib/leads/store.ts. The queries
// below return raw lead rows, not LeadDTOs.
type LeadRow = typeof leads.$inferSelect;

export interface ProposalDTO { id: string; leadId: string; title: string; body: string; products: string[]; status: string; createdAt: string }

const toDTO = (r: { id: string; leadId: string; title: string; body: string; products: string[]; status: string; createdAt: Date }): ProposalDTO =>
  ({ id: r.id, leadId: r.leadId, title: r.title, body: r.body, products: r.products, status: r.status, createdAt: r.createdAt.toISOString() });

export async function listProposalsForAgent(userId: string, agentId: string): Promise<ProposalDTO[]> {
  if (!isDbConfigured()) return [];
  const rows = await getDb().select({ id: proposals.id, leadId: proposals.leadId, title: proposals.title, body: proposals.body, products: proposals.products, status: proposals.status, createdAt: proposals.createdAt })
    .from(proposals).where(and(eq(proposals.userId, userId), eq(proposals.agentId, agentId))).orderBy(desc(proposals.createdAt));
  return rows.map(toDTO);
}

// Returns false when the lead already has a proposal (a concurrent run wrote
// it first; proposals_lead_id_idx allows one per lead).
export async function addProposal(userId: string, agentId: string, leadId: string, result: ProposalResult): Promise<boolean> {
  if (!isDbConfigured()) return false;
  const inserted = await getDb().insert(proposals)
    .values({ userId, agentId, leadId, title: result.title, body: result.body, products: result.productsUsed ?? [] })
    .onConflictDoNothing().returning({ id: proposals.id });
  return inserted.length > 0;
}

export async function markProposalSent(userId: string, id: string): Promise<void> {
  if (!isDbConfigured()) return;
  await getDb().update(proposals).set({ status: "sent", sentAt: new Date() }).where(and(eq(proposals.userId, userId), eq(proposals.id, id)));
}

// Accepted teammate leads that don't yet have a proposal, oldest first, capped.
// The "no proposal yet" filter runs in SQL before LIMIT, so leads that already
// have one can't fill the window and starve newer leads.
export async function pickLeadsForProposal(userId: string, agentId: string, leadIds: string[] | undefined, batchSize: number): Promise<LeadRow[]> {
  if (!isDbConfigured()) return [];
  const db = getDb();
  const noProposal = notExists(db.select({ id: proposals.id }).from(proposals)
    .where(and(eq(proposals.userId, userId), eq(proposals.leadId, leads.id))));
  const accepted = and(eq(leads.userId, userId), eq(leads.review, "accepted"), noProposal);
  if (leadIds && leadIds.length) {
    return db.select().from(leads).where(and(accepted, inArray(leads.id, leadIds))).limit(batchSize);
  }
  const mates = await teammatesOf(userId, agentId);
  return db.select().from(leads).where(and(accepted, inArray(leads.agentId, mates))).orderBy(asc(leads.createdAt)).limit(batchSize);
}
