# Research Agent + No-Email Send Path — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `research` capability (Gemini brief per lead that feeds better outreach) and make no-email scraped leads actionable (channel-aware DM drafting + a Copy-message / Open-profile send path).

**Architecture:** Same harness as outreach — a capability is a `jobs.kind`, each engine is one structured `geminiJSON` call per lead, and the Node runner claims jobs and switches on kind. Research briefs live in a `leads.research` JSONB column; the outreach engine consumes the brief and branches its prompt by channel (email vs DM).

**Tech Stack:** Next.js 14 App Router / TypeScript / Drizzle / Neon / Gemini REST (`geminiJSON`).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-07-research-agent-and-no-email-send-design.md`.
- **Git identity:** commit as the user only — `Ghousted <clydepadua091@gmail.com>`. **Never** add a `Co-Authored-By: Claude` line or any AI attribution.
- **No push.** `.env.local` stays gitignored and is never committed.
- **No unit-test framework.** Verification is `npx tsc --noEmit` (from `agentic-salesforce/`) clean, applying the migration, and code review. Do not add a test framework.
- **User-scoping:** every `leads` / `jobs` / `outreach_drafts` / `activity` read and write filters by the session `userId` (existing pattern).
- **Follow patterns:** engines mirror `lib/ai/outreach.ts` (system prompt + `geminiJSON` + graceful no-Gemini fallback, pure/no-DB); store functions mirror the existing ones; UI uses `css()`/`chip()`/`Btn`/`Box`.
- **Capability ids** are `"scrape" | "outreach" | "follow-up" | "book-meeting" | "research"` (this plan adds `research`); a capability id equals its `jobs.kind`.
- **The Python worker still owns `scrape`** — the Node runner must never claim `scrape` (it claims only `outreach` + `research`).

---

## File Structure

- `lib/db/schema.ts` — MODIFY: `leads.research` JSONB column.
- `lib/db/migrations/NNNN_*.sql` — CREATE (generated).
- `lib/leads/types.ts` — MODIFY: `ResearchBrief`; `LeadDTO.research`; `DraftDTO.leadProfileUrl`/`leadPlatform`.
- `lib/leads/store.ts` — MODIFY: `toLeadDTO` maps `research`; `listDraftsForAgent` selects profileUrl/platform; `pickLeadsForResearch` + `applyResearchResult`; remove the `ne(email,"")` filter from `pickLeadsForRun`.
- `lib/agentTypes.ts` — MODIFY: `research` capability + Research Agent type + `research` on SDR.
- `lib/ai/research.ts` — CREATE: `draftResearch` engine.
- `lib/ai/outreach.ts` — MODIFY: channel-aware prompt + optional `research`/`platform`.
- `app/api/jobs/run/route.ts` — MODIFY: claim `outreach`+`research`; `research` branch; pass `platform`/`research` to `draftOutreach`.
- `app/agents/[id]/page.tsx` — MODIFY: Research section + "Research leads" trigger; no-email send controls on draft cards.

---

## Task 1: Data model — `leads.research`, types, store mappings

**Files:**
- Modify: `lib/db/schema.ts`
- Modify: `lib/leads/types.ts`
- Modify: `lib/leads/store.ts:17-23` (`toLeadDTO`), `:71-86` (`listDraftsForAgent`)
- Create: `lib/db/migrations/NNNN_*.sql` (generated)

**Interfaces:**
- Produces: `leads.research` JSONB column; `ResearchBrief` interface; `LeadDTO.research: ResearchBrief | null`; `DraftDTO.leadProfileUrl: string | null` + `leadPlatform: string | null`. `LeadRow` (`typeof leads.$inferSelect`) gains `research`.

- [ ] **Step 1: Add the column.** In `lib/db/schema.ts`, inside the `leads` table, after `platform: text("platform"),`, add:

```ts
    research: jsonb("research").$type<{ summary: string; priorities: string[]; hooks: string[]; angle: string }>(),
```

(`jsonb` is already imported in `schema.ts`.)

- [ ] **Step 2: Add the DTO types.** In `lib/leads/types.ts`, add the `ResearchBrief` interface (after `LeadStage`, ~line 5):

```ts
export interface ResearchBrief {
  summary: string;
  priorities: string[];
  hooks: string[];
  angle: string;
}
```

Add `research` to `LeadDTO` (after `platform: string | null;`):

```ts
  research: ResearchBrief | null;
```

Add two fields to `DraftDTO` (after `leadEmail: string;`):

```ts
  leadProfileUrl: string | null;
  leadPlatform: string | null;
```

- [ ] **Step 3: Map `research` in `toLeadDTO`.** In `lib/leads/store.ts`, add `research: r.research ?? null,` to the returned object (alongside `platform: r.platform,`):

```ts
    email: r.email, status: r.status, score: r.score, source: r.source, profileUrl: r.profileUrl, platform: r.platform, research: r.research ?? null,
```

- [ ] **Step 4: Select profileUrl/platform in `listDraftsForAgent`.** In `lib/leads/store.ts`, update the join `select` and the mapping (lines 75-85):

```ts
  const rows = await getDb().select({
    d: outreachDrafts, leadName: leads.name, leadCompany: leads.company, leadEmail: leads.email,
    leadProfileUrl: leads.profileUrl, leadPlatform: leads.platform,
  }).from(outreachDrafts)
    .innerJoin(leads, eq(outreachDrafts.leadId, leads.id))
    .where(and(eq(outreachDrafts.userId, userId), eq(outreachDrafts.agentId, agentId)))
    .orderBy(desc(outreachDrafts.createdAt));
  return rows.map(({ d, leadName, leadCompany, leadEmail, leadProfileUrl, leadPlatform }) => ({
    id: d.id, agentId: d.agentId, leadId: d.leadId, subject: d.subject, body: d.body,
    rationale: d.rationale, status: d.status, createdAt: d.createdAt.toISOString(),
    sentAt: d.sentAt ? d.sentAt.toISOString() : null, leadName, leadCompany, leadEmail, leadProfileUrl, leadPlatform,
  }));
```

- [ ] **Step 5: Generate + apply the migration.**

Run: `cd agentic-salesforce && pnpm db:generate`
Expected: a new `lib/db/migrations/NNNN_*.sql` with `ALTER TABLE "leads" ADD COLUMN "research" jsonb;`. Open it and confirm.
Run: `cd agentic-salesforce && pnpm db:migrate`
Expected: `✓ applied: NNNN_*.sql`.

- [ ] **Step 6: Type-check.**

Run: `cd agentic-salesforce && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit.**

```bash
git add agentic-salesforce/lib/db/schema.ts agentic-salesforce/lib/leads/types.ts agentic-salesforce/lib/leads/store.ts agentic-salesforce/lib/db/migrations
git commit -m "Add leads.research column + ResearchBrief/DraftDTO fields"
```

---

## Task 2: Catalog — `research` capability, Research Agent type

**Files:**
- Modify: `lib/agentTypes.ts`

**Interfaces:**
- Produces: `"research"` in the `Capability` union; a `research` entry in `CAPABILITIES` (`jobKind: "research"`, `engineReady: true`); a `researcher` agent type; `research` added to `sdr`.

- [ ] **Step 1: Extend the union.** In `lib/agentTypes.ts` line 5, change:

```ts
export type Capability = "scrape" | "outreach" | "follow-up" | "book-meeting" | "research";
```

- [ ] **Step 2: Add the capability.** In the `CAPABILITIES` array, add (after the `scrape` entry, so research reads first):

```ts
  { id: "research", label: "Lead research", desc: "Enrich prospects with a research brief", jobKind: "research", engineReady: true },
```

- [ ] **Step 3: Add `research` to SDR + a Research Agent type.** In `AGENT_TYPES`, change the `sdr` entry's capabilities to lead with `research`, and add a `researcher` type after `scout`:

```ts
  { id: "sdr", label: "SDR", desc: "Full-funnel prospector — finds, writes, and follows up.", capabilities: ["research", "scrape", "outreach", "follow-up"] },
```

```ts
  { id: "researcher", label: "Research Agent", desc: "Enriches prospects with research briefs.", capabilities: ["research"] },
```

- [ ] **Step 4: Type-check.**

Run: `cd agentic-salesforce && npx tsc --noEmit`
Expected: no errors. (The `Capability` union widened; existing consumers still compile.)

- [ ] **Step 5: Commit.**

```bash
git add agentic-salesforce/lib/agentTypes.ts
git commit -m "Add research capability + Research Agent type; research on SDR"
```

---

## Task 3: Research engine + runner research path

**Files:**
- Create: `lib/ai/research.ts`
- Modify: `lib/leads/store.ts` (add `pickLeadsForResearch` + `applyResearchResult`; import `ResearchBrief`)
- Modify: `app/api/jobs/run/route.ts`

**Interfaces:**
- Consumes: `ResearchBrief`, `LeadRow` (Task 1); `geminiJSON` (existing).
- Produces: `draftResearch(agent, lead) → Promise<ResearchBrief>`; `pickLeadsForResearch(userId, agentId, leadIds, batchSize) → Promise<LeadRow[]>`; `applyResearchResult(userId, agentId, lead, brief) → Promise<void>`. The runner now claims `outreach`+`research` and processes `research` jobs.

- [ ] **Step 1: Write the research engine.** Create `lib/ai/research.ts`:

```ts
import "server-only";
// The research engine: one structured Gemini call per lead that produces a
// personalization brief. Pure — no DB. Mirrors lib/ai/outreach.ts.
import { geminiJSON, isGeminiConfigured, type Turn } from "./gemini";
import type { AgentSnapshot, ResearchBrief } from "@/lib/leads/types";

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    priorities: { type: "array", items: { type: "string" } },
    hooks: { type: "array", items: { type: "string" } },
    angle: { type: "string" },
  },
  required: ["summary", "priorities", "hooks", "angle"],
} as const;

function systemPrompt(a: AgentSnapshot): string {
  return [
    `You are ${a.name}, an AI research assistant on a B2B sales team.`,
    `Your objective: ${a.goal}.`,
    `Given ONE prospect, produce a concise research brief that helps a teammate personalize outreach.`,
    `Reason from the prospect's title, company, and platform using what you know about that kind of company and role.`,
    `Return: a 2-3 sentence summary; 3-5 likely priorities or pain points; 3-5 specific personalization hooks a rep could reference; and one recommended outreach angle.`,
    `Be concrete and specific — avoid generic filler. Return ONLY JSON matching the schema.`,
  ].join(" ");
}

export async function draftResearch(agent: AgentSnapshot, lead: { name: string; title: string; company: string; platform?: string | null }): Promise<ResearchBrief> {
  if (!isGeminiConfigured()) {
    return {
      summary: `${lead.name}${lead.title ? ", " + lead.title : ""}${lead.company ? " at " + lead.company : ""}. Research brief unavailable (Gemini not configured).`,
      priorities: ["Operational efficiency", "Cost control", "Growth"],
      hooks: [lead.company ? `Reference ${lead.company}'s space` : "Reference their role"],
      angle: "Lead with a specific, relevant value proposition.",
    };
  }
  const turns: Turn[] = [{
    role: "user",
    text: `Prospect:\nName: ${lead.name}\nTitle: ${lead.title || "(unknown)"}\nCompany: ${lead.company || "(unknown)"}\nPlatform: ${lead.platform || "(unknown)"}`,
  }];
  const r = await geminiJSON<ResearchBrief>(systemPrompt(agent), turns, SCHEMA as unknown as Record<string, unknown>, { maxTokens: 700, temperature: 0.6 });
  return {
    summary: (r.summary || "").trim(),
    priorities: Array.isArray(r.priorities) ? r.priorities : [],
    hooks: Array.isArray(r.hooks) ? r.hooks : [],
    angle: (r.angle || "").trim(),
  };
}
```

- [ ] **Step 2: Add store helpers.** In `lib/leads/store.ts`, update the type import (line 8) to include `ResearchBrief`:

```ts
import { LEAD_STAGES, type LeadDTO, type DraftDTO, type OutreachResult, type ResearchBrief } from "./types";
```

Then, after `applyOutreachResult` (end of file), add:

```ts
/** Pick the agent's leads that don't have a research brief yet (or the given
 *  ids), oldest first, capped. */
export async function pickLeadsForResearch(userId: string, agentId: string, leadIds: string[] | undefined, batchSize: number): Promise<LeadRow[]> {
  const db = getDb();
  if (leadIds && leadIds.length) {
    return db.select().from(leads)
      .where(and(eq(leads.userId, userId), eq(leads.agentId, agentId), inArray(leads.id, leadIds)))
      .limit(batchSize);
  }
  const all = await db.select().from(leads)
    .where(and(eq(leads.userId, userId), eq(leads.agentId, agentId))).orderBy(asc(leads.createdAt));
  return all.filter((l) => !l.research).slice(0, batchSize);
}

/** Persist one research brief onto the lead + log activity. */
export async function applyResearchResult(userId: string, agentId: string, lead: LeadRow, brief: ResearchBrief): Promise<void> {
  const db = getDb();
  await db.update(leads).set({ research: brief, updatedAt: new Date() })
    .where(and(eq(leads.id, lead.id), eq(leads.userId, userId)));
  await db.insert(activity).values({ userId, agentId, type: "lead_researched", leadId: lead.id, text: `Researched ${lead.name}` });
}
```

- [ ] **Step 3: Broaden the runner claim + add the research branch.** In `app/api/jobs/run/route.ts`:

Change the import on line 2 to add `inArray`:
```ts
import { and, asc, eq, inArray } from "drizzle-orm";
```
Add to the imports on lines 5-6:
```ts
import { pickLeadsForRun, applyOutreachResult, pickLeadsForResearch, applyResearchResult } from "@/lib/leads/store";
import { draftOutreach } from "@/lib/ai/outreach";
import { draftResearch } from "@/lib/ai/research";
```
Change the candidate query (line 27-28) to claim both kinds:
```ts
    const [candidate] = await db.select().from(jobs)
      .where(and(eq(jobs.userId, userId), eq(jobs.status, "queued"), inArray(jobs.kind, ["outreach", "research"]))).orderBy(asc(jobs.createdAt)).limit(1);
```
Add a `briefed` counter next to `drafts` (line 24):
```ts
  let drafts = 0;
  let briefed = 0;
```
Wrap the existing batch body (lines 40-54) so outreach stays as-is and research is a sibling branch. Replace the `try { … } catch` inner block's `try` body with:
```ts
    try {
      if (candidate.kind === "outreach") {
        const batch = await pickLeadsForRun(userId, params.agent.id, params.leadIds ?? undefined, params.batchSize ?? 5);
        for (const lead of batch) {
          try {
            const result = await draftOutreach(params.agent, { name: lead.name, title: lead.title, company: lead.company, email: lead.email });
            await applyOutreachResult(userId, params.agent.id, lead, result);
            created++;
            drafts++;
          } catch (e) {
            console.error("[jobs/run] lead failed:", e);
            failed++;
          }
        }
        await db.update(jobs).set({ status: "done", finishedAt: new Date(), result: { draftsCreated: created, failed } })
          .where(and(eq(jobs.id, candidate.id), eq(jobs.userId, userId)));
      } else {
        // research
        const batch = await pickLeadsForResearch(userId, params.agent.id, params.leadIds ?? undefined, params.batchSize ?? 5);
        for (const lead of batch) {
          try {
            const brief = await draftResearch(params.agent, { name: lead.name, title: lead.title, company: lead.company, platform: lead.platform });
            await applyResearchResult(userId, params.agent.id, lead, brief);
            created++;
            briefed++;
          } catch (e) {
            console.error("[jobs/run] research failed:", e);
            failed++;
          }
        }
        await db.update(jobs).set({ status: "done", finishedAt: new Date(), result: { briefed: created, failed } })
          .where(and(eq(jobs.id, candidate.id), eq(jobs.userId, userId)));
      }
    } catch (e) {
```
Change the final response (line 61) to include `briefed`:
```ts
  return NextResponse.json({ processed, drafts, briefed });
```

- [ ] **Step 4: Type-check.**

Run: `cd agentic-salesforce && npx tsc --noEmit`
Expected: no errors. (`lead.platform`/`lead.research` exist on `LeadRow` from Task 1; `draftResearch`/`pickLeadsForResearch`/`applyResearchResult` resolve. The outreach branch's `draftOutreach` call is unchanged here — Task 4 extends it.)

- [ ] **Step 5: Commit.**

```bash
git add agentic-salesforce/lib/ai/research.ts agentic-salesforce/lib/leads/store.ts agentic-salesforce/app/api/jobs/run/route.ts
git commit -m "Research engine + runner research branch (Gemini brief per lead)"
```

---

## Task 4: Outreach — channel-aware + research-fed + un-gate no-email leads

**Files:**
- Modify: `lib/ai/outreach.ts`
- Modify: `lib/leads/store.ts` (`pickLeadsForRun`: remove the `ne(email,"")` filter)
- Modify: `app/api/jobs/run/route.ts` (outreach branch passes `platform`/`research`)

**Interfaces:**
- Consumes: `ResearchBrief` (Task 1).
- Produces: `draftOutreach(agent, lead)` where `lead` gains optional `platform?: string | null` and `research?: ResearchBrief | null`, and the prompt branches email vs DM. No-email leads are once again eligible for outreach.

- [ ] **Step 1: Rewrite the outreach engine.** Replace the body of `lib/ai/outreach.ts` (keep the `SCHEMA` const as-is) with a channel-aware version:

```ts
import "server-only";
// The outreach engine: one structured Gemini call per lead that qualifies
// (score + stage) and drafts personalized outreach — a formal email when the
// lead has an email, or a short platform DM when it only has a profile. Uses
// the lead's research brief when present. Pure — no DB.
import { geminiJSON, isGeminiConfigured, type Turn } from "./gemini";
import type { AgentSnapshot, OutreachResult, ResearchBrief } from "@/lib/leads/types";

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

function systemPrompt(a: AgentSnapshot, channel: "email" | "dm", platform?: string | null): string {
  const lines = [
    `You are ${a.name}, an AI ${a.role} on a B2B sales team.`,
    `Your objective: ${a.goal}. Current focus: ${a.task}.`,
    `Given ONE prospect, do two things: (1) score their fit for your objective from 0 to 100 and pick the best pipeline stage, (2) write personalized outreach.`,
  ];
  if (channel === "email") {
    lines.push(`Write a concise, personalized cold EMAIL specific to the prospect's title and company, with a plausible business reason to reach out, aligned with your objective. 90-140 words, plain text, first person as ${a.name}, no placeholder tokens like [Company], and end with a soft call to action. Put the subject line in "subject" and the email body in "body".`);
  } else {
    lines.push(`This prospect has no email — you will reach them by direct message on ${platform || "their platform"}. Write a SHORT, casual direct message (2-4 sentences), first person as ${a.name}, that opens naturally, references something specific about them, and ends with a light ask. No formal email signature, no "Dear ...". Put a one-line context label in "subject" and the message text in "body".`);
  }
  lines.push(`Return ONLY JSON matching the schema.`);
  return lines.join(" ");
}

export async function draftOutreach(
  agent: AgentSnapshot,
  lead: { name: string; title: string; company: string; email: string; platform?: string | null; research?: ResearchBrief | null }
): Promise<OutreachResult> {
  const hasEmail = !!(lead.email && lead.email.trim());
  const channel: "email" | "dm" = hasEmail ? "email" : "dm";
  const first = lead.name.split(" ")[0] || "there";

  if (!isGeminiConfigured()) {
    if (hasEmail) {
      return { score: 60, stage: "contacted", subject: `Quick idea for ${lead.company || "your team"}`, body: `Hi ${first},\n\nI'm ${agent.name}, ${agent.role}. I work with ${lead.title || "leaders"} on ${agent.goal}. Would a short call next week be worth 15 minutes?\n\nBest,\n${agent.name}`, rationale: "Fallback draft (Gemini not configured)." };
    }
    return { score: 55, stage: "contacted", subject: `Message to ${first}`, body: `Hi ${first}! I'm ${agent.name} — I work on ${agent.goal}. Saw your ${lead.title || "work"}${lead.company ? " at " + lead.company : ""} and thought it might be worth a quick chat. Open to it?`, rationale: "Fallback DM (Gemini not configured)." };
  }

  const researchBlock = lead.research
    ? `\n\nResearch brief (use these specifics to personalize):\nSummary: ${lead.research.summary}\nPriorities: ${(lead.research.priorities || []).join("; ")}\nHooks: ${(lead.research.hooks || []).join("; ")}\nRecommended angle: ${lead.research.angle}`
    : "";
  const contact = hasEmail ? `Email: ${lead.email}` : `Platform: ${lead.platform || "(unknown)"} (no email — direct message)`;
  const turns: Turn[] = [{
    role: "user",
    text: `Prospect:\nName: ${lead.name}\nTitle: ${lead.title || "(unknown)"}\nCompany: ${lead.company || "(unknown)"}\n${contact}${researchBlock}`,
  }];
  const r = await geminiJSON<OutreachResult>(systemPrompt(agent, channel, lead.platform), turns, SCHEMA as unknown as Record<string, unknown>, { maxTokens: 700, temperature: 0.6 });
  return {
    score: typeof r.score === "number" ? r.score : 50,
    stage: r.stage || "contacted",
    subject: (r.subject || (hasEmail ? `Quick note for ${lead.company || "you"}` : `Message to ${first}`)).trim(),
    body: (r.body || "").trim(),
    rationale: (r.rationale || "").trim(),
  };
}
```

- [ ] **Step 2: Un-gate no-email leads.** In `lib/leads/store.ts` `pickLeadsForRun`, remove `ne(leads.email, "")` from BOTH branches (lines 111 and 118):

```ts
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
```

If `ne` is now unused elsewhere in the file, remove it from the `drizzle-orm` import on line 5 (change `import { and, desc, eq, inArray, asc, ne } from "drizzle-orm";` to drop `ne`) to keep tsc/lint clean.

- [ ] **Step 3: Pass platform + research from the runner.** In `app/api/jobs/run/route.ts`, in the **outreach** branch, change the `draftOutreach` call to forward the new fields:

```ts
            const result = await draftOutreach(params.agent, { name: lead.name, title: lead.title, company: lead.company, email: lead.email, platform: lead.platform, research: lead.research });
```

- [ ] **Step 4: Type-check.**

Run: `cd agentic-salesforce && npx tsc --noEmit`
Expected: no errors. (`lead.platform`/`lead.research` are on `LeadRow`; `draftOutreach` now accepts them.)

- [ ] **Step 5: Commit.**

```bash
git add agentic-salesforce/lib/ai/outreach.ts agentic-salesforce/lib/leads/store.ts agentic-salesforce/app/api/jobs/run/route.ts
git commit -m "Channel-aware outreach (email vs DM), research-fed drafts, un-gate no-email leads"
```

---

## Task 5: UI — Research section + trigger + no-email send controls

**Files:**
- Modify: `app/agents/[id]/page.tsx`

**Interfaces:**
- Consumes: `enqueueJob`/`getJob` (already imported); `listLeads` (already imported); `agentLeads` now carry `research`; `DraftDTO.leadProfileUrl`/`leadPlatform` (Task 1); `sel.capabilities`.

- [ ] **Step 1: Add `research` to the section map.** In `app/agents/[id]/page.tsx`, in the `SECTIONS` array, insert a Research entry between `leads` and `emails`:

```ts
  ["overview", "Overview"],
  ["leads", "Leads"],
  ["research", "Research", "research"],
  ["emails", "Emails", "outreach"],
```

- [ ] **Step 2: Add research run state + handler.** Near the other run state (`const [runningScrape, setRunningScrape] = useState(false);`), add:

```ts
  const [runningResearch, setRunningResearch] = useState(false);
```

After the `runScrape` callback, add:

```ts
  const runResearch = useCallback(async () => {
    if (!sel) return;
    setRunningResearch(true);
    const res = await enqueueJob({
      agent: { id: sel.id, name: sel.name, role: sel.role, goal: sel.goal, task: sel.task },
      kind: "research", capabilities: sel.capabilities,
    });
    if (!("error" in res)) {
      try { await fetch("/api/jobs/run", { method: "POST" }); } catch { /* best-effort; leads refetched below */ }
    }
    setRunningResearch(false);
    listLeads({ agentId: sel.id }).then(setAgentLeads);
  }, [sel]);
```

- [ ] **Step 3: Add copy/open handlers for the send path.** Near `sendDraft` (~line 139), add:

```ts
  const copyMessage = useCallback((d: DraftDTO) => {
    navigator.clipboard?.writeText(d.body).then(() => showToast("Message copied"), () => showToast("Copy failed"));
  }, [showToast]);
  const openProfile = useCallback((url: string) => { window.open(url, "_blank"); }, []);
```

(`showToast` comes from `useApp()` — add it to the destructure on line 44 if not already present: `const { s, agents, byId, togglePause, deleteAgent, saveConfig, showToast } = useApp();`.)

- [ ] **Step 4: Render the Research section.** Immediately AFTER the Leads section's closing `</div>` and BEFORE the `{isVisible("emails") && …}` Emails block, insert:

```tsx
      {/* Research */}
      {isVisible("research") && (<>
        <SectionTitle id="sec-research">Research</SectionTitle>
        <div style={css("display:flex;flex-direction:column;gap:12px;animation:fadeUp .25s ease")}>
          <div style={css("display:flex;align-items:center;gap:10px")}>
            <div style={css("font-size:12.5px;color:#71717A")}>{agentLeads.filter((l) => l.research).length} of {agentLeads.length} researched</div>
            <Btn onClick={runResearch} style={"margin-left:auto;background:#5122C1;color:#fff;border:none;border-radius:99px;padding:8px 16px;font-size:12.5px;font-weight:600;cursor:pointer;" + (runningResearch ? "opacity:.6" : "")} styleHover="background:#42199E">{runningResearch ? "Researching…" : "Research leads"}</Btn>
          </div>
          {agentLeads.filter((l) => l.research).length === 0 ? (
            <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:22px;font-size:12.5px;color:#A1A1AA")}>No briefs yet. Hit “Research leads” to enrich this agent&rsquo;s leads.</div>
          ) : agentLeads.filter((l) => l.research).map((l) => (
            <div key={l.id} style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:16px 18px")}>
              <div style={css("font-size:13.5px;font-weight:700")}>{l.name}{l.company ? " · " + l.company : ""}</div>
              <div style={css("font-size:12.5px;color:#3F3F46;line-height:1.6;margin-top:6px")}>{l.research!.summary}</div>
              {l.research!.priorities.length > 0 && (
                <div style={css("margin-top:10px")}><div style={css("font-size:11px;font-weight:600;color:#71717A;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px")}>Priorities</div><div style={css("display:flex;gap:6px;flex-wrap:wrap")}>{l.research!.priorities.map((p, i) => <span key={i} style={css(chip("#F1EDFD", "#5122C1"))}>{p}</span>)}</div></div>
              )}
              {l.research!.hooks.length > 0 && (
                <div style={css("margin-top:10px")}><div style={css("font-size:11px;font-weight:600;color:#71717A;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px")}>Hooks</div><div style={css("display:flex;flex-direction:column;gap:4px")}>{l.research!.hooks.map((h, i) => <div key={i} style={css("font-size:12px;color:#3F3F46")}>• {h}</div>)}</div></div>
              )}
              <div style={css("margin-top:10px;font-size:12px;color:#3F3F46")}><span style={css("font-weight:600")}>Angle:</span> {l.research!.angle}</div>
            </div>
          ))}
        </div>
      </>)}
```

- [ ] **Step 5: Branch the draft send controls.** In the Emails section, replace the draft card's send-button row (the `<div style={css("display:flex;gap:8px;margin-top:12px")}>…</div>` containing "Open in mail"/"Mark sent") with a channel-aware version:

```tsx
            <div style={css("display:flex;gap:8px;margin-top:12px")}>
              {d.leadEmail ? (
                <Btn onClick={() => sendDraft(d)} style="background:#EEE9F8;color:#5122C1;border:none;border-radius:99px;padding:7px 16px;font-size:12px;font-weight:600;cursor:pointer" styleHover="background:#E3DBF9">Open in mail</Btn>
              ) : (<>
                <Btn onClick={() => copyMessage(d)} style="background:#EEE9F8;color:#5122C1;border:none;border-radius:99px;padding:7px 16px;font-size:12px;font-weight:600;cursor:pointer" styleHover="background:#E3DBF9">Copy message</Btn>
                {d.leadProfileUrl && <Btn onClick={() => openProfile(d.leadProfileUrl!)} style="background:#F4F4F5;color:#3F3F46;border:none;border-radius:99px;padding:7px 16px;font-size:12px;font-weight:600;cursor:pointer" styleHover="background:#E4E4E7">Open profile</Btn>}
              </>)}
              {d.status !== "sent" && <Btn onClick={() => confirmSent(d)} style="background:#F4F4F5;color:#3F3F46;border:none;border-radius:99px;padding:7px 16px;font-size:12px;font-weight:600;cursor:pointer" styleHover="background:#E4E4E7">Mark sent</Btn>}
            </div>
```

Also update the recipient line just above the subject (the `<div style={css("font-size:11.5px;color:#A1A1AA")}>to {d.leadName}…</div>`) so no-email drafts read sensibly:

```tsx
              <div style={css("font-size:11.5px;color:#A1A1AA")}>to {d.leadName}{d.leadCompany ? " · " + d.leadCompany : ""} · {d.leadEmail || (d.leadPlatform ? d.leadPlatform + " DM" : "no email")}</div>
```

- [ ] **Step 6: Type-check.**

Run: `cd agentic-salesforce && npx tsc --noEmit`
Expected: no errors. (`chip` and `Btn` are imported; `l.research` is `ResearchBrief | null` so the `l.research!` non-null assertions are guarded by the `.filter((l) => l.research)`.)

- [ ] **Step 7: Manual UI check.** With `pnpm dev`: a **Research Agent** (or SDR) shows a **Research** section with a "Research leads" button; running it fills briefs (real Gemini brief when configured; fallback otherwise) and the cards render summary/priorities/hooks/angle. In the Emails section, a draft for a no-email lead shows **Copy message** + **Open profile** (no "Open in mail"); an email lead still shows "Open in mail". Copy writes to the clipboard; Open profile opens the URL.

- [ ] **Step 8: Commit.**

```bash
git add "agentic-salesforce/app/agents/[id]/page.tsx"
git commit -m "Research section + trigger; no-email draft send controls (copy message / open profile)"
```

---

## Self-Review

**Spec coverage:**
- Part A: `research` capability + Research Agent type + SDR → Task 2. `leads.research` + `ResearchBrief` → Task 1. `draftResearch` engine → Task 3. Runner research branch + `pickLeadsForResearch`/`applyResearchResult` → Task 3. Research feeds outreach (`draftOutreach` gains `research`, runner passes it) → Task 4. Research section + trigger → Task 5. Browser-research seam → documented (not built), runner claims research in Node for now.
- Part B: un-gate no-email leads (`pickLeadsForRun`) → Task 4. Channel-aware drafting → Task 4. Send UI (Copy message / Open profile) → Task 5. `DraftDTO.leadProfileUrl`/`leadPlatform` plumbing → Task 1 (types + `listDraftsForAgent`).

**Placeholder scan:** every step has complete code; no TBD/vague directives.

**Type consistency:** `ResearchBrief` (Task 1) is produced by `draftResearch` (Task 3), stored via `applyResearchResult` (Task 3), consumed by `draftOutreach` (Task 4), and rendered from `agentLeads[].research` (Task 5). `pickLeadsForResearch`/`applyResearchResult` signatures match the runner's calls. `draftOutreach`'s new `{platform, research}` args match the runner's outreach-branch call (Task 4) and `LeadRow` fields (Task 1). `DraftDTO.leadProfileUrl`/`leadPlatform` (Task 1) match the send-control branch (Task 5). The runner claims `["outreach","research"]` (Task 3) and never `scrape`. `research` capability id === `jobs.kind` "research" (Task 2) === the enqueue kind (Task 5).
