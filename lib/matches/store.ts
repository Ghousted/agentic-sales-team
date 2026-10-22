import "server-only";
// Matchmaker persistence: the lead pool for a match run, bulk insert of a lead's
// matches, and the per-lead match list (joined to products for display).
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb, isDbConfigured, matches, leads, products } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { teammatesOf } from "@/lib/teams/membership";
import type { MatchResult } from "@/lib/leads/types";

type LeadRow = typeof leads.$inferSelect;

async function uid(): Promise<string | null> {
  const s = await getSession();
  return s?.userId ?? null;
}

export interface MatchDTO {
  id: string;
  leadId: string;
  productId: string;
  score: number;
  reason: string;
  productName: string;
  productPrice: string;
  productCategory: string;
  createdAt: string;
}

/** Leads a match run should process: the given ids (own accepted leads, honored
 *  regardless of team book), or the agent's teammate-book accepted leads the
 *  matchmaker hasn't run on yet (matchedAt unset), oldest first, capped. */
export async function pickLeadsForMatch(userId: string, agentId: string, leadIds: string[] | undefined, batchSize: number): Promise<LeadRow[]> {
  if (!isDbConfigured()) return [];
  const db = getDb();
  if (leadIds && leadIds.length) {
    return db.select().from(leads)
      .where(and(eq(leads.userId, userId), inArray(leads.id, leadIds), eq(leads.review, "accepted")))
      .limit(batchSize);
  }
  const mates = await teammatesOf(userId, agentId);
  return db.select().from(leads)
    .where(and(eq(leads.userId, userId), inArray(leads.agentId, mates), eq(leads.review, "accepted"), isNull(leads.matchedAt)))
    .orderBy(asc(leads.createdAt)).limit(batchSize);
}

/** Persist a lead's matches and stamp the lead matched in one batch, so the
 *  queue moves on even when nothing fit. */
export async function addMatches(userId: string, agentId: string, leadId: string, results: MatchResult[]): Promise<void> {
  if (!isDbConfigured()) return;
  const db = getDb();
  const stamp = db.update(leads).set({ matchedAt: new Date() }).where(and(eq(leads.id, leadId), eq(leads.userId, userId)));
  if (results.length === 0) { await stamp; return; }
  await db.batch([
    db.insert(matches).values(results.map((m) => ({ userId, agentId, leadId, productId: m.productId, score: m.score, reason: m.reason }))),
    stamp,
  ]);
}

/** A lead's matches joined to their listing details, best fit first. Session-scoped. */
export async function listMatchesForLead(leadId: string): Promise<MatchDTO[]> {
  if (!isDbConfigured()) return [];
  const userId = await uid();
  if (!userId) return [];
  const rows = await getDb().select({
    id: matches.id, leadId: matches.leadId, productId: matches.productId, score: matches.score, reason: matches.reason, createdAt: matches.createdAt,
    productName: products.name, productPrice: products.price, productCategory: products.category,
  }).from(matches)
    .innerJoin(products, eq(matches.productId, products.id))
    .where(and(eq(matches.userId, userId), eq(matches.leadId, leadId)))
    .orderBy(desc(matches.score));
  return rows.map((r) => ({
    id: r.id, leadId: r.leadId, productId: r.productId, score: r.score, reason: r.reason,
    productName: r.productName, productPrice: r.productPrice, productCategory: r.productCategory, createdAt: r.createdAt.toISOString(),
  }));
}
