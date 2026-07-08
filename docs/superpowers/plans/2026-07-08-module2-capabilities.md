# Module 2 — Capabilities (Qualify + Proposal + Enrich + Outreach grounding) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the sales capabilities that use the Products catalog — Qualify (real triage), Proposal (real, RAG-grounded in the catalog, stored in a new `proposals` table), Outreach grounded in the catalog, and Enrich as a placeholder.

**Architecture:** New Gemini engines (`qualify`, `proposal`) mirror the existing `research`/`outreach` engines; the Node job runner gains `qualify`/`proposal` branches and grounds proposal+outreach via `searchProducts` (Module 1). Proposals live in a dedicated table + store + agent-detail section. Enrich is catalog+intent only (rides the existing `engineReady:false` "coming soon" path).

**Tech Stack:** Next.js 14 / TypeScript / Drizzle / Neon / Gemini (existing) + `searchProducts` (Module 1).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-08-module2-capabilities-qualify-proposal-enrich-design.md`.
- **Git identity:** commit as the user only — `Ghousted <clydepadua091@gmail.com>`. **Never** a `Co-Authored-By: Claude` / AI-attribution line.
- **No push.** `.env.local` gitignored.
- **No unit-test framework.** Verification is `npx tsc --noEmit` (from `agentic-salesforce/`) clean + code review + manual.
- **One migration** (the `proposals` table). **`pnpm db:migrate` is the USER's step** (DB write, blocked for the agent). Tasks build the migration file; do NOT run `db:migrate`.
- **User-scoping:** every read/write filters by session `userId`.
- **Degrade gracefully:** no Gemini key → engines return canned fallbacks; empty catalog → grounding is a no-op.
- **Capability id === jobs.kind**; `engineReady:false` (enrich) routes but enqueues nothing.

---

## File Structure

- `lib/agentTypes.ts` — MODIFY: 3 capabilities, 2 types, 1 template.
- `lib/leads/types.ts` — MODIFY: `QualifyResult`, `ProposalResult`.
- `lib/ai/intent.ts` — MODIFY: enum + prompt lines.
- `lib/ai/qualify.ts` — CREATE: `qualifyLead`.
- `lib/ai/proposal.ts` — CREATE: `draftProposal`.
- `lib/ai/outreach.ts` — MODIFY: optional `products` grounding.
- `lib/leads/store.ts` — MODIFY: `pickLeadsForQualify` + `applyQualifyResult`.
- `lib/db/schema.ts` + migration — CREATE: `proposals` table.
- `lib/proposals/store.ts` + `lib/proposals/actions.ts` — CREATE.
- `app/api/jobs/run/route.ts` — MODIFY: claim + branches + grounding.
- `app/agents/[id]/page.tsx` — MODIFY: Qualify action + tier chips; Proposals section.

---

## Task 1: Catalog + result types + intent

**Files:** Modify `lib/agentTypes.ts`, `lib/leads/types.ts`, `lib/ai/intent.ts`.

**Interfaces:** Produces the 3 new capabilities/types/template; `QualifyResult`, `ProposalResult`; the extended intent enum. Nothing consumes the engines yet — tsc stays green.

- [ ] **Step 1: `lib/agentTypes.ts` — capabilities.** Change the `Capability` union to add the three ids:

```ts
export type Capability = "scrape" | "outreach" | "follow-up" | "book-meeting" | "research" | "qualify" | "proposal" | "enrich";
```

Add these entries to the `CAPABILITIES` array (after `book-meeting`):

```ts
  { id: "qualify", label: "Lead qualification", desc: "Score & prioritize the book (hot/warm/cold)", jobKind: "qualify", engineReady: true },
  { id: "proposal", label: "Proposal drafting", desc: "Draft a scoped, priced proposal from your catalog", jobKind: "proposal", engineReady: true },
  { id: "enrich", label: "Contact enrichment", desc: "Fill in missing contact info & firmographics", jobKind: "enrich", engineReady: false },
```

- [ ] **Step 2: `lib/agentTypes.ts` — types + template.** Add two `AGENT_TYPES` entries (before `custom`):

```ts
  { id: "qualifier", label: "Lead Qualifier", desc: "Scores & triages the book so the team works the best leads first.", capabilities: ["qualify"] },
  { id: "closer", label: "Closer", desc: "Researches, qualifies, and sends proposals grounded in your catalog.", capabilities: ["research", "qualify", "proposal"] },
```

Add `"qualify"` to the `sdr` type's capabilities and `"proposal"` to the `ae` type's capabilities (edit those two lines). Add one `TEAM_TEMPLATES` entry (before `custom`):

```ts
  { id: "revenue", label: "Qualify → Propose", desc: "Prioritize the book and send proposals.", requiredCapabilities: ["qualify", "proposal"] },
```

- [ ] **Step 3: `lib/leads/types.ts` — result types.** Append:

```ts
export interface QualifyResult {
  score: number; // 1-100
  tier: "hot" | "warm" | "cold";
  reason: string;
}

export interface ProposalResult {
  title: string;
  body: string;
  productsUsed: string[];
}
```

- [ ] **Step 4: `lib/ai/intent.ts` — enum + prompt.** Add `qualify`, `proposal`, `enrich` to BOTH the `Intent.capability` union type and the `SCHEMA` enum array (place before `"status"`). Then add three lines to `systemPrompt`'s capability list (after the `book-meeting` line):

```ts
    "- qualify: score/prioritize EXISTING leads (hot/warm/cold) — not new leads.",
    "- proposal: draft a proposal or quote for a lead using our products/pricing.",
    "- enrich: fill in a lead's missing contact info (email, title, company).",
```

- [ ] **Step 5: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors.

- [ ] **Step 6: Commit.**

```bash
git add agentic-salesforce/lib/agentTypes.ts agentic-salesforce/lib/leads/types.ts agentic-salesforce/lib/ai/intent.ts
git commit -m "Module2: add qualify/proposal/enrich capabilities, result types, intent routing"
```

---

## Task 2: Qualify engine + leads-store pick/apply

**Files:** Create `lib/ai/qualify.ts`; Modify `lib/leads/store.ts`.

**Interfaces:**
- Consumes: `geminiJSON`/`isGeminiConfigured` (`@/lib/ai/gemini`); `AgentSnapshot`/`QualifyResult`/`ResearchBrief` (`@/lib/leads/types`).
- Produces: `qualifyLead(agent, lead) → QualifyResult`; `pickLeadsForQualify(userId, agentId, leadIds?, batchSize) → LeadDTO[]`; `applyQualifyResult(userId, agentId, lead, result)`.

- [ ] **Step 1: Write `lib/ai/qualify.ts`.**

```ts
import "server-only";
// Lead qualification: score a lead's ICP-fit/intent (hot/warm/cold) from its
// title/company (+ research brief when present). One Gemini JSON call. Pure — no DB.
import { geminiJSON, isGeminiConfigured, type Turn } from "./gemini";
import type { AgentSnapshot, QualifyResult, ResearchBrief } from "@/lib/leads/types";

const SCHEMA = {
  type: "object",
  properties: {
    score: { type: "integer" },
    tier: { type: "string", enum: ["hot", "warm", "cold"] },
    reason: { type: "string" },
  },
  required: ["score", "tier", "reason"],
} as const;

const clampTier = (s: number): QualifyResult["tier"] => (s >= 75 ? "hot" : s >= 50 ? "warm" : "cold");

export async function qualifyLead(
  agent: AgentSnapshot,
  lead: { name: string; title: string; company: string; email: string; research?: ResearchBrief | null },
): Promise<QualifyResult> {
  if (!isGeminiConfigured()) {
    const s = lead.email ? 60 : 45;
    return { score: s, tier: clampTier(s), reason: "Heuristic score (Gemini not configured)." };
  }
  const system = [
    `You are ${agent.name}, qualifying B2B sales leads for: ${agent.goal}.`,
    "Score this lead 1-100 for ICP fit + buying intent, assign a tier (hot ≥75, warm 50-74, cold <50),",
    "and give a one-sentence reason. Judge from title (seniority/role fit), company, and any research. Return ONLY JSON.",
  ].join("\n");
  const rb = lead.research ? `\nResearch: ${lead.research.summary}; priorities: ${(lead.research.priorities || []).join("; ")}` : "";
  const turns: Turn[] = [{ role: "user", text: `Name: ${lead.name}\nTitle: ${lead.title || "(unknown)"}\nCompany: ${lead.company || "(unknown)"}\nHas email: ${lead.email ? "yes" : "no"}${rb}` }];
  try {
    const r = await geminiJSON<QualifyResult>(system, turns, SCHEMA as unknown as Record<string, unknown>, { maxTokens: 300, temperature: 0.3 });
    const score = Math.max(1, Math.min(100, Math.round(r.score ?? 50)));
    return { score, tier: r.tier ?? clampTier(score), reason: (r.reason ?? "").trim() || "Qualified." };
  } catch {
    const s = lead.email ? 60 : 45;
    return { score: s, tier: clampTier(s), reason: "Heuristic score (qualification failed)." };
  }
}
```

- [ ] **Step 2: `lib/leads/store.ts` — pick + apply.** First READ the file to match the exact idiom of `pickLeadsForResearch`/`applyResearchResult` (the `uid`/`getDb`/`toLeadDTO(s)` helpers, the `activity` insert shape, imports). Then add, mirroring `pickLeadsForResearch` but filtering unscored leads:

```ts
// Accepted teammate leads not yet qualified (score = 0), oldest first, capped.
export async function pickLeadsForQualify(userId: string, agentId: string, leadIds: string[] | undefined, batchSize: number): Promise<LeadDTO[]> {
  const rows = await pickLeadsForResearch(userId, agentId, leadIds, batchSize + 20); // reuse team-expansion + accepted filter
  return rows.filter((l) => (l.score ?? 0) === 0).slice(0, batchSize);
}

export async function applyQualifyResult(userId: string, agentId: string, lead: LeadDTO, result: { score: number; tier: string; reason: string }): Promise<void> {
  if (!isDbConfigured()) return;
  const db = getDb();
  const score = Math.max(1, Math.min(100, Math.round(result.score)));
  await db.update(leads).set({ score, updatedAt: new Date() }).where(and(eq(leads.userId, userId), eq(leads.id, lead.id)));
  await db.insert(activity).values({ userId, agentId, type: "lead_qualified", leadId: lead.id, text: `Qualified ${lead.name} — ${result.tier} (${score}): ${result.reason}`.slice(0, 400) });
}
```

> NOTE: `pickLeadsForResearch` filters leads *without a research brief*, which is the wrong filter for qualify. If reading the file shows that coupling is unsuitable, instead write a standalone `pickLeadsForQualify` that mirrors `pickLeadsForResearch`'s query (team-expanded via `teammatesOf`, `review='accepted'`) but filters `score = 0` (drizzle `eq(leads.score, 0)`) rather than null-research. Prefer the standalone query if `pickLeadsForResearch`'s research-null filter would exclude valid unqualified leads. (`activity`/`leads`/`and`/`eq` are already imported in the file.)

- [ ] **Step 3: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors.

- [ ] **Step 4: Commit.**

```bash
git add agentic-salesforce/lib/ai/qualify.ts agentic-salesforce/lib/leads/store.ts
git commit -m "Module2: qualify engine + pickLeadsForQualify/applyQualifyResult (score + lead_qualified)"
```

---

## Task 3: `proposals` table (schema + migration)

**Files:** Modify `lib/db/schema.ts`; Create a migration.

**Interfaces:** Produces the `proposals` table + `ProposalRow` type.

- [ ] **Step 1: Add to `lib/db/schema.ts`** (after `outreachDrafts` or near the products tables):

```ts
export const proposals = pgTable("proposals", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull(),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  products: jsonb("products").$type<string[]>().notNull().default([]),
  status: text("status").notNull().default("draft"), // draft|sent
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
});
export type ProposalRow = typeof proposals.$inferSelect;
```

- [ ] **Step 2: Generate.** `cd agentic-salesforce && pnpm db:generate` (offline). It writes a new `lib/db/migrations/00NN_*.sql` (plain CREATE TABLE + 2 FKs — no pgvector) + updates the snapshot/journal. If it errors/prompts, STOP and report BLOCKED.

- [ ] **Step 3: Verify the migration.** Open the generated `00NN_*.sql`; confirm it creates `proposals` with the columns above + FKs to `users` (cascade) and `leads` (cascade), statements breakpoint-separated. No hand-editing needed (no pgvector). **Do NOT run `pnpm db:migrate`.**

- [ ] **Step 4: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors.

- [ ] **Step 5: Commit.**

```bash
git add agentic-salesforce/lib/db/schema.ts agentic-salesforce/lib/db/migrations/
git commit -m "Module2: proposals table (migration)"
```

---

## Task 4: Proposal engine + proposals store/actions

**Files:** Create `lib/ai/proposal.ts`, `lib/proposals/store.ts`, `lib/proposals/actions.ts`.

**Interfaces:**
- Consumes: `geminiJSON`/`isGeminiConfigured`; `AgentSnapshot`/`ProposalResult` (`@/lib/leads/types`); `ProductDTO` (`@/lib/products/store`); `proposals`/`leads` tables; `teammatesOf` (for team-expanded pick).
- Produces: `draftProposal(agent, lead, products) → ProposalResult`; `ProposalDTO`, `listProposalsForAgent(userId, agentId)`, `addProposal(userId, agentId, leadId, result)`, `markProposalSent(userId, id)`, `pickLeadsForProposal(userId, agentId, leadIds?, batchSize)`; `"use server"` wrappers.

- [ ] **Step 1: Write `lib/ai/proposal.ts`.**

```ts
import "server-only";
// Proposal drafting, grounded in the real product catalog (RAG): the caller
// passes the products retrieved via searchProducts; the model must use ONLY
// those real offerings + prices. One Gemini JSON call. Pure — no DB.
import { geminiJSON, isGeminiConfigured, type Turn } from "./gemini";
import type { AgentSnapshot, ProposalResult, ResearchBrief } from "@/lib/leads/types";
import type { ProductDTO } from "@/lib/products/store";

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    body: { type: "string" },
    productsUsed: { type: "array", items: { type: "string" } },
  },
  required: ["title", "body", "productsUsed"],
} as const;

export async function draftProposal(
  agent: AgentSnapshot,
  lead: { name: string; title: string; company: string; research?: ResearchBrief | null },
  products: ProductDTO[],
): Promise<ProposalResult> {
  const catalog = products.map((p) => `- ${p.name}${p.price ? " (" + p.price + ")" : ""}${p.description ? ": " + p.description : ""}`).join("\n");
  if (!isGeminiConfigured()) {
    return {
      title: `Proposal for ${lead.company || lead.name}`,
      body: `Hi ${lead.name.split(" ")[0]},\n\nBased on your needs, we recommend:\n${catalog || "(add products to your catalog to tailor this)"}\n\nHappy to walk through details.\n\n— ${agent.name}`,
      productsUsed: products.map((p) => p.name),
    };
  }
  const system = [
    `You are ${agent.name}, writing a concise B2B sales proposal for a prospect.`,
    "Use ONLY the offerings below — real product names and prices. Never invent products or pricing.",
    "Produce: a short title, and a body (150-250 words) with a brief intro, 2-4 recommended offerings (name + price) mapped to the prospect's likely needs, and a soft next step.",
    "List the exact product names you referenced in productsUsed. Return ONLY JSON.",
    "\nAvailable offerings:\n" + (catalog || "(none — write a brief generic proposal and leave productsUsed empty)"),
  ].join("\n");
  const rb = lead.research ? `\nResearch: ${lead.research.summary}; priorities: ${(lead.research.priorities || []).join("; ")}` : "";
  const turns: Turn[] = [{ role: "user", text: `Prospect:\nName: ${lead.name}\nTitle: ${lead.title || "(unknown)"}\nCompany: ${lead.company || "(unknown)"}${rb}` }];
  try {
    const r = await geminiJSON<ProposalResult>(system, turns, SCHEMA as unknown as Record<string, unknown>, { maxTokens: 900, temperature: 0.5 });
    return { title: (r.title ?? "Proposal").trim(), body: (r.body ?? "").trim(), productsUsed: Array.isArray(r.productsUsed) ? r.productsUsed : [] };
  } catch {
    return { title: `Proposal for ${lead.company || lead.name}`, body: `Draft proposal for ${lead.name}.`, productsUsed: products.map((p) => p.name) };
  }
}
```

- [ ] **Step 2: Write `lib/proposals/store.ts`.** (READ `lib/leads/store.ts` first for the `uid`/team-expand idiom; `pickLeadsForProposal` mirrors `pickLeadsForRun` but excludes leads that already have a proposal.)

```ts
import "server-only";
// Generated proposals: per-agent list + create + mark-sent, and the lead pool
// for the proposal job (accepted teammate leads without a proposal yet).
import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import { getDb, isDbConfigured, proposals } from "@/lib/db";
import { pickLeadsForRun } from "@/lib/leads/store";
import type { LeadDTO, ProposalResult } from "@/lib/leads/types";

export interface ProposalDTO { id: string; leadId: string; title: string; body: string; products: string[]; status: string; createdAt: string }

const toDTO = (r: { id: string; leadId: string; title: string; body: string; products: string[]; status: string; createdAt: Date }): ProposalDTO =>
  ({ id: r.id, leadId: r.leadId, title: r.title, body: r.body, products: r.products, status: r.status, createdAt: r.createdAt.toISOString() });

export async function listProposalsForAgent(userId: string, agentId: string): Promise<ProposalDTO[]> {
  if (!isDbConfigured()) return [];
  const rows = await getDb().select({ id: proposals.id, leadId: proposals.leadId, title: proposals.title, body: proposals.body, products: proposals.products, status: proposals.status, createdAt: proposals.createdAt })
    .from(proposals).where(and(eq(proposals.userId, userId), eq(proposals.agentId, agentId))).orderBy(desc(proposals.createdAt));
  return rows.map(toDTO);
}

export async function addProposal(userId: string, agentId: string, leadId: string, result: ProposalResult): Promise<void> {
  if (!isDbConfigured()) return;
  await getDb().insert(proposals).values({ userId, agentId, leadId, title: result.title, body: result.body, products: result.productsUsed ?? [] });
}

export async function markProposalSent(userId: string, id: string): Promise<void> {
  if (!isDbConfigured()) return;
  await getDb().update(proposals).set({ status: "sent", sentAt: new Date() }).where(and(eq(proposals.userId, userId), eq(proposals.id, id)));
}

// Accepted teammate leads that don't yet have a proposal, oldest first, capped.
export async function pickLeadsForProposal(userId: string, agentId: string, leadIds: string[] | undefined, batchSize: number): Promise<LeadDTO[]> {
  const candidates = await pickLeadsForRun(userId, agentId, leadIds, batchSize + 50); // team-expanded, accepted
  if (candidates.length === 0 || !isDbConfigured()) return candidates.slice(0, batchSize);
  const ids = candidates.map((l) => l.id);
  const existing = await getDb().select({ leadId: proposals.leadId }).from(proposals)
    .where(and(eq(proposals.userId, userId), inArray(proposals.leadId, ids)));
  const has = new Set(existing.map((e) => e.leadId));
  return candidates.filter((l) => !has.has(l.id)).slice(0, batchSize);
}
```

(Remove `notInArray` from the import if unused — the code above uses `inArray` + a Set.)

- [ ] **Step 3: Write `lib/proposals/actions.ts`.**

```ts
"use server";
import { getSession } from "@/lib/auth/session";
import { listProposalsForAgent as _list, markProposalSent as _sent, type ProposalDTO } from "./store";

async function uid(): Promise<string | null> { return (await getSession())?.userId ?? null; }

export async function listProposalsForAgent(agentId: string): Promise<ProposalDTO[]> { const u = await uid(); return u ? _list(u, agentId) : []; }
export async function markProposalSent(id: string): Promise<void> { const u = await uid(); if (u) await _sent(u, id); }
```

- [ ] **Step 4: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors.

- [ ] **Step 5: Commit.**

```bash
git add agentic-salesforce/lib/ai/proposal.ts agentic-salesforce/lib/proposals/store.ts agentic-salesforce/lib/proposals/actions.ts
git commit -m "Module2: proposal engine (RAG-grounded) + proposals store/actions"
```

---

## Task 5: Outreach catalog grounding

**Files:** Modify `lib/ai/outreach.ts`.

**Interfaces:** `draftOutreach` gains optional `products?: ProductDTO[]`; backward-compatible (empty → unchanged).

- [ ] **Step 1: Read `lib/ai/outreach.ts`**, then: import the product type (`import type { ProductDTO } from "@/lib/products/store";`), add `products?: ProductDTO[]` as a 3rd param to `draftOutreach`, and inject a catalog block into the user turn (alongside the existing `researchBlock`). Add:

```ts
  const productBlock = products && products.length
    ? `\n\nRelevant offerings (reference the fitting product + price when natural, don't hard-sell):\n` + products.map((p) => `- ${p.name}${p.price ? " (" + p.price + ")" : ""}`).join("\n")
    : "";
```

and append `${productBlock}` to the `text:` of the user turn (after `${researchBlock}`). The signature becomes:

```ts
export async function draftOutreach(
  agent: AgentSnapshot,
  lead: { name: string; title: string; company: string; email: string; platform?: string | null; research?: ResearchBrief | null },
  products?: ProductDTO[],
): Promise<OutreachResult> {
```

- [ ] **Step 2: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors. (Existing callers pass no `products` — still valid.)

- [ ] **Step 3: Commit.**

```bash
git add agentic-salesforce/lib/ai/outreach.ts
git commit -m "Module2: outreach references relevant catalog products (optional grounding)"
```

---

## Task 6: Runner wiring — qualify + proposal branches + outreach grounding

**Files:** Modify `app/api/jobs/run/route.ts`.

**Interfaces:** Consumes `qualifyLead`/`pickLeadsForQualify`/`applyQualifyResult` (T2), `draftProposal`/`pickLeadsForProposal`/`addProposal` (T4), `searchProducts` (Module 1). Adds `qualify`/`proposal` to claimed kinds + branches; grounds outreach.

- [ ] **Step 1: Imports.** Add to `app/api/jobs/run/route.ts`:

```ts
import { qualifyLead } from "@/lib/ai/qualify";
import { draftProposal } from "@/lib/ai/proposal";
import { pickLeadsForQualify, applyQualifyResult } from "@/lib/leads/store";
import { pickLeadsForProposal, addProposal } from "@/lib/proposals/store";
import { searchProducts } from "@/lib/products/store";
```

(Confirm `pickLeadsForRun`/`pickLeadsForResearch`/`applyOutreachResult`/`applyResearchResult` are already imported; add the new store fns to the existing `@/lib/leads/store` import.)

- [ ] **Step 2: Claim kinds.** Change the candidate query's `inArray`:

```ts
      .where(and(eq(jobs.userId, userId), eq(jobs.status, "queued"), inArray(jobs.kind, ["outreach", "research", "qualify", "proposal"]))).orderBy(asc(jobs.createdAt)).limit(1);
```

- [ ] **Step 3: Ground outreach.** In the existing `outreach` branch, before `draftOutreach`, retrieve products and pass them:

```ts
            const products = await searchProducts(userId, [lead.title, lead.company, lead.research?.summary].filter(Boolean).join(" ") || lead.company || lead.name, 3);
            const result = await draftOutreach(params.agent, { name: lead.name, title: lead.title, company: lead.company, email: lead.email, platform: lead.platform, research: lead.research }, products);
```

(Replace the existing `const result = await draftOutreach(...)` line with these two.)

- [ ] **Step 4: Add the `qualify` + `proposal` branches.** After the `research` branch's closing `}` and before the `else` (unknown-kind) branch, insert:

```ts
      } else if (candidate.kind === "qualify") {
        const batch = await pickLeadsForQualify(userId, params.agent.id, params.leadIds ?? undefined, params.batchSize ?? 5);
        for (const lead of batch) {
          try {
            const q = await qualifyLead(params.agent, { name: lead.name, title: lead.title, company: lead.company, email: lead.email, research: lead.research });
            await applyQualifyResult(userId, params.agent.id, lead, q);
            created++;
          } catch (e) { console.error("[jobs/run] qualify failed:", e); failed++; }
        }
        await db.update(jobs).set({ status: "done", finishedAt: new Date(), result: { qualified: created, failed } })
          .where(and(eq(jobs.id, candidate.id), eq(jobs.userId, userId)));
      } else if (candidate.kind === "proposal") {
        const batch = await pickLeadsForProposal(userId, params.agent.id, params.leadIds ?? undefined, params.batchSize ?? 5);
        for (const lead of batch) {
          try {
            const products = await searchProducts(userId, [lead.title, lead.company, lead.research?.summary].filter(Boolean).join(" ") || lead.company || lead.name, 5);
            const p = await draftProposal(params.agent, { name: lead.name, title: lead.title, company: lead.company, research: lead.research }, products);
            await addProposal(userId, params.agent.id, lead.id, p);
            created++;
          } catch (e) { console.error("[jobs/run] proposal failed:", e); failed++; }
        }
        await db.update(jobs).set({ status: "done", finishedAt: new Date(), result: { proposals: created, failed } })
          .where(and(eq(jobs.id, candidate.id), eq(jobs.userId, userId)));
```

- [ ] **Step 5: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors. (`lead.research` is on `LeadDTO`; `searchProducts` is server-only, called with `userId`.)

- [ ] **Step 6: Commit.**

```bash
git add "agentic-salesforce/app/api/jobs/run/route.ts"
git commit -m "Module2: runner runs qualify + proposal (RAG) jobs; grounds outreach in the catalog"
```

---

## Task 7: Agent detail UI — Qualify action + tier chips + Proposals section

**Files:** Modify `app/agents/[id]/page.tsx`.

**Interfaces:** Consumes `enqueueJob` (existing), `listProposalsForAgent`/`markProposalSent` (T4). Adds a Qualify action + tier chips on Leads, and a Proposals section.

- [ ] **Step 1: Read the file** — locate `runResearch` (the enqueue+`/api/jobs/run`+refetch pattern to mirror), the `SECTIONS` array, the Leads section's per-lead row, and the `isVisible(cap)` helper used to gate capability sections.

- [ ] **Step 2: Imports + state.** Add:

```ts
import { listProposalsForAgent, markProposalSent } from "@/lib/proposals/actions";
import type { ProposalDTO } from "@/lib/proposals/store";
```

Add state + a loader (near the other section state):

```ts
  const [runningQualify, setRunningQualify] = useState(false);
  const [proposals, setProposals] = useState<ProposalDTO[]>([]);
  const [runningProposal, setRunningProposal] = useState(false);
  useEffect(() => { if (selId) listProposalsForAgent(selId).then(setProposals); }, [selId]);
```

- [ ] **Step 3: Qualify + proposal actions** (mirror `runResearch`). Add:

```ts
  const runQualify = useCallback(async () => {
    if (!sel) return;
    setRunningQualify(true);
    const res = await enqueueJob({ agent: { id: sel.id, name: sel.name, role: sel.role, goal: sel.goal, task: sel.task }, kind: "qualify", capabilities: sel.capabilities });
    if (!("error" in res)) { try { await fetch("/api/jobs/run", { method: "POST" }); } catch {} } else showToast(res.error);
    setRunningQualify(false);
    listWorkbook(sel.id).then(setAgentLeads);
  }, [sel]);

  const runProposals = useCallback(async () => {
    if (!sel) return;
    setRunningProposal(true);
    const res = await enqueueJob({ agent: { id: sel.id, name: sel.name, role: sel.role, goal: sel.goal, task: sel.task }, kind: "proposal", capabilities: sel.capabilities });
    if (!("error" in res)) { try { await fetch("/api/jobs/run", { method: "POST" }); } catch {} } else showToast(res.error);
    setRunningProposal(false);
    listProposalsForAgent(sel.id).then(setProposals);
  }, [sel]);
```

(If the file's other actions use `listWorkbook`/`setAgentLeads` under different names, match them from Step 1.)

- [ ] **Step 4: Tier chip on Leads rows.** Add a helper near the top-level consts:

```ts
const tierChip = (score: number): [string, string, string] => score >= 75 ? ["#FEECEC", "#B91C1C", "Hot"] : score >= 50 ? ["#FEF6E8", "#B45309", "Warm"] : score > 0 ? ["#E9F5FE", "#0369A1", "Cold"] : ["#F4F4F5", "#A1A1AA", "—"];
```

In the agent's Leads section score cell, render the tier chip alongside the score, e.g. replace the score display with:

```tsx
{(() => { const [bg, fg, label] = tierChip(l.score || 0); return <span style={css(chip(bg, fg))}>{label}{l.score ? " · " + l.score : ""}</span>; })()}
```

Add a **"Qualify leads"** button in the Leads section header for `qualify`-capable agents (mirror the "Find leads"/"Research leads" buttons): `{sel.capabilities?.includes("qualify") && <Btn onClick={runQualify} ...>{runningQualify ? "Qualifying…" : "Qualify leads"}</Btn>}`.

- [ ] **Step 5: Proposals section.** Add `["proposal", "Proposals", "proposal"]` to the `SECTIONS` array (with its capability gate — match the `[key,label,cap?]` tuple shape). Add the section body (gate with the same `isVisible("proposal")` used by other capability sections), mirroring the Emails section:

```tsx
      {isVisible("proposal") && (<>
        <SectionTitle id="sec-proposal">Proposals</SectionTitle>
        <div style={css("display:flex;flex-direction:column;gap:14px;animation:fadeUp .25s ease")}>
          <div style={css("display:flex;align-items:center;gap:10px")}>
            <div style={css("font-size:12.5px;color:#71717A")}>{proposals.length} proposal{proposals.length === 1 ? "" : "s"}</div>
            <Btn onClick={runProposals} style={"margin-left:auto;background:#5122C1;color:#fff;border:none;border-radius:99px;padding:8px 16px;font-size:12.5px;font-weight:600;cursor:pointer;" + (runningProposal ? "opacity:.6" : "")} styleHover="background:#42199E">{runningProposal ? "Drafting…" : "Generate proposals"}</Btn>
          </div>
          {proposals.length === 0 ? (
            <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:22px;font-size:12.5px;color:#A1A1AA")}>No proposals yet. Hit “Generate proposals” to draft from your catalog.</div>
          ) : proposals.map((p) => (
            <div key={p.id} style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:16px 18px")}>
              <div style={css("display:flex;align-items:center;gap:8px")}>
                <span style={css(chip(p.status === "sent" ? "#E7F7EC" : "#F1EDFD", p.status === "sent" ? "#1B7A3D" : "#5122C1"))}>{p.status === "sent" ? "Sent" : "Draft"}</span>
                <div style={css("font-size:13.5px;font-weight:700")}>{p.title}</div>
              </div>
              {p.products.length > 0 && <div style={css("display:flex;gap:6px;flex-wrap:wrap;margin-top:8px")}>{p.products.map((pr, i) => <span key={i} style={css(chip("#F1EDFD", "#5122C1"))}>{pr}</span>)}</div>}
              <div style={css("font-size:12.5px;color:#3F3F46;line-height:1.6;margin-top:8px;white-space:pre-wrap")}>{p.body}</div>
              {p.status !== "sent" && <div style={css("margin-top:12px")}><Btn onClick={async () => { await markProposalSent(p.id); listProposalsForAgent(sel.id).then(setProposals); }} style="background:#F4F4F5;color:#3F3F46;border:none;border-radius:99px;padding:7px 16px;font-size:12px;font-weight:600;cursor:pointer" styleHover="background:#E4E4E7">Mark sent</Btn></div>}
            </div>
          ))}
        </div>
      </>)}
```

- [ ] **Step 6: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors.

- [ ] **Step 7: Manual check (after `pnpm db:migrate`).** On a `closer`/qualify+proposal agent with accepted leads + products in the catalog: "Qualify leads" → tier chips appear; "Generate proposals" → proposals citing real products appear with Mark sent. Chat: `@agent qualify the leads` / `@agent draft a proposal` run; `@agent enrich` → coming soon.

- [ ] **Step 8: Commit.**

```bash
git add "agentic-salesforce/app/agents/[id]/page.tsx"
git commit -m "Module2: agent detail — Qualify action + tier chips; Proposals section (generate + mark sent)"
```

---

## Self-Review

**Spec coverage:** Part A (catalog) → T1. Part B (qualify) → T2. Part C (proposals table + engine + store) → T3+T4. Part D (outreach grounding) → T5. Part E (runner) → T6. Part F (intent) → T1. Part G (UI) → T7. Enrich placeholder → T1 (capability+intent; rides `engineReady:false`). One migration (T3, user-applied).

**Placeholder scan:** every step has complete code or an exact edit target + read-anchor. The two "READ the file first" notes (T2 store idiom, T7 anchors) are to match existing patterns, with full code given for the new pieces.

**Type consistency:** `QualifyResult`/`ProposalResult` (T1) are produced by the engines (T2/T4) and consumed by store applies (T2) + `addProposal` (T4). `qualifyLead`/`draftProposal` signatures (T2/T4) match the runner calls (T6). `pickLeadsForQualify`/`pickLeadsForProposal` (T2/T4) match runner + return `LeadDTO[]`. `draftOutreach`'s new optional `products` (T5) matches the runner's grounded call (T6). `ProposalDTO` (T4) is consumed by the UI (T7). `searchProducts(userId, query, k)` (Module 1) is called server-side in the runner (T6). Capability ids `qualify`/`proposal`/`enrich` (T1) === job kinds used by the runner (T6) + gate `enqueueJob`. `SECTIONS` tuple `["proposal","Proposals","proposal"]` (T7) matches the existing `[key,label,cap?]` shape.
