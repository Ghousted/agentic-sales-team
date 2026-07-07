# Outreach Engine + Leads Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give one agent a real, on-demand outreach loop: add real leads, run a Gemini engine that qualifies each lead and drafts a personalized email, and send it with one click via a pre-filled `mailto:` — all persisted, with the Leads and Emails sub-tabs rendering real records.

**Architecture:** A dedicated `lib/leads` domain module owns leads/drafts/activity persistence. A pure `lib/ai/outreach` engine turns an agent + lead into a scored draft via Gemini JSON mode. A `jobs` queue plus a Node-runtime route handler (`/api/jobs/run`) claims and runs outreach jobs — the seam a Playwright worker and a scheduler reuse later. A new `/leads` page and the agent-detail Emails/Leads tabs consume it via per-view server-action fetches.

**Tech Stack:** Next.js 14 App Router + TypeScript, Neon Postgres + Drizzle ORM, custom migrate runner (`pnpm db:generate` + `pnpm db:migrate`), Gemini 2.5-flash REST (`lib/ai/gemini.ts`), inline-style `css()` helper + `Box`/`Btn` primitives, React Context store (`lib/store.tsx`).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-07-agent-execution-outreach-engine-design.md` — implement Milestone 1 only.
- **No new runtime dependencies.** Use the existing Drizzle client, `getSession`, and the raw-fetch Gemini client. No SDKs.
- **Per-user isolation is mandatory:** every query filters by the session `userId` (pattern: `const userId = await uid()` from `getSession()`), exactly like `lib/workspace/actions.ts`.
- **`agentId` is a plain `text` column** (matches `agent_config` / `team_members` / `agent_states`), never a FK.
- **Migrations:** generate with `pnpm db:generate`, apply with `pnpm db:migrate` (never `drizzle-kit push` — it needs a TTY).
- **Verification is browser + DB + `npx tsc --noEmit`** — there is no automated test runner in this project. Every task ends with a green typecheck and (where it produces user-visible behavior) a browser check, then a commit.
- **Commits:** user's git identity only, NO `Co-Authored-By` line. Do not push unless asked.
- **Dev server** runs on `http://localhost:3001` (port 3000 is a different app). Reuse the running one; do not spawn duplicates.
- **`mailto:` values must be URL-encoded** with `encodeURIComponent`.
- **Pipeline vocab is fixed:** lead `status` ∈ `new` → `contacted` → `engaged` → `replied` → `meeting`. Draft `status` ∈ `draft` → `sent`. Job `status` ∈ `queued` → `running` → `done` / `failed`.

---

### Task 1: Database schema, migration, and shared types

**Files:**
- Modify: `lib/db/schema.ts` (add four tables at the end, before the `export type` lines)
- Create: `lib/leads/types.ts`

**Interfaces:**
- Produces (schema, importable via `@/lib/db` which re-exports schema): `leads`, `outreachDrafts`, `activity`, `jobs` Drizzle tables.
- Produces (`@/lib/leads/types`): `LeadDTO`, `DraftDTO`, `AgentSnapshot`, `OutreachResult` interfaces; `LEAD_STAGES` const.

- [ ] **Step 1: Add the four tables to `lib/db/schema.ts`**

Insert immediately **before** the `export type User = ...` block near the bottom. The needed imports (`pgTable, uuid, text, integer, jsonb, timestamp`) are already present at the top of the file.

```typescript
// ── Agent execution (Milestone 1: outreach engine) ──────────────────────────

// Real prospects an agent works. `source` is 'manual' now, 'scrape' in milestone 2.
export const leads = pgTable("leads", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull(),
  name: text("name").notNull(),
  title: text("title").notNull().default(""),
  company: text("company").notNull().default(""),
  email: text("email").notNull(),
  status: text("status").notNull().default("new"), // new|contacted|engaged|replied|meeting
  score: integer("score").notNull().default(0),
  source: text("source").notNull().default("manual"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Agent-written outreach emails.
export const outreachDrafts = pgTable("outreach_drafts", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull(),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  rationale: text("rationale").notNull().default(""),
  status: text("status").notNull().default("draft"), // draft|sent
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
});

// Real event log (feeds notifications + dashboard/analytics in a later milestone).
export const activity = pgTable("activity", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull(),
  type: text("type").notNull(), // lead_added|lead_qualified|email_drafted|email_sent
  leadId: uuid("lead_id"),
  text: text("text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Run queue. `kind` is 'outreach' now, 'scrape' in milestone 2.
export const jobs = pgTable("jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull(),
  kind: text("kind").notNull(),
  status: text("status").notNull().default("queued"), // queued|running|done|failed
  params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
  result: jsonb("result").$type<Record<string, unknown>>(),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});
```

- [ ] **Step 2: Create `lib/leads/types.ts`** (plain types — safe to import from client or server; no directives)

```typescript
// Serializable DTOs and shared constants for the leads/outreach domain.
// Dates are ISO strings so these cross the server→client boundary cleanly.

export const LEAD_STAGES = ["new", "contacted", "engaged", "replied", "meeting"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export interface LeadDTO {
  id: string;
  agentId: string;
  name: string;
  title: string;
  company: string;
  email: string;
  status: string;
  score: number;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface DraftDTO {
  id: string;
  agentId: string;
  leadId: string;
  subject: string;
  body: string;
  rationale: string;
  status: string;
  createdAt: string;
  sentAt: string | null;
  leadName: string;
  leadCompany: string;
  leadEmail: string;
}

// A snapshot of the agent captured at enqueue time and stored in the job params,
// so the runner never has to re-resolve agent state server-side.
export interface AgentSnapshot {
  id: string;
  name: string;
  role: string;
  goal: string;
  task: string;
}

export interface OutreachResult {
  score: number;
  stage: string;
  subject: string;
  body: string;
  rationale: string;
}
```

- [ ] **Step 3: Generate and apply the migration**

Run:
```bash
pnpm db:generate && pnpm db:migrate
```
Expected: `db:generate` writes a new `lib/db/migrations/00NN_*.sql` listing `leads 12 columns`, `outreach_drafts`, `activity`, `jobs`; `db:migrate` ends with `✓ applied: 00NN_*.sql`.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 5: Commit**

```bash
git add lib/db/schema.ts lib/db/migrations lib/leads/types.ts
git commit -m "Add leads/drafts/activity/jobs schema + shared DTO types"
```

---

### Task 2: Leads domain module (store + server actions)

**Files:**
- Create: `lib/leads/store.ts` (server-only DB logic)
- Create: `lib/leads/actions.ts` (`use server` client-facing wrappers)

**Interfaces:**
- Consumes: `@/lib/db` (`getDb`, `isDbConfigured`, `leads`, `outreachDrafts`, `activity`), `@/lib/auth/session` (`getSession`), `@/lib/leads/types`.
- Produces (`@/lib/leads/store`): `addLead`, `listLeads`, `getLead`, `setStage`, `listDraftsForAgent`, `markDraftSent`, `pickLeadsForRun(userId, agentId, leadIds, batchSize)`, `applyOutreachResult(userId, agentId, leadRow, result)`.
- Produces (`@/lib/leads/actions`): `addLead`, `listLeads`, `getLead`, `setStage`, `listDraftsForAgent`, `markDraftSent` (thin wrappers — these are what client components import).

- [ ] **Step 1: Create `lib/leads/store.ts`**

```typescript
import "server-only";
// All persistence for the leads/outreach domain. Plain async functions so the
// job runner (a route handler) can call them directly; the `use server`
// wrappers in ./actions.ts expose the client-facing subset.
import { and, desc, eq, inArray, asc } from "drizzle-orm";
import { getDb, isDbConfigured, leads, outreachDrafts, activity } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { LEAD_STAGES, type LeadDTO, type DraftDTO, type OutreachResult } from "./types";

type LeadRow = typeof leads.$inferSelect;

async function uid(): Promise<string | null> {
  const s = await getSession();
  return s?.userId ?? null;
}

function toLeadDTO(r: LeadRow): LeadDTO {
  return {
    id: r.id, agentId: r.agentId, name: r.name, title: r.title, company: r.company,
    email: r.email, status: r.status, score: r.score, source: r.source,
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  };
}

export async function addLead(input: { agentId: string; name: string; title?: string; company?: string; email: string }): Promise<LeadDTO | null> {
  if (!isDbConfigured()) return null;
  const userId = await uid();
  if (!userId) return null;
  const db = getDb();
  const [row] = await db.insert(leads).values({
    userId, agentId: input.agentId, name: input.name.trim(),
    title: (input.title ?? "").trim(), company: (input.company ?? "").trim(),
    email: input.email.trim(),
  }).returning();
  await db.insert(activity).values({
    userId, agentId: input.agentId, type: "lead_added", leadId: row.id,
    text: `Added lead ${row.name}${row.company ? " · " + row.company : ""}`,
  });
  return toLeadDTO(row);
}

export async function listLeads(filter?: { agentId?: string; status?: string; source?: string }): Promise<LeadDTO[]> {
  if (!isDbConfigured()) return [];
  const userId = await uid();
  if (!userId) return [];
  const conds = [eq(leads.userId, userId)];
  if (filter?.agentId) conds.push(eq(leads.agentId, filter.agentId));
  if (filter?.status) conds.push(eq(leads.status, filter.status));
  if (filter?.source) conds.push(eq(leads.source, filter.source));
  const rows = await getDb().select().from(leads).where(and(...conds)).orderBy(desc(leads.createdAt));
  return rows.map(toLeadDTO);
}

export async function getLead(id: string): Promise<LeadDTO | null> {
  if (!isDbConfigured()) return null;
  const userId = await uid();
  if (!userId) return null;
  const [row] = await getDb().select().from(leads).where(and(eq(leads.id, id), eq(leads.userId, userId))).limit(1);
  return row ? toLeadDTO(row) : null;
}

export async function setStage(id: string, status: string): Promise<void> {
  if (!isDbConfigured()) return;
  const userId = await uid();
  if (!userId) return;
  if (!LEAD_STAGES.includes(status as (typeof LEAD_STAGES)[number])) return;
  await getDb().update(leads).set({ status, updatedAt: new Date() })
    .where(and(eq(leads.id, id), eq(leads.userId, userId)));
}

export async function listDraftsForAgent(agentId: string): Promise<DraftDTO[]> {
  if (!isDbConfigured()) return [];
  const userId = await uid();
  if (!userId) return [];
  const rows = await getDb().select({
    d: outreachDrafts, leadName: leads.name, leadCompany: leads.company, leadEmail: leads.email,
  }).from(outreachDrafts)
    .innerJoin(leads, eq(outreachDrafts.leadId, leads.id))
    .where(and(eq(outreachDrafts.userId, userId), eq(outreachDrafts.agentId, agentId)))
    .orderBy(desc(outreachDrafts.createdAt));
  return rows.map(({ d, leadName, leadCompany, leadEmail }) => ({
    id: d.id, agentId: d.agentId, leadId: d.leadId, subject: d.subject, body: d.body,
    rationale: d.rationale, status: d.status, createdAt: d.createdAt.toISOString(),
    sentAt: d.sentAt ? d.sentAt.toISOString() : null, leadName, leadCompany, leadEmail,
  }));
}

export async function markDraftSent(draftId: string): Promise<void> {
  if (!isDbConfigured()) return;
  const userId = await uid();
  if (!userId) return;
  const db = getDb();
  const [d] = await db.select().from(outreachDrafts)
    .where(and(eq(outreachDrafts.id, draftId), eq(outreachDrafts.userId, userId))).limit(1);
  if (!d) return;
  await db.update(outreachDrafts).set({ status: "sent", sentAt: new Date() }).where(eq(outreachDrafts.id, draftId));
  // Advance the lead new → contacted (only if still 'new', so we never rewind a stage).
  await db.update(leads).set({ status: "contacted", updatedAt: new Date() })
    .where(and(eq(leads.id, d.leadId), eq(leads.userId, userId), eq(leads.status, "new")));
  await db.insert(activity).values({ userId, agentId: d.agentId, type: "email_sent", leadId: d.leadId, text: `Sent "${d.subject}"` });
}

// ── Runner helpers (called by /api/jobs/run) ────────────────────────────────

/** Pick the leads a run should process: the given ids, or the agent's leads
 *  that don't yet have a draft (idempotent re-runs), oldest first, capped. */
export async function pickLeadsForRun(userId: string, agentId: string, leadIds: string[] | undefined, batchSize: number): Promise<LeadRow[]> {
  const db = getDb();
  if (leadIds && leadIds.length) {
    return db.select().from(leads)
      .where(and(eq(leads.userId, userId), eq(leads.agentId, agentId), inArray(leads.id, leadIds)))
      .limit(batchSize);
  }
  const drafted = await db.select({ leadId: outreachDrafts.leadId }).from(outreachDrafts)
    .where(and(eq(outreachDrafts.userId, userId), eq(outreachDrafts.agentId, agentId)));
  const draftedIds = new Set(drafted.map((r) => r.leadId));
  const all = await db.select().from(leads)
    .where(and(eq(leads.userId, userId), eq(leads.agentId, agentId))).orderBy(asc(leads.createdAt));
  return all.filter((l) => !draftedIds.has(l.id)).slice(0, batchSize);
}

/** Persist one engine result: the draft, the lead's new score/stage, and activity. */
export async function applyOutreachResult(userId: string, agentId: string, lead: LeadRow, result: OutreachResult): Promise<void> {
  const db = getDb();
  await db.insert(outreachDrafts).values({
    userId, agentId, leadId: lead.id, subject: result.subject, body: result.body, rationale: result.rationale,
  });
  const stage = LEAD_STAGES.includes(result.stage as (typeof LEAD_STAGES)[number]) ? result.stage : lead.status;
  await db.update(leads).set({
    score: Math.max(0, Math.min(100, Math.round(result.score || 0))), status: stage, updatedAt: new Date(),
  }).where(eq(leads.id, lead.id));
  await db.insert(activity).values({ userId, agentId, type: "email_drafted", leadId: lead.id, text: `Drafted "${result.subject}" for ${lead.name}` });
}
```

- [ ] **Step 2: Create `lib/leads/actions.ts`**

```typescript
"use server";
// Client-facing server actions for the leads domain — thin wrappers over the
// server-only store so client components never import server-only code.
import * as store from "./store";
import type { LeadDTO, DraftDTO } from "./types";

export async function addLead(input: { agentId: string; name: string; title?: string; company?: string; email: string }): Promise<LeadDTO | null> {
  return store.addLead(input);
}
export async function listLeads(filter?: { agentId?: string; status?: string; source?: string }): Promise<LeadDTO[]> {
  return store.listLeads(filter);
}
export async function getLead(id: string): Promise<LeadDTO | null> {
  return store.getLead(id);
}
export async function setStage(id: string, status: string): Promise<void> {
  return store.setStage(id, status);
}
export async function listDraftsForAgent(agentId: string): Promise<DraftDTO[]> {
  return store.listDraftsForAgent(agentId);
}
export async function markDraftSent(draftId: string): Promise<void> {
  return store.markDraftSent(draftId);
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0. (Behavioral verification happens in Task 5 when the UI wires these in.)

- [ ] **Step 4: Commit**

```bash
git add lib/leads/store.ts lib/leads/actions.ts
git commit -m "Add leads domain module (store + server actions)"
```

---

### Task 3: Gemini JSON helper + outreach engine

**Files:**
- Modify: `lib/ai/gemini.ts` (add `geminiJSON` after `geminiGenerate`)
- Create: `lib/ai/outreach.ts`

**Interfaces:**
- Consumes: `@/lib/ai/gemini` (`geminiJSON`, `isGeminiConfigured`, `Turn`), `@/lib/leads/types` (`AgentSnapshot`, `OutreachResult`).
- Produces (`@/lib/ai/gemini`): `geminiJSON<T>(system, turns, schema, opts?) => Promise<T>`.
- Produces (`@/lib/ai/outreach`): `draftOutreach(agent: AgentSnapshot, lead: { name; title; company; email }) => Promise<OutreachResult>`.

- [ ] **Step 1: Add `geminiJSON` to `lib/ai/gemini.ts`** (append after the `geminiGenerate` function)

```typescript
/** Call Gemini in JSON mode against a response schema. Returns the parsed object. Throws on failure. */
export async function geminiJSON<T>(system: string, turns: Turn[], schema: Record<string, unknown>, opts?: { maxTokens?: number; temperature?: number }): Promise<T> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set.");
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  const body = {
    system_instruction: { parts: [{ text: system }] },
    contents: turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
    generationConfig: {
      temperature: opts?.temperature ?? 0.6,
      maxOutputTokens: opts?.maxTokens ?? 700,
      thinkingConfig: { thinkingBudget: 0 },
      responseMimeType: "application/json",
      responseSchema: schema,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gemini ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  const text: string | undefined = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("");
  if (!text) throw new Error("Gemini returned no JSON text.");
  return JSON.parse(text) as T;
}
```

- [ ] **Step 2: Create `lib/ai/outreach.ts`**

```typescript
import "server-only";
// The outreach engine: one structured Gemini call per lead that both qualifies
// (score + pipeline stage) and drafts a personalized email. Pure — no DB.
import { geminiJSON, isGeminiConfigured, type Turn } from "./gemini";
import type { AgentSnapshot, OutreachResult } from "@/lib/leads/types";

const SCHEMA = {
  type: "object",
  properties: {
    score: { type: "integer" },
    stage: { type: "string", enum: ["new", "contacted", "engaged", "replied", "meeting"] },
    subject: { type: "string" },
    body: { type: "string" },
    rationale: { type: "string" },
  },
  required: ["score", "stage", "subject", "body", "rationale"],
} as const;

function systemPrompt(a: AgentSnapshot): string {
  return [
    `You are ${a.name}, an AI ${a.role} on a B2B sales team.`,
    `Your objective: ${a.goal}. Current focus: ${a.task}.`,
    `Given ONE prospect, do two things: (1) score their fit for your objective from 0 to 100 and pick the best pipeline stage, (2) write a concise, personalized cold outreach email.`,
    `The email must be specific to the prospect's title and company, give a plausible business reason to reach out, and align with your objective. 90-140 words, plain text, first person as ${a.name}, no placeholder tokens like [Company], and end with a soft call to action.`,
    `Return ONLY JSON matching the schema.`,
  ].join(" ");
}

export async function draftOutreach(agent: AgentSnapshot, lead: { name: string; title: string; company: string; email: string }): Promise<OutreachResult> {
  if (!isGeminiConfigured()) {
    const first = lead.name.split(" ")[0] || "there";
    return {
      score: 60,
      stage: "contacted",
      subject: `Quick idea for ${lead.company || "your team"}`,
      body: `Hi ${first},\n\nI'm ${agent.name}, ${agent.role}. I work with ${lead.title || "leaders"} on ${agent.goal}. Would a short call next week be worth 15 minutes?\n\nBest,\n${agent.name}`,
      rationale: "Fallback draft (Gemini not configured).",
    };
  }
  const turns: Turn[] = [{
    role: "user",
    text: `Prospect:\nName: ${lead.name}\nTitle: ${lead.title || "(unknown)"}\nCompany: ${lead.company || "(unknown)"}\nEmail: ${lead.email}`,
  }];
  const r = await geminiJSON<OutreachResult>(systemPrompt(agent), turns, SCHEMA as unknown as Record<string, unknown>, { maxTokens: 700, temperature: 0.6 });
  return {
    score: typeof r.score === "number" ? r.score : 50,
    stage: r.stage || "contacted",
    subject: (r.subject || `Quick note for ${lead.company || "you"}`).trim(),
    body: (r.body || "").trim(),
    rationale: (r.rationale || "").trim(),
  };
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add lib/ai/gemini.ts lib/ai/outreach.ts
git commit -m "Add Gemini JSON mode + outreach drafting engine"
```

---

### Task 4: Job queue actions + runner route handler

**Files:**
- Create: `lib/jobs/actions.ts` (`use server`)
- Create: `app/api/jobs/run/route.ts` (Node route handler)

**Interfaces:**
- Consumes: `@/lib/db` (`getDb`, `isDbConfigured`, `jobs`), `@/lib/auth/session` (`getSession`), `@/lib/leads/store` (`pickLeadsForRun`, `applyOutreachResult`), `@/lib/ai/outreach` (`draftOutreach`), `@/lib/leads/types` (`AgentSnapshot`).
- Produces (`@/lib/jobs/actions`): `enqueueOutreachJob(input: { agent: AgentSnapshot; leadIds?: string[]; batchSize?: number }) => Promise<{ jobId: string } | { error: string }>`; `getJob(id) => Promise<{ status; result; error } | null>`.
- Produces (HTTP): `POST /api/jobs/run` → `{ processed: number; drafts: number }`. Authenticated by the caller's session cookie; drains that user's `queued` jobs.

- [ ] **Step 1: Create `lib/jobs/actions.ts`**

```typescript
"use server";
// Job queue: enqueue an outreach run (a `jobs` row) and read job status.
// The run itself is done by POST /api/jobs/run (a Node route handler).
import { and, eq } from "drizzle-orm";
import { getDb, isDbConfigured, jobs } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import type { AgentSnapshot } from "@/lib/leads/types";

async function uid(): Promise<string | null> {
  const s = await getSession();
  return s?.userId ?? null;
}

export async function enqueueOutreachJob(input: { agent: AgentSnapshot; leadIds?: string[]; batchSize?: number }): Promise<{ jobId: string } | { error: string }> {
  if (!isDbConfigured()) return { error: "Server not configured." };
  const userId = await uid();
  if (!userId) return { error: "Not signed in." };
  const [row] = await getDb().insert(jobs).values({
    userId, agentId: input.agent.id, kind: "outreach", status: "queued",
    params: { agent: input.agent, leadIds: input.leadIds ?? null, batchSize: input.batchSize ?? 5 },
  }).returning({ id: jobs.id });
  return { jobId: row.id };
}

export async function getJob(id: string): Promise<{ status: string; result: unknown; error: string | null } | null> {
  if (!isDbConfigured()) return null;
  const userId = await uid();
  if (!userId) return null;
  const [row] = await getDb().select({ status: jobs.status, result: jobs.result, error: jobs.error })
    .from(jobs).where(and(eq(jobs.id, id), eq(jobs.userId, userId))).limit(1);
  return row ?? null;
}
```

- [ ] **Step 2: Create `app/api/jobs/run/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, isDbConfigured, jobs } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { pickLeadsForRun, applyOutreachResult } from "@/lib/leads/store";
import { draftOutreach } from "@/lib/ai/outreach";
import type { AgentSnapshot } from "@/lib/leads/types";

// Needs the Node runtime (raw fetch to Gemini, no edge constraints) and room to
// run a small batch of Gemini calls.
export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_JOBS_PER_INVOCATION = 5;

export async function POST() {
  if (!isDbConfigured()) return NextResponse.json({ processed: 0, drafts: 0 });
  const session = await getSession();
  if (!session) return NextResponse.json({ processed: 0, drafts: 0 }, { status: 401 });
  const userId = session.userId;
  const db = getDb();

  let processed = 0;
  let drafts = 0;

  for (let i = 0; i < MAX_JOBS_PER_INVOCATION; i++) {
    const [candidate] = await db.select().from(jobs)
      .where(and(eq(jobs.userId, userId), eq(jobs.status, "queued"))).limit(1);
    if (!candidate) break;

    // Atomic claim: the status='queued' guard means two runners can't grab it.
    const claimed = await db.update(jobs).set({ status: "running", startedAt: new Date() })
      .where(and(eq(jobs.id, candidate.id), eq(jobs.status, "queued"))).returning({ id: jobs.id });
    if (!claimed.length) continue;
    processed++;

    const params = candidate.params as { agent: AgentSnapshot; leadIds: string[] | null; batchSize: number };
    let created = 0;
    let failed = 0;
    try {
      const batch = await pickLeadsForRun(userId, params.agent.id, params.leadIds ?? undefined, params.batchSize ?? 5);
      for (const lead of batch) {
        try {
          const result = await draftOutreach(params.agent, {
            name: lead.name, title: lead.title, company: lead.company, email: lead.email,
          });
          await applyOutreachResult(userId, params.agent.id, lead, result);
          created++;
          drafts++;
        } catch (e) {
          console.error("[jobs/run] lead failed:", e);
          failed++;
        }
      }
      await db.update(jobs).set({ status: "done", finishedAt: new Date(), result: { draftsCreated: created, failed } })
        .where(eq(jobs.id, candidate.id));
    } catch (e) {
      await db.update(jobs).set({ status: "failed", finishedAt: new Date(), error: String(e).slice(0, 500) })
        .where(eq(jobs.id, candidate.id));
    }
  }

  return NextResponse.json({ processed, drafts });
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Smoke-test the route responds**

Run: `curl -s -X POST http://localhost:3001/api/jobs/run`
Expected: JSON `{"processed":0,"drafts":0}` (no session cookie → no jobs claimed). Confirms the route compiles and is wired. (Full run verification is Task 5.)

- [ ] **Step 5: Commit**

```bash
git add lib/jobs/actions.ts app/api/jobs/run/route.ts
git commit -m "Add outreach job queue + /api/jobs/run runner"
```

---

### Task 5: Leads module page + sidebar nav

**Files:**
- Modify: `lib/visuals.ts` (add a `leads` entry to `NAV_PATHS`)
- Modify: `components/Shell.tsx` (add the nav item + header title)
- Create: `app/leads/page.tsx`

**Interfaces:**
- Consumes: `@/lib/store` (`useApp` → `s`, `agents`, `showToast`), `@/lib/leads/actions` (`addLead`, `listLeads`, `setStage`), `@/lib/jobs/actions` (`enqueueOutreachJob`), `@/lib/leads/types` (`LeadDTO`, `LEAD_STAGES`, `AgentSnapshot`), `@/components/primitives` (`css`, `Box`, `Btn`), `@/lib/visuals` (`av`, `chip`).
- Produces: the `/leads` route (client component) — Add lead form, filters, table, per-lead "Run outreach". Reuses the running-job flow: `enqueueOutreachJob` → `await fetch("/api/jobs/run", { method: "POST" })` → refetch.

- [ ] **Step 1: Add a `leads` icon to `NAV_PATHS` in `lib/visuals.ts`** (inside the `NAV_PATHS` object, after the `panel` entry)

```typescript
  leads: '<path d="M8.5 11.2a3.1 3.1 0 1 0 0-6.2 3.1 3.1 0 0 0 0 6.2Zm0 1.7c-2.7 0-5.7 1.35-5.7 3.5V19h11.4v-2.6c0-2.15-3-3.5-5.7-3.5Zm7.3-1.7a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Zm.5 1.75c-.35 0-.7.02-1.03.07 1 .77 1.63 1.83 1.63 3.18V19h4.3v-2.4c0-1.95-2.5-3.15-4.9-3.15Z"/>',
```

- [ ] **Step 2: Add the nav item and header title in `components/Shell.tsx`**

In the `NAV` array, add a `Leads` entry after `Agents`:
```typescript
const NAV: { href: string; icon: string; label: string }[] = [
  { href: "/", icon: "home", label: "Dashboard" },
  { href: "/agents", icon: "robot", label: "Agents" },
  { href: "/leads", icon: "leads", label: "Leads" },
  { href: "/chats", icon: "chat", label: "Chats" },
  { href: "/analytics", icon: "bars", label: "Analytics" },
];
```
In `headerTitle`, add a branch before the final `return "Dashboard"`:
```typescript
  if (path.startsWith("/leads")) return "Leads";
```

- [ ] **Step 3: Create `app/leads/page.tsx`**

```typescript
"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "@/lib/store";
import { addLead as addLeadAction, listLeads as listLeadsAction, setStage as setStageAction } from "@/lib/leads/actions";
import { enqueueOutreachJob } from "@/lib/jobs/actions";
import { LEAD_STAGES, type LeadDTO } from "@/lib/leads/types";
import { av, chip } from "@/lib/visuals";
import { css, Box, Btn } from "@/components/primitives";

const STAGE_COLORS: Record<string, [string, string]> = {
  new: ["#F4F4F5", "#71717A"], contacted: ["#FEF6E8", "#B45309"], engaged: ["#E9F5FE", "#0369A1"],
  replied: ["#E7F7EC", "#1B7A3D"], meeting: ["#F1EDFD", "#5122C1"],
};
const INPUT = "border:1px solid #E4E4E7;background:#fff;border-radius:10px;padding:9px 12px;font-size:13px;color:#18181B;outline:none";

export default function LeadsPage() {
  const { agents, byId, showToast } = useApp();
  const [leads, setLeads] = useState<LeadDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null); // agentId being run, or "all"
  const [fAgent, setFAgent] = useState("");
  const [fStage, setFStage] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", title: "", company: "", email: "", agentId: "" });

  const refetch = useCallback(async () => {
    setLoading(true);
    const rows = await listLeadsAction();
    setLeads(rows);
    setLoading(false);
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  const filtered = useMemo(
    () => leads.filter((l) => (!fAgent || l.agentId === fAgent) && (!fStage || l.status === fStage)),
    [leads, fAgent, fStage]
  );

  const submitAdd = async () => {
    const agentId = form.agentId || agents[0]?.id;
    if (!form.name.trim() || !form.email.trim() || !agentId) { showToast("Name, email, and agent are required"); return; }
    await addLeadAction({ agentId, name: form.name, title: form.title, company: form.company, email: form.email });
    setForm({ name: "", title: "", company: "", email: "", agentId: "" });
    setShowAdd(false);
    showToast("Lead added");
    refetch();
  };

  // Enqueue an outreach run, kick the runner (cookies flow with the browser
  // fetch), then refetch. Small batches complete within the awaited request.
  const runOutreach = async (agentId: string, leadIds?: string[]) => {
    const a = byId(agentId);
    if (!a) return;
    setRunning(leadIds ? leadIds[0] : agentId);
    const res = await enqueueOutreachJob({
      agent: { id: a.id, name: a.name, role: a.role, goal: a.goal, task: a.task },
      leadIds,
    });
    if ("error" in res) { showToast(res.error); setRunning(null); return; }
    try {
      const r = await fetch("/api/jobs/run", { method: "POST" });
      const j = await r.json();
      showToast(j.drafts ? j.drafts + " draft" + (j.drafts === 1 ? "" : "s") + " created" : "No new drafts");
    } catch { showToast("Run failed"); }
    setRunning(null);
    refetch();
  };

  const advance = async (l: LeadDTO) => {
    const idx = LEAD_STAGES.indexOf(l.status as (typeof LEAD_STAGES)[number]);
    const next = LEAD_STAGES[Math.min(LEAD_STAGES.length - 1, idx + 1)];
    if (next === l.status) return;
    await setStageAction(l.id, next);
    refetch();
  };

  return (
    <div style={css("padding:24px 26px;display:flex;flex-direction:column;gap:16px;animation:fadeUp .3s ease")}>
      <div style={css("display:flex;align-items:center;gap:12px;flex-wrap:wrap")}>
        <div style={css("font-size:13px;color:#71717A")}>{leads.length} lead{leads.length === 1 ? "" : "s"} across {agents.length} agents</div>
        <div style={css("margin-left:auto;display:flex;gap:8px;align-items:center")}>
          <select value={fAgent} onChange={(e) => setFAgent(e.target.value)} style={css(INPUT + ";cursor:pointer")}>
            <option value="">All agents</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select value={fStage} onChange={(e) => setFStage(e.target.value)} style={css(INPUT + ";cursor:pointer")}>
            <option value="">All stages</option>
            {LEAD_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <Btn onClick={() => setShowAdd((v) => !v)} style="background:#18181B;color:#fff;border:none;border-radius:99px;padding:9px 16px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#3F3F46">+ Add lead</Btn>
        </div>
      </div>

      {showAdd && (
        <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:14px;padding:16px 18px;display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end")}>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name" style={css(INPUT + ";flex:1;min-width:140px")} />
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Title" style={css(INPUT + ";flex:1;min-width:120px")} />
          <input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="Company" style={css(INPUT + ";flex:1;min-width:120px")} />
          <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Email" style={css(INPUT + ";flex:1;min-width:160px")} />
          <select value={form.agentId} onChange={(e) => setForm({ ...form, agentId: e.target.value })} style={css(INPUT + ";cursor:pointer")}>
            <option value="">{agents[0] ? "Assign: " + agents[0].name : "No agents"}</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <Btn onClick={submitAdd} style="background:#5122C1;color:#fff;border:none;border-radius:99px;padding:9px 18px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#42199E">Add</Btn>
        </div>
      )}

      <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;overflow:hidden")}>
        <div style={css("display:grid;grid-template-columns:1.4fr 1.2fr 1fr .7fr .6fr 1.1fr;padding:11px 18px;font-size:11px;font-weight:600;color:#71717A;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #ECECF1;background:#FAFAFB;gap:10px")}>
          <div>Lead</div><div>Company</div><div>Agent</div><div>Stage</div><div>Score</div><div>Actions</div>
        </div>
        {loading ? (
          <div style={css("padding:20px;font-size:12.5px;color:#A1A1AA")}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={css("padding:20px;font-size:12.5px;color:#A1A1AA")}>No leads yet. Use “Add lead” to create one.</div>
        ) : filtered.map((l) => {
          const a = byId(l.agentId);
          const sc = STAGE_COLORS[l.status] || STAGE_COLORS.new;
          return (
            <div key={l.id} style={css("display:grid;grid-template-columns:1.4fr 1.2fr 1fr .7fr .6fr 1.1fr;padding:12px 18px;font-size:12.5px;border-bottom:1px solid #F4F4F6;align-items:center;gap:10px")}>
              <div style={css("font-weight:600")}>{l.name}<div style={css("font-size:11px;color:#A1A1AA;font-weight:400")}>{l.title || l.email}</div></div>
              <div style={css("color:#3F3F46")}>{l.company || "—"}</div>
              <div style={css("display:flex;align-items:center;gap:7px;min-width:0")}>{a && <div style={css(av(a, 22))}>{a.initials}</div>}<span style={css("white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{a ? a.name : l.agentId}</span></div>
              <div><span style={css(chip(sc[0], sc[1]))}>{l.status}</span></div>
              <div style={css("font-weight:700;color:#5122C1")}>{l.score || "—"}</div>
              <div style={css("display:flex;gap:6px")}>
                <Btn onClick={() => runOutreach(l.agentId, [l.id])} style={"border:none;border-radius:8px;padding:5px 10px;font-size:11.5px;font-weight:600;cursor:pointer;background:#EEE9F8;color:#5122C1;" + (running === l.id ? "opacity:.6" : "")} styleHover="background:#E3DBF9">{running === l.id ? "Running…" : "Run outreach"}</Btn>
                <Btn onClick={() => advance(l)} style="border:none;border-radius:8px;padding:5px 10px;font-size:11.5px;font-weight:600;cursor:pointer;background:#F4F4F5;color:#3F3F46" styleHover="background:#E4E4E7">Advance</Btn>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Browser verification (the core integration check)**

Ensure the dev server is up (`curl -s -o /dev/null -w "%{http_code}" http://localhost:3001` → `200`). In the browser (logged in):
1. Sidebar now shows a **Leads** item; click it → `/leads` renders "0 leads across N agents", empty table.
2. Click **+ Add lead**, fill Name `Dana Liu`, Title `VP Data`, Company `Ramp`, Email `dana@ramp.com`, assign an agent, click **Add** → toast "Lead added", the lead appears with stage `new`, score `—`.
3. Reload the page → the lead is still there (persisted).
4. Click **Run outreach** on the row → button shows "Running…", then a toast "1 draft created"; the lead's **Score** fills in and **Stage** advances off `new`.
5. Confirm at the DB level (optional): the drafts exist — this is verified visually in Task 6. For now, a second **Run outreach** on the same lead shows "No new drafts" (idempotent skip).
6. Filters: pick an agent / stage in the dropdowns → the table narrows correctly.

- [ ] **Step 6: Commit**

```bash
git add lib/visuals.ts components/Shell.tsx app/leads/page.tsx
git commit -m "Add Leads module page + sidebar nav with add-lead and run-outreach"
```

---

### Task 6: Agent-detail Emails tab — real drafts + two-button send

**Files:**
- Modify: `app/agents/[id]/page.tsx`

**Interfaces:**
- Consumes: `@/lib/leads/actions` (`listDraftsForAgent`, `markDraftSent`), `@/lib/jobs/actions` (`enqueueOutreachJob`), `@/lib/leads/types` (`DraftDTO`).
- Produces: the Emails section renders real `outreach_drafts` for `sel.id` with **Open in mail** (mailto) + **Mark sent** buttons, plus a **Run outreach** button. New state `drafts` + `runningOutreach`, refetched on agent change and after a run/send.

- [ ] **Step 1: Add imports** at the top of `app/agents/[id]/page.tsx` (after the existing imports)

```typescript
import { listDraftsForAgent, markDraftSent } from "@/lib/leads/actions";
import { enqueueOutreachJob } from "@/lib/jobs/actions";
import type { DraftDTO } from "@/lib/leads/types";
```

- [ ] **Step 2: Add draft state + handlers** inside `AgentDetail`, immediately after the existing `detail` `useMemo` (before `if (!sel || !detail) return null;`)

```typescript
  const [drafts, setDrafts] = useState<DraftDTO[]>([]);
  const [runningOutreach, setRunningOutreach] = useState(false);

  const refetchDrafts = useCallback(async (id: string) => {
    setDrafts(await listDraftsForAgent(id));
  }, []);
  useEffect(() => {
    if (selId) refetchDrafts(selId);
  }, [selId, refetchDrafts]);

  const runOutreachForAgent = useCallback(async () => {
    if (!sel) return;
    setRunningOutreach(true);
    const res = await enqueueOutreachJob({ agent: { id: sel.id, name: sel.name, role: sel.role, goal: sel.goal, task: sel.task } });
    if (!("error" in res)) {
      try { await fetch("/api/jobs/run", { method: "POST" }); } catch { /* surfaced below */ }
    }
    setRunningOutreach(false);
    refetchDrafts(sel.id);
  }, [sel, refetchDrafts]);

  const sendDraft = useCallback(async (d: DraftDTO) => {
    const url = "mailto:" + encodeURIComponent(d.leadEmail) + "?subject=" + encodeURIComponent(d.subject) + "&body=" + encodeURIComponent(d.body);
    window.open(url, "_blank");
  }, []);

  const confirmSent = useCallback(async (d: DraftDTO) => {
    await markDraftSent(d.id);
    if (selId) refetchDrafts(selId);
  }, [selId, refetchDrafts]);
```

Note: `useCallback` and `useMemo` must be imported from React. Confirm the top import line is `import { useState, useEffect, useMemo, useCallback } from "react";` — add `useCallback` if missing.

- [ ] **Step 3: Replace the Emails section body.** Find the Emails block (starts at `{/* Emails */}` / `<SectionTitle id="sec-emails">Emails</SectionTitle>`) and replace the `<div ...>` that currently renders `detail.emailStats` + `detail.emailTimeline` with this real-drafts version:

```tsx
      {/* Emails */}
      <SectionTitle id="sec-emails">Emails</SectionTitle>
      <div style={css("display:flex;flex-direction:column;gap:14px;animation:fadeUp .25s ease")}>
        <div style={css("display:flex;align-items:center;gap:10px")}>
          <div style={css("font-size:12.5px;color:#71717A")}>{drafts.length} draft{drafts.length === 1 ? "" : "s"} · {drafts.filter((d) => d.status === "sent").length} sent</div>
          <Btn onClick={runOutreachForAgent} style={"margin-left:auto;background:#5122C1;color:#fff;border:none;border-radius:99px;padding:8px 16px;font-size:12.5px;font-weight:600;cursor:pointer;" + (runningOutreach ? "opacity:.6" : "")} styleHover="background:#42199E">{runningOutreach ? "Running…" : "Run outreach"}</Btn>
        </div>
        {drafts.length === 0 ? (
          <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:22px;font-size:12.5px;color:#A1A1AA")}>No drafts yet. Add leads in the Leads tab, then hit “Run outreach”.</div>
        ) : drafts.map((d) => (
          <div key={d.id} style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:16px 18px")}>
            <div style={css("display:flex;align-items:center;gap:8px")}>
              <span style={css(chip(d.status === "sent" ? "#E7F7EC" : "#F1EDFD", d.status === "sent" ? "#1B7A3D" : "#5122C1"))}>{d.status === "sent" ? "Sent" : "Draft"}</span>
              <div style={css("font-size:11.5px;color:#A1A1AA")}>to {d.leadName}{d.leadCompany ? " · " + d.leadCompany : ""} · {d.leadEmail}</div>
            </div>
            <div style={css("font-size:13.5px;font-weight:700;margin-top:10px")}>{d.subject}</div>
            <div style={css("font-size:12.5px;color:#3F3F46;line-height:1.6;margin-top:6px;white-space:pre-wrap")}>{d.body}</div>
            <div style={css("display:flex;gap:8px;margin-top:12px")}>
              <Btn onClick={() => sendDraft(d)} style="background:#EEE9F8;color:#5122C1;border:none;border-radius:99px;padding:7px 16px;font-size:12px;font-weight:600;cursor:pointer" styleHover="background:#E3DBF9">Open in mail</Btn>
              {d.status !== "sent" && <Btn onClick={() => confirmSent(d)} style="background:#F4F4F5;color:#3F3F46;border:none;border-radius:99px;padding:7px 16px;font-size:12px;font-weight:600;cursor:pointer" styleHover="background:#E4E4E7">Mark sent</Btn>}
            </div>
          </div>
        ))}
      </div>
```

The `pastel` module const and `detail.emailStats` / `detail.emailTimeline` are no longer used in this section. Leave `pastel` (still referenced elsewhere? if `npx tsc --noEmit` flags it as unused, remove the `pastel` const). `detail.emailStats`/`emailTimeline` remain defined in `lib/agentDetail.ts` (harmless; used by nothing now — leave them, a later milestone removes the synthetic model wholesale).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0. If it reports `pastel` unused, delete the `const pastel = [...]` block at the top of the file and re-run.

- [ ] **Step 5: Browser verification**

1. Open an agent that has a lead with a generated draft (from Task 5): `/agents/<id>` → Emails tab → the real draft shows subject + body + `to: …`.
2. Click **Open in mail** → the OS/browser mail compose opens with the recipient, subject, and body pre-filled (verify all three).
3. Click **Mark sent** → the card flips to a green **Sent** chip, the "Mark sent" button disappears, and (check the Leads tab or `/leads`) the lead's stage advanced to `contacted`.
4. Click **Run outreach** on an agent that has an un-drafted lead → a new draft appears without leaving the page.

- [ ] **Step 6: Commit**

```bash
git add "app/agents/[id]/page.tsx"
git commit -m "Wire agent Emails tab to real drafts with mailto send + run outreach"
```

---

### Task 7: Agent-detail Leads tab — real, agent-scoped

**Files:**
- Modify: `app/agents/[id]/page.tsx`

**Interfaces:**
- Consumes: `@/lib/leads/actions` (`listLeads`), `@/lib/leads/types` (`LeadDTO`), plus `next/link` for the "Open Leads module" link.
- Produces: the Leads section renders real `leads` where `agentId = sel.id`, replacing `detail.leads`.

- [ ] **Step 1: Extend imports** — add to the leads-actions import from Task 6 so it reads:

```typescript
import { listLeads, listDraftsForAgent, markDraftSent } from "@/lib/leads/actions";
import type { DraftDTO, LeadDTO } from "@/lib/leads/types";
import Link from "next/link";
```

- [ ] **Step 2: Add real-leads state + fetch** next to the drafts state added in Task 6:

```typescript
  const [agentLeads, setAgentLeads] = useState<LeadDTO[]>([]);
  useEffect(() => {
    if (selId) listLeads({ agentId: selId }).then(setAgentLeads);
  }, [selId]);
```

- [ ] **Step 3: Add a stage-color map** near the top of the file (after the existing module consts):

```typescript
const LEAD_STAGE_COLORS: Record<string, [string, string]> = {
  new: ["#F4F4F5", "#71717A"], contacted: ["#FEF6E8", "#B45309"], engaged: ["#E9F5FE", "#0369A1"],
  replied: ["#E7F7EC", "#1B7A3D"], meeting: ["#F1EDFD", "#5122C1"],
};
```

- [ ] **Step 4: Replace the Leads section.** Find the block starting `{/* Leads */}` / `<SectionTitle id="sec-leads">{detail.leadTitle}</SectionTitle>` and replace the whole table `<div>` with this real version:

```tsx
      {/* Leads */}
      <SectionTitle id="sec-leads">Leads</SectionTitle>
      <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;overflow:hidden;animation:fadeUp .25s ease")}>
        <div style={css("display:flex;align-items:center;padding:11px 18px;border-bottom:1px solid #ECECF1;background:#FAFAFB")}>
          <div style={css("font-size:11px;font-weight:600;color:#71717A;text-transform:uppercase;letter-spacing:.05em")}>{agentLeads.length} lead{agentLeads.length === 1 ? "" : "s"}</div>
          <Link href="/leads" style={{ ...css("margin-left:auto;font-size:12px;font-weight:600;color:#5122C1;text-decoration:none") }}>Open Leads module →</Link>
        </div>
        {agentLeads.length === 0 ? (
          <div style={css("padding:18px;font-size:12.5px;color:#A1A1AA")}>No leads assigned to {sel.name} yet. Add one in the Leads module.</div>
        ) : (
          <>
            <div style={css("display:grid;grid-template-columns:1.4fr 1.2fr .9fr .6fr .9fr;padding:11px 18px;font-size:11px;font-weight:600;color:#71717A;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #ECECF1;gap:10px")}>
              <div>Name</div><div>Company</div><div>Status</div><div>Score</div><div>Added</div>
            </div>
            {agentLeads.map((l) => {
              const sc = LEAD_STAGE_COLORS[l.status] || LEAD_STAGE_COLORS.new;
              return (
                <div key={l.id} style={css("display:grid;grid-template-columns:1.4fr 1.2fr .9fr .6fr .9fr;padding:12px 18px;font-size:12.5px;border-bottom:1px solid #F4F4F6;align-items:center;gap:10px")}>
                  <div style={css("font-weight:600")}>{l.name}<div style={css("font-size:11px;color:#A1A1AA;font-weight:400")}>{l.title || l.email}</div></div>
                  <div style={css("color:#3F3F46")}>{l.company || "—"}</div>
                  <div><span style={css(chip(sc[0], sc[1]))}>{l.status}</span></div>
                  <div style={css("font-weight:700;color:#5122C1")}>{l.score || "—"}</div>
                  <div style={css("color:#71717A")}>{new Date(l.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
                </div>
              );
            })}
          </>
        )}
      </div>
```

The `detail.leads` / `detail.leadTitle` / `detail.leadStatusColors` are no longer used by this section (they remain in `lib/agentDetail.ts` for the still-synthetic tabs). If `npx tsc --noEmit` flags an unused local from the old block, remove it.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Browser verification**

1. `/agents/<id>` → Leads tab shows only the leads whose agent is this one, with real name/company/status/score and the "Open Leads module →" link.
2. An agent with no leads shows the empty state naming that agent.
3. Cross-check isolation: log in as a second account → its agents show none of the first account's leads (leads are per-user).

- [ ] **Step 7: Commit**

```bash
git add "app/agents/[id]/page.tsx"
git commit -m "Wire agent Leads tab to real agent-scoped leads"
```

---

## Self-Review

**1. Spec coverage:**
- Data model (`leads`, `outreach_drafts`, `activity`, `jobs`) → Task 1. ✓
- Leads module (`lib/leads` + `/leads` page + nav, agent tab as scoped view) → Tasks 2, 5, 7. ✓
- Job/worker seam (enqueue → claim → run → finish; runner as Node route handler) → Task 4. ✓
- Outreach engine (`geminiJSON` + `draftOutreach`, one structured call, failure handling, no-research honesty) → Task 3; per-lead try/catch in Task 4 runner. ✓
- Human-in-the-loop send (Emails tab real drafts, two-button "Open in mail" + "Mark sent", stage advance, activity) → Task 6 + `markDraftSent` in Task 2. ✓
- Per-view fetch, not global store → Tasks 5–7 use server-action fetches in `useEffect`. ✓
- `activity` rows written for `lead_added` / `email_drafted` / `email_sent` → Task 2 store functions. ✓ (`lead_qualified` is folded into `email_drafted`; acceptable — the spec lists activity types as examples.)
- Deferred items (scraper, scheduling, permission enforcement, remaining synthetic tabs) → untouched, as intended. ✓

**2. Placeholder scan:** No `TBD`/`TODO`/"handle edge cases" — every code step is complete and copy-pasteable. ✓

**3. Type consistency:** `AgentSnapshot` `{id,name,role,goal,task}` is produced in Task 1 and consumed identically in Tasks 3/4/5/6. `OutreachResult` `{score,stage,subject,body,rationale}` matches between `draftOutreach` (Task 3) and `applyOutreachResult` (Task 2). `LeadDTO`/`DraftDTO` field names match across store (Task 2), page (Task 5), and agent tabs (Tasks 6/7). `enqueueOutreachJob` return shape `{jobId}|{error}` is checked with `"error" in res` in every caller. ✓

**Note on the run trigger:** the plan has the **client** call `fetch("/api/jobs/run")` after enqueue (browser fetch carries the session cookie, so the runner authenticates and drains that user's jobs), rather than the server action issuing a cookie-less fetch. This is a deliberate, faithful realization of the spec's "kick the runner after enqueue" seam — the `jobs` table, claim logic, and externalization path are exactly as specified; only the trigger's origin is the browser. Small batches complete within the awaited request, so no separate polling loop is needed for Milestone 1 (`getJob` still exists for the scheduler/worker path).
