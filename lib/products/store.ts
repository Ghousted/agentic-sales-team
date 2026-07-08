import "server-only";
// The user's Products & Services catalog: CSV import + CRUD + pgvector semantic
// search. Embeddings via Gemini text-embedding-004. Agents' source of truth.
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { getDb, isDbConfigured, products } from "@/lib/db";
import { geminiEmbed, geminiEmbedBatch } from "@/lib/ai/gemini";

export interface ProductDTO { id: string; name: string; description: string; price: string; category: string }
export interface ProductInput { name: string; description?: string; price?: string; category?: string }

const toDTO = (r: { id: string; name: string; description: string; price: string; category: string }): ProductDTO =>
  ({ id: r.id, name: r.name, description: r.description, price: r.price, category: r.category });

const embedText = (p: ProductInput) => [p.name, p.category, p.description].filter(Boolean).join("\n");

export async function listProducts(userId: string): Promise<ProductDTO[]> {
  if (!isDbConfigured()) return [];
  const rows = await getDb().select({ id: products.id, name: products.name, description: products.description, price: products.price, category: products.category })
    .from(products).where(eq(products.userId, userId)).orderBy(desc(products.createdAt));
  return rows.map(toDTO);
}

export async function addProduct(userId: string, input: ProductInput): Promise<ProductDTO | null> {
  if (!isDbConfigured() || !input.name?.trim()) return null;
  const embedding = await geminiEmbed(embedText(input));
  const [row] = await getDb().insert(products).values({
    userId, name: input.name.trim(), description: input.description ?? "", price: input.price ?? "", category: input.category ?? "",
    embedding: embedding ?? null,
  }).returning({ id: products.id, name: products.name, description: products.description, price: products.price, category: products.category });
  return toDTO(row);
}

export async function deleteProduct(userId: string, id: string): Promise<void> {
  if (!isDbConfigured()) return;
  await getDb().delete(products).where(and(eq(products.userId, userId), eq(products.id, id)));
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

export async function importProductsCsv(userId: string, csvText: string): Promise<{ added: number; error?: string }> {
  if (!isDbConfigured()) return { added: 0, error: "Server not configured." };
  const parsed = parseCsv(csvText).slice(0, 200); // bounded import
  const wanted = parsed.filter((r) => (r.name ?? "").trim());
  if (wanted.length === 0) return { added: 0, error: "No rows with a 'name' column found." };
  const inputs: ProductInput[] = wanted.map((r) => ({ name: r.name.trim(), description: r.description ?? "", price: r.price ?? "", category: r.category ?? "" }));
  const vecs = await geminiEmbedBatch(inputs.map(embedText));
  const values = inputs.map((p, i) => ({ userId, name: p.name, description: p.description ?? "", price: p.price ?? "", category: p.category ?? "", embedding: vecs[i] ?? null }));
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
  const vec = await geminiEmbed(query);
  if (!vec) return listProducts(userId).then((all) => all.slice(0, k)); // no embeddings → fall back to recent
  const lit = `[${vec.join(",")}]`;
  const rows = await getDb().select({ id: products.id, name: products.name, description: products.description, price: products.price, category: products.category })
    .from(products)
    .where(and(eq(products.userId, userId), isNotNull(products.embedding)))
    .orderBy(sql`${products.embedding} <=> ${lit}::vector`)
    .limit(k);
  return rows.map(toDTO);
}
