import "server-only";
// Top-bar global search over the caller's leads and products: a capped,
// case-insensitive substring match (agents and teams are searched client-side).
import { and, desc, eq, ilike, ne, or } from "drizzle-orm";
import { getDb, isDbConfigured, leads, products } from "@/lib/db";

export interface SearchHit { id: string; title: string; subtitle: string }
export interface SearchResults { leads: SearchHit[]; products: SearchHit[] }

/** Results per kind; the dropdown shows at most this many of each. */
export const SEARCH_LIMIT = 5;
const MIN_QUERY = 2;
const MAX_QUERY = 100;

const EMPTY: SearchResults = { leads: [], products: [] };

/** Escape LIKE wildcards so "%" or "_" in the query match literally. */
export const likePattern = (q: string) => "%" + q.replace(/[\\%_]/g, (c) => "\\" + c) + "%";

export async function searchRecords(userId: string, query: string): Promise<SearchResults> {
  const q = query.trim().slice(0, MAX_QUERY);
  if (!isDbConfigured() || q.length < MIN_QUERY) return EMPTY;
  const pat = likePattern(q);
  const db = getDb();
  const [leadRows, productRows] = await Promise.all([
    db.select({ id: leads.id, name: leads.name, title: leads.title, company: leads.company, email: leads.email })
      .from(leads)
      .where(and(eq(leads.userId, userId), ne(leads.review, "dismissed"),
        or(ilike(leads.name, pat), ilike(leads.company, pat), ilike(leads.email, pat), ilike(leads.title, pat))))
      .orderBy(desc(leads.createdAt))
      .limit(SEARCH_LIMIT),
    db.select({ id: products.id, name: products.name, category: products.category, price: products.price })
      .from(products)
      .where(and(eq(products.userId, userId),
        or(ilike(products.name, pat), ilike(products.category, pat), ilike(products.description, pat))))
      .orderBy(desc(products.createdAt))
      .limit(SEARCH_LIMIT),
  ]);
  return {
    leads: leadRows.map((l) => ({ id: l.id, title: l.name, subtitle: [l.title, l.company].filter(Boolean).join(" · ") || l.email })),
    products: productRows.map((p) => ({ id: p.id, title: p.name, subtitle: [p.category, p.price].filter(Boolean).join(" · ") })),
  };
}
