import "server-only";
// The user's Products & Services catalog: CSV import + CRUD + pgvector semantic
// search. Embeddings via OpenRouter (see EMBED_MODEL). Agents' source of truth.
import { and, desc, eq, ilike, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { getDb, isDbConfigured, products, productFolders } from "@/lib/db";
import { aiEmbed, aiEmbedBatch } from "@/lib/ai/openrouter";

export interface ProductDTO { id: string; name: string; description: string; price: string; category: string; folderId: string | null; attributes: Record<string, string> }
export interface ProductInput { name: string; description?: string; price?: string; category?: string; folderId?: string | null; attributes?: Record<string, string> }
export interface FolderDTO { id: string; name: string; count: number }
export interface ImportResult { added: number; error?: string; /** Set when some rows saved without an embedding (keyword search only). */ warning?: string }
export interface ReembedResult { embedded: number; failed: number; error?: string }

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

const notIndexed = (n: number, reason: string) =>
  `${n} product${n === 1 ? "" : "s"} could not be indexed for search (${reason.slice(0, 150)}). They match by keyword until you re-index.`;

/** Saves the product even when embedding fails; `warning` then says it is keyword search only. */
export async function addProduct(userId: string, input: ProductInput): Promise<(ProductDTO & { warning?: string }) | null> {
  if (!isDbConfigured() || !input.name?.trim()) return null;
  let embedding: number[] | null = null;
  let warning: string | undefined;
  try {
    embedding = await aiEmbed(embedText(input));
  } catch (e) {
    warning = notIndexed(1, (e as Error).message);
    console.error("[products] embedding failed:", (e as Error).message);
  }
  const [row] = await getDb().insert(products).values({
    userId, folderId: input.folderId ?? null, name: input.name.trim(), description: input.description ?? "", price: input.price ?? "", category: input.category ?? "",
    attributes: input.attributes ?? {}, embedding,
  }).returning(PRODUCT_COLS);
  return warning ? { ...toDTO(row), warning } : toDTO(row);
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

export async function importProductsCsv(userId: string, csvText: string, folderId?: string | null): Promise<ImportResult> {
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
  const { vectors, error: embedError } = await aiEmbedBatch(inputs.map(embedText));
  const values = inputs.map((p, i) => ({ userId, folderId: folderId ?? null, name: p.name, description: p.description ?? "", price: p.price ?? "", category: p.category ?? "", attributes: p.attributes ?? {}, embedding: vectors[i] ?? null }));
  const missing = vectors.filter((v) => !v).length;
  if (embedError) console.error("[products] import embedding failed:", embedError);
  try {
    await getDb().insert(products).values(values);
    return missing ? { added: values.length, warning: notIndexed(missing, embedError ?? "unknown error") } : { added: values.length };
  } catch (e) {
    return { added: 0, error: "Import failed: " + String(e).slice(0, 150) };
  }
}

/**
 * Re-embed the user's catalog with the current model. Pass onlyMissing to fill
 * rows with no embedding; otherwise every row is redone, which is required after
 * a model change because vectors from different models are not comparable.
 */
export async function reembedProducts(userId: string, opts?: { onlyMissing?: boolean }): Promise<ReembedResult> {
  if (!isDbConfigured()) return { embedded: 0, failed: 0, error: "Server not configured." };
  const db = getDb();
  const where = opts?.onlyMissing ? and(eq(products.userId, userId), isNull(products.embedding)) : eq(products.userId, userId);
  const rows = (await db.select(PRODUCT_COLS).from(products).where(where)).map(toDTO);
  if (rows.length === 0) return { embedded: 0, failed: 0 };
  const { vectors, error } = await aiEmbedBatch(rows.map(embedText));
  let embedded = 0;
  for (let i = 0; i < rows.length; i += 25) {
    const writes = rows.slice(i, i + 25).flatMap((r, j) => {
      const v = vectors[i + j];
      return v ? [db.update(products).set({ embedding: v }).where(and(eq(products.userId, userId), eq(products.id, r.id)))] : [];
    });
    await Promise.all(writes);
    embedded += writes.length;
  }
  return { embedded, failed: rows.length - embedded, error };
}

// Words of 3+ letters/digits. Splitting on everything else also strips LIKE wildcards.
const searchTerms = (q: string) => Array.from(new Set(q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 3))).slice(0, 8);

/** Keyword match over name/category/description/attributes, ranked by how many terms hit. */
async function keywordSearch(userId: string, query: string, k: number, extra?: SQL): Promise<ProductDTO[]> {
  const terms = searchTerms(query);
  if (terms.length === 0) return [];
  const anyTerm = or(...terms.flatMap((t) => {
    const pat = `%${t}%`;
    return [ilike(products.name, pat), ilike(products.category, pat), ilike(products.description, pat), sql`${products.attributes}::text ilike ${pat}`];
  }));
  const rows = await getDb().select(PRODUCT_COLS).from(products)
    .where(and(eq(products.userId, userId), extra, anyTerm))
    .limit(50);
  const hits = (p: ProductDTO) => {
    const hay = embedText(p).toLowerCase();
    return terms.filter((t) => hay.includes(t)).length;
  };
  return rows.map(toDTO).map((p) => ({ p, n: hits(p) })).sort((a, b) => b.n - a.n).slice(0, k).map((x) => x.p);
}

/** Alternate semantic and keyword hits, dropping duplicates. */
function interleave(a: ProductDTO[], b: ProductDTO[], k: number): ProductDTO[] {
  const out: ProductDTO[] = [];
  const seen = new Set<string>();
  for (let i = 0; out.length < k && (i < a.length || i < b.length); i++) {
    for (const p of [a[i], b[i]]) if (p && !seen.has(p.id) && out.length < k) { seen.add(p.id); out.push(p); }
  }
  return out;
}

/**
 * Top-K products for a query: cosine search over embedded rows, plus keyword
 * matches for rows with no embedding so they are never invisible. If the query
 * itself cannot be embedded, keyword search covers the whole catalog.
 */
export async function searchProducts(userId: string, query: string, k = 5): Promise<ProductDTO[]> {
  if (!isDbConfigured() || !query.trim()) return [];
  const [any] = await getDb().select({ id: products.id }).from(products).where(eq(products.userId, userId)).limit(1);
  if (!any) return []; // empty catalog → skip the embedding call
  let vec: number[] | null = null;
  try {
    vec = await aiEmbed(query, "search_query");
  } catch (e) {
    console.error("[products] query embedding failed, using keyword search:", (e as Error).message);
  }
  if (!vec) {
    const keyword = await keywordSearch(userId, query, k);
    return keyword.length ? keyword : listProducts(userId).then((all) => all.slice(0, k)); // nothing matched → recent
  }
  const lit = `[${vec.join(",")}]`;
  const [semantic, keyword] = await Promise.all([
    getDb().select(PRODUCT_COLS)
      .from(products)
      .where(and(eq(products.userId, userId), isNotNull(products.embedding)))
      .orderBy(sql`${products.embedding} <=> ${lit}::vector`)
      .limit(k),
    keywordSearch(userId, query, k, isNull(products.embedding)),
  ]);
  return interleave(semantic.map(toDTO), keyword, k);
}
