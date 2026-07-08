import "server-only";
// The user's Products & Services catalog: CSV import + CRUD + pgvector semantic
// search. Embeddings via Gemini text-embedding-004. Agents' source of truth.
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { getDb, isDbConfigured, products, productFolders } from "@/lib/db";
import { geminiEmbed, geminiEmbedBatch } from "@/lib/ai/gemini";

export interface ProductDTO { id: string; name: string; description: string; price: string; category: string; folderId: string | null; attributes: Record<string, string> }
export interface ProductInput { name: string; description?: string; price?: string; category?: string; folderId?: string | null; attributes?: Record<string, string> }
export interface FolderDTO { id: string; name: string; count: number }

const PRODUCT_COLS = { id: products.id, name: products.name, description: products.description, price: products.price, category: products.category, folderId: products.folderId, attributes: products.attributes };
const toDTO = (r: { id: string; name: string; description: string; price: string; category: string; folderId: string | null; attributes: Record<string, string> }): ProductDTO =>
  ({ id: r.id, name: r.name, description: r.description, price: r.price, category: r.category, folderId: r.folderId, attributes: r.attributes ?? {} });

// Embed name/category/description + all extra attributes so RAG grounds on the
// vertical's real fields (e.g. real-estate location/features/selling points).
const embedText = (p: ProductInput) =>
  [p.name, p.category, p.description, ...Object.entries(p.attributes ?? {}).map(([k, v]) => `${k}: ${v}`)].filter(Boolean).join("\n");

// ----- Folders -----
export async function listFolders(userId: string): Promise<FolderDTO[]> {
  if (!isDbConfigured()) return [];
  const db = getDb();
  const [folders, rows] = await Promise.all([
    db.select({ id: productFolders.id, name: productFolders.name }).from(productFolders).where(eq(productFolders.userId, userId)).orderBy(desc(productFolders.createdAt)),
    db.select({ folderId: products.folderId }).from(products).where(eq(products.userId, userId)),
  ]);
  const counts = new Map<string, number>();
  for (const r of rows) if (r.folderId) counts.set(r.folderId, (counts.get(r.folderId) ?? 0) + 1);
  return folders.map((f) => ({ id: f.id, name: f.name, count: counts.get(f.id) ?? 0 }));
}

export async function addFolder(userId: string, name: string): Promise<FolderDTO | null> {
  if (!isDbConfigured() || !name.trim()) return null;
  const [row] = await getDb().insert(productFolders).values({ userId, name: name.trim() }).returning({ id: productFolders.id, name: productFolders.name });
  return { id: row.id, name: row.name, count: 0 };
}

/** Delete a folder; its products fall back to "no folder" (FK on delete set null). */
export async function deleteFolder(userId: string, id: string): Promise<void> {
  if (!isDbConfigured()) return;
  await getDb().delete(productFolders).where(and(eq(productFolders.userId, userId), eq(productFolders.id, id)));
}

// ----- Products -----
export async function listProducts(userId: string, folderId?: string | null): Promise<ProductDTO[]> {
  if (!isDbConfigured()) return [];
  const where = folderId ? and(eq(products.userId, userId), eq(products.folderId, folderId)) : eq(products.userId, userId);
  const rows = await getDb().select(PRODUCT_COLS).from(products).where(where).orderBy(desc(products.createdAt));
  return rows.map(toDTO);
}

export async function addProduct(userId: string, input: ProductInput): Promise<ProductDTO | null> {
  if (!isDbConfigured() || !input.name?.trim()) return null;
  const embedding = await geminiEmbed(embedText(input));
  const [row] = await getDb().insert(products).values({
    userId, folderId: input.folderId ?? null, name: input.name.trim(), description: input.description ?? "", price: input.price ?? "", category: input.category ?? "",
    attributes: input.attributes ?? {}, embedding: embedding ?? null,
  }).returning(PRODUCT_COLS);
  return toDTO(row);
}

export async function deleteProduct(userId: string, id: string): Promise<void> {
  if (!isDbConfigured()) return;
  await getDb().delete(products).where(and(eq(products.userId, userId), eq(products.id, id)));
}

/** Move a product into a folder (or out of any folder when folderId is null). */
export async function setProductFolder(userId: string, id: string, folderId: string | null): Promise<void> {
  if (!isDbConfigured()) return;
  await getDb().update(products).set({ folderId }).where(and(eq(products.userId, userId), eq(products.id, id)));
}

/** Minimal CSV parse: header row → columns; handles quoted fields with commas. */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "", row: string[] = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(field); field = ""; if (row.some((f) => f !== "")) rows.push(row); row = []; }
    else field += c;
  }
  if (field !== "" || row.length) { row.push(field); if (row.some((f) => f !== "")) rows.push(row); }
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

// Standard fields (+ aliases). Every OTHER CSV column becomes a vertical-specific
// attribute (key→value) — so real-estate location/features/selling-points, SaaS
// plan/seats, etc. all import without hardcoding any vertical.
const FIELD_ALIASES: Record<string, "name" | "description" | "price" | "category"> = {
  name: "name", title: "name",
  description: "description", "short description": "description", desc: "description", summary: "description",
  price: "price", cost: "price",
  category: "category", type: "category",
};

export async function importProductsCsv(userId: string, csvText: string, folderId?: string | null): Promise<{ added: number; error?: string }> {
  if (!isDbConfigured()) return { added: 0, error: "Server not configured." };
  const parsed = parseCsv(csvText).slice(0, 200); // bounded import
  const inputs: ProductInput[] = [];
  for (const row of parsed) {
    const fields: { name: string; description: string; price: string; category: string } = { name: "", description: "", price: "", category: "" };
    const attributes: Record<string, string> = {};
    for (const [key, val] of Object.entries(row)) {
      if (!val) continue;
      const field = FIELD_ALIASES[key];
      if (field) fields[field] = fields[field] || val; // first match wins
      else attributes[key] = val; // vertical-specific extra column
    }
    if (!fields.name.trim()) continue;
    inputs.push({ ...fields, attributes });
  }
  if (inputs.length === 0) return { added: 0, error: "No rows with a 'name' column found." };
  const vecs = await geminiEmbedBatch(inputs.map(embedText));
  const values = inputs.map((p, i) => ({ userId, folderId: folderId ?? null, name: p.name, description: p.description ?? "", price: p.price ?? "", category: p.category ?? "", attributes: p.attributes ?? {}, embedding: vecs[i] ?? null }));
  try {
    await getDb().insert(products).values(values);
    return { added: values.length };
  } catch (e) {
    return { added: 0, error: "Import failed: " + String(e).slice(0, 150) };
  }
}

/** Semantic top-K over the user's catalog (cosine). The primitive agents ground on. */
export async function searchProducts(userId: string, query: string, k = 5): Promise<ProductDTO[]> {
  if (!isDbConfigured() || !query.trim()) return [];
  const [any] = await getDb().select({ id: products.id }).from(products).where(eq(products.userId, userId)).limit(1);
  if (!any) return []; // empty catalog → skip the embedding call
  const vec = await geminiEmbed(query);
  if (!vec) return listProducts(userId).then((all) => all.slice(0, k)); // no embeddings → fall back to recent
  const lit = `[${vec.join(",")}]`;
  const rows = await getDb().select(PRODUCT_COLS)
    .from(products)
    .where(and(eq(products.userId, userId), isNotNull(products.embedding)))
    .orderBy(sql`${products.embedding} <=> ${lit}::vector`)
    .limit(k);
  return rows.map(toDTO);
}
