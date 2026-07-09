# Matchmaker capability + lead detail modal

**Date:** 2026-07-09
**Status:** Approved (design)

## Problem

The app has a Products/Inventory catalog (pgvector RAG) and a book of leads with
intent (title + research brief), but nothing connects them. A salesperson wants to
know, for a given lead, **which of their listings actually fit** — and to see that
alongside everything else about the lead in one place.

## Goals

- A new **`match`** capability: for each lead, produce a ranked shortlist of the
  catalog listings that fit the lead's intent, each with a **fit score (0–100)** and
  a **one-line reason**.
- Pressing a lead anywhere it's listed opens a **modal** showing **all** of that
  lead's details **and** its matches.

## Non-goals

- No auto-drafting a proposal/email from a match (a natural later step).
- No "listing → best leads" direction (matches are lead → listings, per the ask).
- No new top-level nav page; matches live in the lead modal.

## Architecture

Mirrors the Proposal module (Module 2): a capability + engine + a table + a runner
branch + chat routing. Retrieval reuses `searchProducts` (pgvector); Gemini reranks,
scores, and explains fit. A new lead-detail modal on the Leads page surfaces the
lead's fields, research, drafts, and matches.

### 1. Capability, agent type, intent (`lib/agentTypes.ts`, `lib/ai/intent.ts`)

- Add `"match"` to the `Capability` union and a `CAPABILITIES` entry:
  `{ id: "match", label: "Matchmaking", desc: "Match leads to fitting catalog listings", jobKind: "match", engineReady: true }`.
- Add a `matchmaker` agent type: `{ id: "matchmaker", label: "Matchmaker", desc: "Matches leads to the listings that fit them.", capabilities: ["match"] }`, and add `"match"` to the `closer` type's capabilities.
- `lib/ai/intent.ts`: add `"match"` to the `Intent.capability` enum + schema enum, and a routing line: `"- match: match existing leads to the products/listings in the catalog that fit them."`

### 2. `matches` table (`lib/db/schema.ts` + migration 0016)

```
matches (
  id uuid pk default random,
  user_id uuid not null → users(id) on delete cascade,
  agent_id text not null,
  lead_id uuid not null → leads(id) on delete cascade,
  product_id uuid not null → products(id) on delete cascade,
  score integer not null default 0,     -- 0..100 fit
  reason text not null default '',
  created_at timestamptz not null default now()
)
```

Generated offline with `pnpm db:generate`; the **user runs `pnpm db:migrate`** (the
agent is blocked from DB writes). Deleting a lead or a product cascades its matches.

### 3. Match result type + engine (`lib/leads/types.ts`, `lib/ai/match.ts`)

- `lib/leads/types.ts`: `export interface MatchResult { productId: string; score: number; reason: string }`.
- `lib/ai/match.ts`: `matchLead(agent, lead, listings): Promise<MatchResult[]>`.
  - `lead`: `{ name, title, company, research }`; `listings`: `ProductDTO[]` (the retrieved candidates).
  - One Gemini JSON call: given the lead's intent and the numbered candidate listings
    (id, name, price, category, key attributes), return `{ matches: [{ productId, score, reason }] }`
    — only listings that genuinely fit, best first, `score` 0–100, `reason` one line
    tying the listing to the lead's need. `productId` **only** from the provided list.
  - Guards: empty `listings` or no Gemini → `[]`. Validate returned `productId`s
    against the candidate set; clamp score 0–100; cap to the candidate count.
    Never throw (catch → `[]`).

### 4. Store (`lib/matches/store.ts`, `lib/matches/actions.ts`)

- `MatchDTO { id, leadId, productId, score, reason, productName, productPrice, productCategory, createdAt }`.
- `pickLeadsForMatch(userId, agentId, leadIds?, batchSize)` — accepted teammate
  leads with **no matches yet** (idempotent re-runs), oldest first, capped. Standalone
  query (guard `isDbConfigured` first).
- `addMatches(userId, agentId, leadId, results: MatchResult[])` — bulk-insert the
  match rows for a lead (skip if empty).
- `listMatchesForLead(userId, leadId): Promise<MatchDTO[]>` — the lead's matches
  joined to `products` (name/price/category), highest score first.
- `lib/matches/actions.ts`: `use server` wrapper `listMatchesForLead(leadId)`
  (session-scoped). (`pickLeadsForMatch`/`addMatches` are runner-only, not exposed.)

### 5. Runner branch (`app/api/jobs/run/route.ts`)

Claim `"match"` (add to the `inArray` kinds). Branch:
```
const batch = await pickLeadsForMatch(userId, agent.id, leadIds, batchSize);
for (const lead of batch) {
  const listings = await searchProducts(userId, [lead.title, lead.company, lead.research?.summary].filter(Boolean).join(" ") || lead.name, 8);
  const matches = await matchLead(agent, { name, title, company, research }, listings);
  await addMatches(userId, agent.id, lead.id, matches);
  created++;
}
// job result: { matched: created, failed }
```

### 6. Chat routing (`lib/chat/orchestrate.ts`, `lib/store.tsx`)

- `actWith` verb + `describeWork` "doing" label: `match` → "matching leads to listings".
- `teamChat` already enqueues any resolved capability; `match` is lead-consuming, so
  `/lead` picks flow to it via the existing `LEAD_CAPS` set — add `"match"` to `LEAD_CAPS`.
- `lib/store.tsx` team-chat poll done-message: `match` → "I matched N leads to listings."

### 7. Lead detail modal (`app/leads/page.tsx`)

Pressing a lead row (active book **and** pending candidates) opens a modal:
- **Header:** name; contact — email (mailto link) and/or profile link (platform-labeled) + platform badge; company.
- **Meta:** score, stage, source, review status chips.
- **Intent:** `title`.
- **Research** (if present): summary, priorities, hooks, angle.
- **Matches:** each matched listing — name · price · category, a score chip, and the
  reason. Empty state: "No matches yet — ask a Matchmaker to match this lead." Loaded
  via `listMatchesForLead(lead.id)` when the modal opens.
- **Drafts** (if any): this lead's outreach drafts — subject + "Open in mail"/"Copy",
  via a new `listDraftsForLead(leadId)` (mirrors `listDraftsForAgent` filtered by lead).
- Closes on backdrop click / ✕ (same pattern as the Add-lead modal).

## Data flow

```
Chat: "@Matchmaker match my leads to listings" (or /lead-picked)
 → teamChat → match job → /api/jobs/run
   → pickLeadsForMatch → for each lead: searchProducts(intent, 8) → matchLead (Gemini rank/score/reason) → addMatches
 → "I matched N leads to listings."
Leads page: press a lead → modal → listMatchesForLead(lead.id) → shows the ranked listings + score + reason, alongside all lead details.
```

## Testing

- **tsc** clean.
- **Headless (scratchpad .mjs, live Gemini):** `matchLead` prompt against a fixture
  lead ("2BR condo Makati ≤10M") + fixture listings → returns fitting productIds with
  sensible scores/reasons, drops non-fitting ones, and never returns a productId
  outside the candidate set.
- **Manual, in-app (primary):** import/scrape leads + add catalog listings; run
  Matchmaker (chat or /lead pick); press a lead → modal shows all details + the ranked
  matches with scores and reasons; a lead with no fitting listings shows the empty
  state. Migration 0016 applied.

## Files

- `lib/agentTypes.ts` — `match` capability + `matchmaker` type (+ closer).
- `lib/ai/intent.ts` — `match` intent.
- `lib/db/schema.ts` (+ migration 0016) — `matches` table.
- `lib/leads/types.ts` — `MatchResult`.
- `lib/ai/match.ts` — `matchLead`.
- `lib/matches/store.ts`, `lib/matches/actions.ts` — pick/add/list + `listDraftsForLead` (in leads/store + actions).
- `app/api/jobs/run/route.ts` — `match` branch.
- `lib/chat/orchestrate.ts`, `lib/store.tsx` — verbs + `LEAD_CAPS` + done-message.
- `app/leads/page.tsx` — lead detail modal.
