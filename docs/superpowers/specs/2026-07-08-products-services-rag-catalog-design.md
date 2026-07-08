# Products & Services Catalog (RAG) — Design

A **Products & Services** module: the user uploads their catalog (CSV), and it becomes the **agents' source of truth**. Stored in Neon with **pgvector** embeddings so any capability that needs product knowledge — **Proposal, Outreach, Qualify** — can **semantically retrieve the relevant offerings/pricing** and ground its output in real products instead of hallucinating.

> **Module 1 of 2** (foundation). Module 2 (Spec 2) adds the capabilities — Qualify (real), Proposal (real, grounded here), Enrich (placeholder) — that consume this catalog. Build this first.
> Reuses the Gemini transport (`lib/ai/gemini.ts`), the custom migration runner (raw SQL), and the existing module/nav pattern.

---

## Part A — Data model + pgvector

- **Migration (hand-written SQL, run by `scripts/migrate.mjs`):**
  - `CREATE EXTENSION IF NOT EXISTS vector;` (Neon supports pgvector).
  - `products` table: `id` uuid PK, `user_id` uuid → users cascade, `name` text NOT NULL, `description` text default `''`, `price` text default `''` (free-form, e.g. "$99/mo"), `category` text default `''`, `embedding vector(768)` (nullable until embedded), `created_at` timestamptz.
  - A cosine index for search: `CREATE INDEX ON products USING hnsw (embedding vector_cosine_ops);` (hnsw; ivfflat as fallback if hnsw unavailable).
- **Drizzle schema (`lib/db/schema.ts`):** the `products` table using drizzle's `vector("embedding", { dimensions: 768 })` column type. *(Verify `vector` is exported by the installed `drizzle-orm` pg-core in the plan; if not, represent embedding via a `customType` — the raw migration owns the actual DDL either way.)*
- User-scoped: every read/write filters by session `userId`.

## Part B — Embeddings (`lib/ai/gemini.ts`)

- Add **`geminiEmbed(text: string): Promise<number[]>`** — POST to `models/text-embedding-004:embedContent` (768-dim), returns `data.embedding.values`. Same raw-`fetch` + `GEMINI_API_KEY` pattern as `geminiGenerate`.
- (Optional batch helper `geminiEmbedBatch(texts)` via `batchEmbedContents` to speed CSV import; loop as fallback.)
- Each product is embedded from **`name + "\n" + description`** (+ category) on create/import.
- No key → embedding is skipped (product still stored, just not searchable) so the app degrades gracefully.

## Part C — Import + manage (`lib/products/*`, `server-only` + `"use server"`)

- **`importProductsCsv(csvText): Promise<{ added: number; error?: string }>`** — parse CSV (header row → columns `name, description, price, category`; `name` required; unknown columns ignored; minimal quoted-field handling), embed each row, insert. Bounded per import (e.g. ≤200 rows) so it fits a serverless invocation; report the count.
- **`addProduct(fields)`** / **`deleteProduct(id)`** — manual add/remove (embed on add).
- **`listProducts(): ProductDTO[]`** — the user's catalog for the UI (no embedding vector in the DTO).
- Client-facing `"use server"` wrappers resolve `userId` from `getSession()`.

## Part D — Retrieval (the primitive agents use)

- **`searchProducts(userId, query: string, k = 5): Promise<ProductDTO[]>`** (`server-only`) — embed the `query`, then cosine top-K over the user's products via pgvector: `ORDER BY embedding <=> $queryVec LIMIT k` (raw `sql` with the query vector formatted as a pgvector literal). Skips rows without an embedding.
- This is the shared grounding primitive. **Module 2** wires it into the engines: Proposal retrieves products relevant to the lead/ask and quotes them; Outreach and Qualify can pull the catalog to reference real offerings. (Wiring lives in Spec 2 — this module just exposes `searchProducts`.)

## Part E — UI (`app/products/page.tsx` + nav)

- A **Products** module: sidebar nav item (`components/Shell.tsx`) + `/products` page.
- The page: a **CSV upload** control (reads the file client-side → `importProductsCsv`), a **manual add** form, and a **list/table** of products (name, category, price, description) with delete. A small note documenting the expected CSV columns + a downloadable/example header.

---

## File map

| File | Change |
|---|---|
| `lib/db/migrations/00NN_products.sql` | **new (hand-written)** — `CREATE EXTENSION vector`; `products` table; hnsw cosine index |
| `lib/db/schema.ts` | `products` table (with `vector(768)` embedding) + `ProductRow` type |
| `lib/ai/gemini.ts` | `geminiEmbed` (+ optional batch) |
| `lib/products/store.ts` | **new** (`server-only`) — `importProductsCsv`/`addProduct`/`deleteProduct`/`listProducts`/`searchProducts` |
| `lib/products/actions.ts` | **new** (`"use server"`) — client wrappers |
| `app/products/page.tsx` | **new** — CSV upload + manual add + list |
| `components/Shell.tsx` | Products nav item |

---

## Verification

No unit-test framework — `npx tsc --noEmit` clean + manual (one migration — `pnpm db:migrate`):

- **Migration:** `pnpm db:migrate` enables pgvector + creates `products` + the index (idempotent; safe on Neon).
- **Import:** upload a CSV (name/description/price/category) on the Products page → rows appear in the list; each gets an embedding (with `GEMINI_API_KEY` set).
- **Retrieval:** `searchProducts(userId, "<a query matching a product>")` returns the semantically closest products (cosine), user-scoped (User A never sees User B's catalog).
- **Manual add/delete** work; a product added without a Gemini key still stores (just isn't returned by search).
- `tsc` clean.

## Deferred (→ Spec 2 and beyond)

- Wiring `searchProducts` into Proposal / Outreach / Qualify engines (**Spec 2**).
- Re-embedding on edit; large-CSV chunked import (>200 rows); embedding-model/version migration.
- Per-product richer fields (SKU, URL, features) — the schema can grow later.
