# Products & Services Catalog (RAG) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Products & Services module — CSV-uploadable catalog stored in Neon with pgvector + Gemini embeddings — exposing `searchProducts(query,k)` so agents can semantically retrieve the user's real offerings/pricing.

**Architecture:** `products` table with a `vector(768)` embedding column (pgvector). Each product is embedded via Gemini `text-embedding-004` on create/import. `searchProducts` embeds the query and does a cosine top-K. A `/products` page uploads CSV + lists the catalog. Module 1 of 2 (Module 2 wires this into the engines).

**Tech Stack:** Next.js 14 / TypeScript / Drizzle / Neon + **pgvector** / Gemini embeddings (existing transport).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-08-products-services-rag-catalog-design.md`.
- **Git identity:** commit as the user only — `Ghousted <clydepadua091@gmail.com>`. **Never** a `Co-Authored-By: Claude` / AI-attribution line.
- **No push.** `.env.local` gitignored.
- **No unit-test framework.** Verification is `npx tsc --noEmit` (from `agentic-salesforce/`) clean + code review + manual.
- **One migration** — it enables pgvector + creates `products`. **`pnpm db:migrate` (applying it to Neon) is the USER's step** (a DB write; it has been blocked by the permission classifier for the agent). Tasks must NOT run `db:migrate`; they build the migration file + code and rely on the user to apply it.
- **User-scoping:** every read/write filters by session `userId`.
- **Degrade gracefully:** no `GEMINI_API_KEY` → embedding is skipped (product still stored, just not searchable); no DB → benign empties.
- **CSV columns:** `name` (required), `description`, `price`, `category` (optional). **Embedding model:** `text-embedding-004` (768-dim).

---

## File Structure

- `lib/db/schema.ts` — MODIFY: `products` table (+ `vector` import, `ProductRow` type).
- `lib/db/migrations/00NN_*.sql` — CREATE (generated, then hand-finished): pgvector extension + products + hnsw index.
- `lib/ai/gemini.ts` — MODIFY: `geminiEmbed`.
- `lib/products/store.ts` — CREATE (`server-only`): import/add/delete/list/search + `ProductDTO`.
- `lib/products/actions.ts` — CREATE (`"use server"`): client wrappers.
- `app/products/page.tsx` — CREATE: CSV upload + manual add + list.
- `components/Shell.tsx` — MODIFY: Products nav item.

---

## Task 1: Schema + pgvector migration

**Files:** Modify `lib/db/schema.ts`; Create a migration under `lib/db/migrations/`.

**Interfaces:** Produces the `products` table + `ProductRow` type; a migration that enables pgvector + creates the table + cosine index.

- [ ] **Step 1: Add the table to `lib/db/schema.ts`.** Ensure `vector` is imported from drizzle pg-core (add it to the existing `drizzle-orm/pg-core` import), then add near the other tables:

```ts
export const products = pgTable("products", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  price: text("price").notNull().default(""),
  category: text("category").notNull().default(""),
  embedding: vector("embedding", { dimensions: 768 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type ProductRow = typeof products.$inferSelect;
```

- [ ] **Step 2: Generate the base migration.** Run `cd agentic-salesforce && pnpm db:generate`. This writes a new `lib/db/migrations/00NN_*.sql` (with `CREATE TABLE "products" (… "embedding" vector(768) …)`) and updates the drizzle snapshot. (`db:generate` is offline — schema-vs-snapshot diff, no DB connection.)

- [ ] **Step 3: Hand-finish the generated migration.** Open the newly generated `00NN_*.sql`. pgvector's extension + index aren't emitted by drizzle-kit, and the extension MUST exist before the `CREATE TABLE` (the column type is `vector`). Edit the file so it reads (statements separated by the exact marker):

```sql
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price" text DEFAULT '' NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"embedding" vector(768),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_embedding_idx" ON "products" USING hnsw ("embedding" vector_cosine_ops);
```

Keep whatever exact `CREATE TABLE`/FK text drizzle generated (match it); only **prepend** the `CREATE EXTENSION … --> statement-breakpoint` and **append** the `--> statement-breakpoint … CREATE INDEX …`. (The runner splits on the marker and runs each statement in order, so the extension runs first.)

- [ ] **Step 4: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors. **Do NOT run `pnpm db:migrate`** — the user applies it.

- [ ] **Step 5: Commit.**

```bash
git add agentic-salesforce/lib/db/schema.ts agentic-salesforce/lib/db/migrations/
git commit -m "Add products table + pgvector migration (extension, vector(768), hnsw cosine index)"
```

---

## Task 2: Gemini embeddings

**Files:** Modify `lib/ai/gemini.ts`.

**Interfaces:** Produces `geminiEmbed(text: string): Promise<number[] | null>` (768-dim; `null` when unconfigured/failed).

- [ ] **Step 1: Add `geminiEmbed`.** Append to `lib/ai/gemini.ts`:

```ts
/** Embed text with Gemini text-embedding-004 (768-dim). Returns null if unconfigured or on failure. */
export async function geminiEmbed(text: string): Promise<number[] | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${key}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: { parts: [{ text: text.slice(0, 8000) }] } }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    const values = data?.embedding?.values;
    return Array.isArray(values) && values.length ? (values as number[]) : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors.

- [ ] **Step 3: Commit.**

```bash
git add agentic-salesforce/lib/ai/gemini.ts
git commit -m "Add geminiEmbed (text-embedding-004, 768-dim) for the products catalog"
```

---

## Task 3: Products store + actions

**Files:** Create `lib/products/store.ts`, `lib/products/actions.ts`.

**Interfaces:**
- Produces (server-only): `ProductDTO`, `listProducts(userId)`, `addProduct(userId, fields)`, `deleteProduct(userId, id)`, `importProductsCsv(userId, csvText)`, `searchProducts(userId, query, k?)`.
- Produces (`"use server"`): the same, resolving `userId` from the session (except `searchProducts`, which Module 2 calls server-side with an explicit `userId`).

- [ ] **Step 1: Write `lib/products/store.ts`.**

```ts
import "server-only";
// The user's Products & Services catalog: CSV import + CRUD + pgvector semantic
// search. Embeddings via Gemini text-embedding-004. Agents' source of truth.
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { getDb, isDbConfigured, products } from "@/lib/db";
import { geminiEmbed } from "@/lib/ai/gemini";

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
  let added = 0;
  for (const r of wanted) {
    await addProduct(userId, { name: r.name, description: r.description ?? "", price: r.price ?? "", category: r.category ?? "" });
    added++;
  }
  return { added };
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
```

- [ ] **Step 2: Write `lib/products/actions.ts`.**

```ts
"use server";
// Client-facing wrappers for the products catalog (session-scoped).
import { getSession } from "@/lib/auth/session";
import { listProducts as _list, addProduct as _add, deleteProduct as _del, importProductsCsv as _import, type ProductDTO, type ProductInput } from "./store";

async function uid(): Promise<string | null> { return (await getSession())?.userId ?? null; }

export async function listProducts(): Promise<ProductDTO[]> { const u = await uid(); return u ? _list(u) : []; }
export async function addProduct(input: ProductInput): Promise<ProductDTO | null> { const u = await uid(); return u ? _add(u, input) : null; }
export async function deleteProduct(id: string): Promise<void> { const u = await uid(); if (u) await _del(u, id); }
export async function importProductsCsv(csvText: string): Promise<{ added: number; error?: string }> { const u = await uid(); return u ? _import(u, csvText) : { added: 0, error: "Not signed in." }; }
```

- [ ] **Step 3: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors. (Confirm `isNotNull`/`sql` are exported by `drizzle-orm` — they are; the `<=> …::vector` `sql` template binds `lit` as a parameter.)

- [ ] **Step 4: Commit.**

```bash
git add agentic-salesforce/lib/products/store.ts agentic-salesforce/lib/products/actions.ts
git commit -m "Products store: CSV import + CRUD + pgvector searchProducts (source of truth)"
```

---

## Task 4: Products page + nav

**Files:** Create `app/products/page.tsx`; Modify `components/Shell.tsx`.

**Interfaces:** Consumes `listProducts`/`addProduct`/`deleteProduct`/`importProductsCsv` (Task 3).

- [ ] **Step 1: Add the nav item.** In `components/Shell.tsx`, add to the `NAV` array (after Leads):

```ts
  { href: "/products", icon: "leads", label: "Products" },
```

And in the `title()` function (the `if (path.startsWith(...))` chain), add:

```ts
  if (path.startsWith("/products")) return "Products";
```

(Reuse the `"leads"` nav glyph — there's no dedicated products icon.)

- [ ] **Step 2: Write `app/products/page.tsx`.**

```tsx
"use client";
import { useEffect, useState } from "react";
import { css, Box, Btn } from "@/components/primitives";
import { listProducts, addProduct, deleteProduct, importProductsCsv } from "@/lib/products/actions";
import type { ProductDTO } from "@/lib/products/store";

const inp = "width:100%;border:1px solid #E4E4E7;border-radius:10px;padding:10px 13px;font-size:13px;outline:none";

export default function ProductsPage() {
  const [items, setItems] = useState<ProductDTO[]>([]);
  const [form, setForm] = useState({ name: "", category: "", price: "", description: "" });
  const [note, setNote] = useState("");
  const refresh = () => listProducts().then(setItems);
  useEffect(() => { refresh(); }, []);

  const onCsv = async (file: File | undefined) => {
    if (!file) return;
    setNote("Importing…");
    const res = await importProductsCsv(await file.text());
    setNote(res.error ? res.error : `Imported ${res.added} product${res.added === 1 ? "" : "s"}.`);
    refresh();
  };
  const onAdd = async () => {
    if (!form.name.trim()) return;
    await addProduct(form);
    setForm({ name: "", category: "", price: "", description: "" });
    refresh();
  };
  const onDelete = async (id: string) => { await deleteProduct(id); refresh(); };

  return (
    <div style={css("padding:24px 26px;display:flex;flex-direction:column;gap:18px;animation:fadeUp .3s ease")}>
      <div style={css("display:flex;align-items:baseline;gap:12px")}>
        <div style={css("font-family:'Poetsen One',sans-serif;font-size:22px")}>Products & Services</div>
        <div style={css("font-size:13px;color:#71717A")}>{items.length} in your catalog — your agents’ source of truth</div>
      </div>

      <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:18px 20px;display:flex;flex-direction:column;gap:12px")}>
        <div style={css("font-size:13.5px;font-weight:700")}>Import from CSV</div>
        <div style={css("font-size:12px;color:#71717A")}>Columns: <b>name</b> (required), description, price, category.</div>
        <input type="file" accept=".csv,text/csv" aria-label="Upload CSV" onChange={(e) => onCsv(e.target.files?.[0])} style={css("font-size:12.5px")} />
        {note && <div style={css("font-size:12px;color:#5122C1")}>{note}</div>}
      </div>

      <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:18px 20px;display:flex;flex-direction:column;gap:10px")}>
        <div style={css("font-size:13.5px;font-weight:700")}>Add a product</div>
        <div style={css("display:grid;grid-template-columns:1.4fr 1fr .8fr;gap:10px")}>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name" style={css(inp)} />
          <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Category" style={css(inp)} />
          <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="Price" style={css(inp)} />
        </div>
        <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Description" style={css(inp)} />
        <Btn onClick={onAdd} style={"align-self:flex-start;background:#5122C1;color:#fff;border:none;border-radius:99px;padding:9px 18px;font-size:12.5px;font-weight:600;" + (form.name.trim() ? "cursor:pointer" : "opacity:.5;cursor:default")} styleHover={form.name.trim() ? "background:#42199E" : ""}>Add product</Btn>
      </div>

      <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;overflow:hidden")}>
        <div style={css("display:grid;grid-template-columns:1.4fr 1fr .8fr 2fr auto;padding:11px 18px;font-size:11px;font-weight:600;color:#71717A;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #ECECF1;gap:10px")}>
          <div>Name</div><div>Category</div><div>Price</div><div>Description</div><div></div>
        </div>
        {items.length === 0 ? (
          <div style={css("padding:18px;font-size:12.5px;color:#A1A1AA")}>No products yet — import a CSV or add one above.</div>
        ) : items.map((p) => (
          <div key={p.id} style={css("display:grid;grid-template-columns:1.4fr 1fr .8fr 2fr auto;padding:12px 18px;font-size:12.5px;border-bottom:1px solid #F4F4F6;align-items:center;gap:10px")}>
            <div style={css("font-weight:600")}>{p.name}</div>
            <div style={css("color:#3F3F46")}>{p.category || "—"}</div>
            <div style={css("color:#3F3F46")}>{p.price || "—"}</div>
            <div style={css("color:#71717A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{p.description || "—"}</div>
            <Btn onClick={() => onDelete(p.id)} style="background:#fff;color:#B91C1C;border:1px solid #F3C7C7;border-radius:99px;padding:5px 12px;font-size:11.5px;font-weight:600;cursor:pointer" styleHover="background:#FEECEC">Delete</Btn>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors.

- [ ] **Step 4: Manual check (after the user runs `pnpm db:migrate`).** Visit `/products`: import a CSV (name/description/price/category) → rows appear; add one manually; delete one; each row (with `GEMINI_API_KEY` set) gets an embedding so `searchProducts` will work in Module 2.

- [ ] **Step 5: Commit.**

```bash
git add "agentic-salesforce/app/products/page.tsx" agentic-salesforce/components/Shell.tsx
git commit -m "Products page + nav: CSV upload, manual add, catalog list"
```

---

## Self-Review

**Spec coverage:** Part A (data model + pgvector) → Task 1. Part B (embeddings) → Task 2. Part C (import + manage) → Task 3 (`importProductsCsv`/`addProduct`/`deleteProduct`/`listProducts`). Part D (retrieval) → Task 3 (`searchProducts`). Part E (UI + nav) → Task 4. Module-2 wiring is deferred (spec says so).

**Placeholder scan:** every step has complete code or an exact edit target. The migration Step 3 shows the exact expected SQL and says to match drizzle's generated `CREATE TABLE` text while prepending the extension + appending the index.

**Type consistency:** `ProductDTO`/`ProductInput` (Task 3) are used by the actions (Task 3) and the page (Task 4). `geminiEmbed(text): number[]|null` (Task 2) is consumed by `addProduct`/`searchProducts` (Task 3). `products`/`vector` (Task 1 schema) are imported by the store (Task 3). The action signatures (`listProducts()`, `addProduct(input)`, `deleteProduct(id)`, `importProductsCsv(csvText)`) match the page's calls (Task 4). `searchProducts(userId, query, k)` takes an explicit `userId` (server-only; Module 2 supplies the session userId) — deliberately NOT in the `"use server"` wrappers.

**Migration caveat noted:** `db:generate` syncs the drizzle snapshot; the hand-added extension + index live only in the SQL file (drizzle-kit doesn't manage them) — fine for the custom runner. **The user must run `pnpm db:migrate`** to apply it (agent is blocked from DB writes).
