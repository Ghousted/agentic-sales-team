# Matchmaker Capability — Implementation Plan (inline execution)

> **Execution:** inline in the working session — implement each task, `npx tsc --noEmit`, commit. Steps use `- [ ]`.

**Goal:** A `match` capability that pairs each lead with the catalog listings that fit (score + reason), viewable in a lead-detail modal that also shows all the lead's details.

**Architecture:** Twin of the Proposal module — capability + engine (`searchProducts` retrieve → Gemini rank/score/reason) + `matches` table + runner branch + chat routing; a new lead modal on the Leads page surfaces details + matches + drafts.

## Global Constraints
- No test runner; no working lint. Verify with `npx tsc --noEmit` from `agentic-salesforce/` (+ a scratchpad live-Gemini check for the engine). Do NOT add a test framework.
- Agent must NOT run `pnpm db:migrate` or any DB write. `pnpm db:generate` (offline codegen) IS allowed. The USER runs `pnpm db:migrate` for migration 0016.
- Commits: author Ghousted, no Co-Authored-By/Claude trailer, do not push. Branch `feat/sales-capabilities`.
- Match the codebase idioms (server-only libs, `geminiJSON` like `lib/ai/proposal.ts`, inline `css()`/`Box`/`Btn`).

---

## Task 1: Capability + agent type + intent + MatchResult

**Files:** `lib/agentTypes.ts`, `lib/ai/intent.ts`, `lib/leads/types.ts`

- Add `"match"` to `Capability` union.
- `CAPABILITIES` += `{ id: "match", label: "Matchmaking", desc: "Match leads to the catalog listings that fit them", jobKind: "match", engineReady: true }`.
- `AGENT_TYPES` += `{ id: "matchmaker", label: "Matchmaker", desc: "Matches leads to the listings that fit them.", capabilities: ["match"] }`; add `"match"` to the `closer` type's capabilities.
- `lib/ai/intent.ts`: add `"match"` to the `Intent.capability` union AND the `SCHEMA.properties.capability.enum` array; add prompt line `"- match: match existing leads to the products/listings in our catalog that fit them."`.
- `lib/leads/types.ts`: `export interface MatchResult { productId: string; score: number; reason: string }`.
- **Verify:** `npx tsc --noEmit`. **Commit:** `"Matchmaker: add match capability, matchmaker agent type, match intent + MatchResult type"`.

---

## Task 2: `matches` table + migration 0016

**Files:** `lib/db/schema.ts`, generated `lib/db/migrations/0016_*.sql`

- In `schema.ts` (after `proposals`):
```ts
export const matches = pgTable("matches", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull(),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  score: integer("score").notNull().default(0),
  reason: text("reason").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```
(`integer` is already imported in schema.ts; confirm and add to the drizzle import if missing.)
- Run `pnpm db:generate` → creates `0016_*.sql`. Verify the SQL creates the `matches` table with both FKs `on delete cascade`.
- **Verify:** `npx tsc --noEmit`. **Commit:** `"Matchmaker: matches table (lead↔product, score, reason) + migration 0016 — USER runs db:migrate"`. Tell the user to run `pnpm db:migrate`.

---

## Task 3: Engine + store + actions + listDraftsForLead

**Files:** `lib/ai/match.ts` (new), `lib/matches/store.ts` (new), `lib/matches/actions.ts` (new), `lib/leads/store.ts` + `lib/leads/actions.ts` (add `listDraftsForLead`)

- `lib/ai/match.ts` — `matchLead(agent: AgentSnapshot, lead: { name; title; company; research }, listings: ProductDTO[]): Promise<MatchResult[]>`. One `geminiJSON` call (schema `{ matches: [{ productId, score, reason }] }`), system prompt: given the lead's intent and the numbered candidate listings (id | name | price | category | key attributes), return only listings that genuinely fit, best first, score 0–100, reason one line. Use `productId` ONLY from the list. Guards: `!isGeminiConfigured() || listings.length === 0` → `[]`; validate productIds ∈ listings; clamp score; `try/catch → []`.
- `lib/matches/store.ts`:
  - `MatchDTO { id, leadId, productId, score, reason, productName, productPrice, productCategory, createdAt }`.
  - `pickLeadsForMatch(userId, agentId, leadIds, batchSize)` — accepted teammate leads (`teammatesOf`) with NO existing match row, oldest first, capped; guard `isDbConfigured` first. (Standalone query; select leads, left-anti-join matches by leadId.)
  - `addMatches(userId, agentId, leadId, results)` — bulk insert (skip empty).
  - `listMatchesForLead(userId, leadId)` — join `matches`→`products`, `desc(score)`; map to `MatchDTO`.
- `lib/matches/actions.ts` — `use server` `listMatchesForLead(leadId)` (session `uid()`).
- `lib/leads/store.ts` — `listDraftsForLead(leadId)`: same select as `listDraftsForAgent` but `where(userId, outreachDrafts.leadId = leadId)`; `lib/leads/actions.ts` wrapper.
- **Verify:** `npx tsc --noEmit` + scratchpad live-Gemini check of `matchLead` (fixture lead + listings → fitting ids, scores, no foreign ids). **Commit:** `"Matchmaker: matchLead engine + matches store/actions (pick/add/list) + listDraftsForLead"`.

---

## Task 4: Runner branch + chat routing + done-message

**Files:** `app/api/jobs/run/route.ts`, `lib/chat/orchestrate.ts`, `lib/chat/actions.ts`, `lib/store.tsx`

- `route.ts`: add `"match"` to the claimable `inArray(jobs.kind, [...])`; import `pickLeadsForMatch, addMatches` (matches/store), `matchLead` (ai/match). Branch after `proposal`:
```ts
} else if (candidate.kind === "match") {
  const batch = await pickLeadsForMatch(userId, params.agent.id, params.leadIds ?? undefined, params.batchSize ?? 5);
  for (const lead of batch) {
    try {
      const listings = await searchProducts(userId, [lead.title, lead.company, lead.research?.summary].filter(Boolean).join(" ") || lead.company || lead.name, 8);
      const m = await matchLead(params.agent, { name: lead.name, title: lead.title, company: lead.company, research: lead.research }, listings);
      await addMatches(userId, params.agent.id, lead.id, m);
      created++;
    } catch (e) { console.error("[jobs/run] match failed:", e); failed++; }
  }
  await db.update(jobs).set({ status: "done", finishedAt: new Date(), result: { matched: created, failed } }).where(and(eq(jobs.id, candidate.id), eq(jobs.userId, userId)));
}
```
- `lib/chat/orchestrate.ts`: `actWith` verb `match → "matching leads to listings"`; `describeWork` `doing` map add `match → "matching leads to listings"` and the done `summary` add `match → \`matched ${r.matched ?? 0} lead…\`` (extend the `r` type with `matched?: number`).
- `lib/chat/actions.ts`: add `"match"` to `LEAD_CAPS`.
- `lib/store.tsx`: team-chat poll done-message — extend result type with `matched?: number`; `res.job!.kind === "match"` → `I matched ${r.matched ?? 0} lead${…}${" to listings"}.`
- **Verify:** `npx tsc --noEmit`. **Commit:** `"Matchmaker: runner match branch + chat routing (verb, LEAD_CAPS, done-message)"`.

---

## Task 5: Lead detail modal

**Files:** `app/leads/page.tsx`

- Add state `openLead: LeadDTO | null`, `leadMatches: MatchDTO[]`, `leadDrafts: DraftDTO[]`. On row click (active + pending), `setOpenLead(l)` and fetch `listMatchesForLead(l.id)` + `listDraftsForLead(l.id)`.
- Make the lead cells clickable (cursor pointer) without hijacking the existing action buttons (stopPropagation on the action `<Btn>`s / the Accept-Dismiss / Run-outreach cells).
- Modal (mirror the Add-lead modal wrapper: fixed backdrop, click-away close, ✕): header (name + contact: email mailto, profile link platform-labeled, platform badge, company); meta chips (score, stage, source, review); Intent (`title`); Research block (if `research`): summary, priorities, hooks, angle; **Matches** (each: name · price · category, score chip, reason; empty state); **Drafts** (subject + Open in mail (mailto) / Copy).
- Import `listMatchesForLead` (`@/lib/matches/actions`), `listDraftsForLead` (`@/lib/leads/actions`), `MatchDTO` (`@/lib/matches/store`), `DraftDTO` (`@/lib/leads/types`).
- **Verify:** `npx tsc --noEmit`. **Commit:** `"Leads: lead detail modal — full details + Matchmaker matches + drafts, opened on row press"`.

---

## Self-Review
- Spec coverage: capability/type/intent (T1), table/migration (T2), engine/store/drafts (T3), runner/chat (T4), modal (T5) — all mapped. ✅
- Migration is the user's; agent only `db:generate`. ✅
- `matches` auto-exported via `export * from "./schema"` (no index edit). ✅
- Idempotent re-runs via `pickLeadsForMatch` (no-existing-match filter). ✅
