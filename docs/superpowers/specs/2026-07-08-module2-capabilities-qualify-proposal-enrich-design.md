# Module 2 — Capabilities that use the catalog: Qualify + Proposal + Enrich + Outreach grounding

Add the sales capabilities that consume the Products & Services catalog (Module 1). **Qualify** (real) scores/triages the book. **Proposal** (real) generates a scoped, priced proposal for a lead **grounded in the real catalog** via `searchProducts` — stored in a dedicated `proposals` table. **Outreach** is upgraded to reference real products too. **Enrich** is a placeholder (next-real).

> Supersedes the earlier capabilities spec (`2026-07-08-sales-capabilities-qualify-plus-placeholders-design.md`). Reuses: the capability model (`lib/agentTypes.ts`, id === `jobs.kind`, `engineReady` gates), the job runner, the leads store, the chat intent/routing, and `searchProducts` (Module 1). `qualify` reuses the `score` column + `lead_qualified` activity type — no schema change for Qualify. Proposal needs one new table.

---

## New capabilities

| id | label | engineReady | uses catalog |
|---|---|---|---|
| `qualify` | Lead qualification | **true** | no — scores leads |
| `proposal` | Proposal drafting | **true** | **yes** — RAG-grounded in products |
| `enrich` | Contact enrichment | false | (placeholder; next-real) |

Add all three to `Capability`, `CAPABILITIES`, and the intent enum. Outreach also gains catalog grounding (no new capability — an upgrade to the existing engine).

---

## Part A — Catalog (`lib/agentTypes.ts`)

- Extend `Capability` union: `+ "qualify" | "proposal" | "enrich"`.
- Add `CAPABILITIES` entries: `qualify` (jobKind `qualify`, engineReady true), `proposal` (jobKind `proposal`, engineReady true), `enrich` (jobKind `enrich`, engineReady false).
- Agent types: add **`qualifier`** (`["qualify"]`), **`closer`** ("Closer — researches, qualifies, and sends proposals", `["research","qualify","proposal"]`); add `qualify` to `sdr` and `proposal` to `ae`.
- Team template: add **`revenue`** ("Qualify → Propose", requiredCapabilities `["qualify","proposal"]`).

## Part B — Qualify engine (real; no migration)

- **`lib/ai/qualify.ts`** (`server-only`): `qualifyLead(agent, lead: {name;title;company;email;research?}) → QualifyResult` where **`QualifyResult = { score: number /*1-100*/; tier: "hot"|"warm"|"cold"; reason: string }`** (add to `lib/leads/types.ts`). One `geminiJSON` call scoring ICP-fit/intent from title/company (+ research brief when present); `score` clamped ≥1 so `0` still means "not yet qualified". Canned fallback when Gemini off.
- **Leads store (`lib/leads/store.ts`):**
  - `pickLeadsForQualify(userId, agentId, leadIds?, batchSize)` — accepted teammate leads with `score = 0`, oldest first, capped (idempotent).
  - `applyQualifyResult(userId, agentId, lead, result)` — set `leads.score = max(1, result.score)`; log `activity` `lead_qualified` with the reason. Tier derived from score at display (no column).

## Part C — Proposal engine (real, RAG-grounded; new `proposals` table)

- **Migration:** `proposals` table — `id` uuid PK, `user_id` → users cascade, `agent_id` text, `lead_id` uuid → leads cascade, `title` text, `body` text, `products` jsonb `string[]` (the product names/prices cited, for display/audit), `status` text default `"draft"` (draft|sent), `created_at`, `sent_at` (nullable). Drizzle schema + hand-generated migration (plain, no pgvector).
- **`lib/ai/proposal.ts`** (`server-only`): `draftProposal(agent, lead: {name;title;company;research?}, products: ProductDTO[]) → ProposalResult` where **`ProposalResult = { title: string; body: string; productsUsed: string[] }`**. One `geminiJSON` call; the prompt is given the retrieved `products` (name/price/description) and instructed to build a proposal **using only those real offerings + prices** (never invent products/pricing); `productsUsed` echoes which it referenced. Fallback when Gemini off. Pure — no DB (products are passed in).
- **Proposals store (`lib/proposals/store.ts`, server-only + actions):** `ProposalDTO`, `listProposalsForAgent(agentId)`, `addProposal(userId, agentId, leadId, result)`, `markProposalSent(id)`, `pickLeadsForProposal(userId, agentId, leadIds?, batchSize)` (accepted teammate leads **without an existing proposal**, oldest first, capped). Client `"use server"` wrappers.

## Part D — Outreach catalog grounding (upgrade)

- **`lib/ai/outreach.ts`:** `draftOutreach` gains an optional `products?: ProductDTO[]` arg; the system prompt gets a "Relevant offerings (reference the real product/price when natural)" block built from them. No behavior change when empty (backward compatible).

## Part E — Runner + retrieval wiring (`app/api/jobs/run/route.ts`)

- Claim kinds `+ "qualify", "proposal"` (`inArray(jobs.kind, ["outreach","research","qualify","proposal"])`). Scrape stays worker/route-owned; enrich (not ready) never enqueues.
- **`qualify` branch:** `pickLeadsForQualify` → `qualifyLead` → `applyQualifyResult`; done `{ qualified, failed }`.
- **`proposal` branch:** for each `pickLeadsForProposal` lead → build a retrieval query from the lead (title + company + research summary) → `searchProducts(userId, query, 5)` → `draftProposal(agent, lead, products)` → `addProposal`; done `{ proposals, failed }`.
- **`outreach` branch (upgrade):** before drafting each lead, `searchProducts(userId, <lead query>, 3)` → pass to `draftOutreach(agent, lead, products)`. (Retrieval is best-effort; empty catalog → unchanged behavior.)
- Pod chaining unaffected (`POD_ORDER` untouched; qualify/proposal run on demand).

## Part F — Chat intent + routing (`lib/ai/intent.ts`)

- Add `qualify`, `proposal`, `enrich` to the enum + one prompt line each (qualify: "score/prioritize existing leads hot/warm/cold"; proposal: "draft a proposal/quote for a lead using our products"; enrich: "fill in missing contact info"). Routing already handles the rest: `qualify`/`proposal` → a capable agent runs it; `enrich` (not ready) → the existing "coming soon" reply.

## Part G — Agent detail UI (`app/agents/[id]/page.tsx`)

- **Qualify:** for a `qualify`-capable agent, a **"Qualify leads"** action (mirrors `runResearch`) + a **tier chip** on each lead in the Leads section derived from `score` (`≥75` Hot / `≥50` Warm / `>0` Cold / `0` "—").
- **Proposal:** a capability-gated **"Proposals"** section (like Emails/Research): a **"Generate proposals"** action + a list of generated proposals (title, lead, the products cited as chips, body, **Mark sent**). Add `"proposal"` to the `SECTIONS` map with its capability gate.

---

## File map

| File | Change |
|---|---|
| `lib/agentTypes.ts` | 3 capabilities; `qualifier`/`closer` types; `qualify`→sdr, `proposal`→ae; `revenue` template |
| `lib/leads/types.ts` | `QualifyResult`, `ProposalResult` |
| `lib/ai/qualify.ts` | **new** — `qualifyLead` engine |
| `lib/ai/proposal.ts` | **new** — `draftProposal` engine (RAG-grounded) |
| `lib/ai/outreach.ts` | optional `products` grounding |
| `lib/leads/store.ts` | `pickLeadsForQualify` + `applyQualifyResult` |
| `lib/db/schema.ts` + migration | **new** `proposals` table |
| `lib/proposals/store.ts` + `actions.ts` | **new** — proposals CRUD + `pickLeadsForProposal` |
| `app/api/jobs/run/route.ts` | claim + branches for `qualify`/`proposal`; outreach grounding |
| `lib/ai/intent.ts` | `qualify`/`proposal`/`enrich` in enum + prompt |
| `app/agents/[id]/page.tsx` | Qualify action + tier chips; Proposals section + action |

---

## Verification

No unit-test framework — `npx tsc --noEmit` clean + manual (**one migration — user runs `pnpm db:migrate`**):

- **Qualify:** on a qualify agent with accepted (unscored) leads, "Qualify leads" → real scores + tier chips; `lead_qualified` activity with reasons; re-run skips already-scored.
- **Proposal (grounded):** with products in the catalog, "Generate proposals" on an agent → a proposal per lead citing **real product names + prices** (verify against the catalog); stored in `proposals`, shown in the Proposals section with product chips; Mark sent works. With an empty catalog → a generic proposal (no invented products).
- **Outreach grounding:** with products present, a run's drafts reference a real offering; empty catalog → unchanged.
- **Chat:** `@agent qualify the leads` / `@agent draft a proposal for <lead>` run the real engines; `@agent enrich these` → "coming soon."
- **Scoping:** proposals/qualify are userId-scoped; another user never sees them. Placeholders enqueue nothing.
- `tsc` clean.

## Deferred

- Real `enrich` (Firecrawl lookup to fill missing email/title/company) — next.
- Proposal send (PDF/email) — Mark-sent only for now.
- A pod stage for qualify/proposal (auto-chain research→qualify→proposal) — on-demand this slice.
- Product/pricing config for tone; embedding `taskType` retrieval tuning.
