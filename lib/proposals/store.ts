import "server-only";
// Generated proposals: per-agent list + create + mark-sent, and the lead pool
// for the proposal job (accepted teammate leads without a proposal yet).
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, isDbConfigured, proposals, leads } from "@/lib/db";
import { pickLeadsForRun } from "@/lib/leads/store";
import type { ProposalResult } from "@/lib/leads/types";

// Mirrors the unexported LeadRow idiom in lib/leads/store.ts — pickLeadsForRun
// (which pickLeadsForProposal wraps) returns raw lead rows, not LeadDTOs.
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

export async function addProposal(userId: string, agentId: string, leadId: string, result: ProposalResult): Promise<void> {
  if (!isDbConfigured()) return;
  await getDb().insert(proposals).values({ userId, agentId, leadId, title: result.title, body: result.body, products: result.productsUsed ?? [] });
}

export async function markProposalSent(userId: string, id: string): Promise<void> {
  if (!isDbConfigured()) return;
  await getDb().update(proposals).set({ status: "sent", sentAt: new Date() }).where(and(eq(proposals.userId, userId), eq(proposals.id, id)));
}

// Accepted teammate leads that don't yet have a proposal, oldest first, capped.
export async function pickLeadsForProposal(userId: string, agentId: string, leadIds: string[] | undefined, batchSize: number): Promise<LeadRow[]> {
  const candidates = await pickLeadsForRun(userId, agentId, leadIds, batchSize + 50); // team-expanded, accepted
  if (candidates.length === 0 || !isDbConfigured()) return candidates.slice(0, batchSize);
  const ids = candidates.map((l) => l.id);
  const existing = await getDb().select({ leadId: proposals.leadId }).from(proposals)
    .where(and(eq(proposals.userId, userId), inArray(proposals.leadId, ids)));
  const has = new Set(existing.map((e) => e.leadId));
  return candidates.filter((l) => !has.has(l.id)).slice(0, batchSize);
}
