# Research Agent + No-Email Send Path — Design

Two related features that make scraped leads actionable (the deferred Spec-2 items from the lead-scraping milestone):

- **Part A — Research Agent:** a new `research` capability + Research Agent type + a Gemini research-brief engine that enriches each lead with a structured brief; the brief then **feeds the outreach engine** for sharper drafts.
- **Part B — No-email send path:** scraped leads with no email get **channel-aware** outreach (a short direct message instead of a formal email) and an actionable send path — **Copy message** + **Open profile** — instead of the `mailto:` path that only works for email leads.

> Both build directly on the existing harness: capabilities = `jobs.kind`, engines are one structured `geminiJSON` call per lead (like `lib/ai/outreach.ts`), the Node runner claims jobs and switches on kind, and leads already carry `profileUrl`/`platform` from the scrape milestone.

---

## Part A — Research Agent

### Capability & catalog (`lib/agentTypes.ts`)

- `Capability` union gains `"research"`.
- `CAPABILITIES` gains `{ id: "research", label: "Lead research", desc: "Enrich prospects with a research brief", jobKind: "research", engineReady: true }`.
- `AGENT_TYPES` gains a **Research Agent**: `{ id: "researcher", label: "Research Agent", desc: "Enriches prospects with research briefs.", capabilities: ["research"] }`.
- **SDR** gains `research` (full-funnel: research → scrape → outreach → follow-up). Other types unchanged.

### The brief & storage

A structured brief, one current version per lead:

```ts
interface ResearchBrief {
  summary: string;      // 2-3 sentences on the prospect + company
  priorities: string[]; // their likely goals / pain points
  hooks: string[];      // specific personalization angles to reference
  angle: string;        // recommended outreach approach
}
```

- Stored in a new **`research` JSONB column** on `leads` (nullable) — additive migration. `LeadDTO` gains `research: ResearchBrief | null` (mapped in `toLeadDTO`).

### Engine (`lib/ai/research.ts`)

`draftResearch(agent, lead) → ResearchBrief`, modeled on `draftOutreach`: one `geminiJSON` call against a `ResearchBrief` schema, a system prompt that casts the agent as a researcher enriching a prospect from its name/title/company/platform, and a graceful fallback when Gemini isn't configured. Pure (no DB).

### Trigger, runner & display

- **Trigger:** a capability-gated **"Research leads"** button on the agent detail (in the new Research section) → `enqueueJob({ agent, kind: "research", capabilities })`.
- **Runner:** `app/api/jobs/run/route.ts` broadens its claim from `kind='outreach'` to `kind IN ('outreach','research')` and switches on kind. A new `research` branch calls `pickLeadsForResearch` (leads without a brief yet, batched) → `draftResearch` → `applyResearchResult` (sets `leads.research`, logs an `activity` row). `scrape` still belongs to the Python worker — not claimed here.
- **Store (`lib/leads/store.ts`):** `pickLeadsForResearch(userId, agentId, leadIds, batchSize)` and `applyResearchResult(userId, agentId, lead, brief)` — every read/write scoped by `userId`.
- **Display:** a new **Research** section on the agent detail (gated to `research`), placed between Leads and Emails, showing each lead's brief (summary · priorities · hooks · angle) and the "Research leads" button; leads without a brief show an empty state.

### Research feeds outreach

`draftOutreach` gains an optional `research?: ResearchBrief` on its lead argument; when present, the system prompt/turn includes the brief so the email is grounded in the prospect's priorities and hooks. The runner's outreach branch passes `lead.research` through (it's now on the `LeadRow`).

**Scope of the flow:** the brief lives on the *lead* (`leads.research`), and every lead is owned by a single `agentId`; outreach only ever consumes the brief of a lead it also owns. So research→outreach works **within one agent that has both capabilities** — e.g. an **SDR** (research + scrape + outreach): it researches its own leads, then drafts from those briefs. It does **not** span two separate agents: a standalone Research Agent and a separate Outreach Writer hold disjoint lead sets, so the Writer never sees the Research Agent's briefs. Making a genuine researcher→writer *pod* cooperate would require **team-shared leads** (a brief visible to any agent working the same lead) — a deliberate future item, not part of this spec.

### Later: browser-based deep research (seam, not built now)

The `research` capability is mode-agnostic: a `research` job produces a `ResearchBrief` regardless of *how*. Today the Node runner fills it with a Gemini-only brief. Later, the Python/browser-use worker can claim `research` jobs (as it does `scrape`) to visit the prospect's profile/company and produce the **same** `ResearchBrief` shape — a drop-in upgrade. The switch is: narrow the Node runner back to `outreach`-only and let the worker own `research`. Nothing downstream (schema, DTO, UI, outreach integration) changes. This spec builds the Gemini-only path.

---

## Part B — No-email send path

### Un-gate no-email leads

The scrape milestone added a `ne(leads.email, "")` filter to `pickLeadsForRun` so no-email leads wouldn't produce dead `mailto:` drafts. That filter is **removed** (both branches) now that there's a real send path — no-email leads get drafts again.

### Channel-aware drafting (`lib/ai/outreach.ts`)

`draftOutreach` receives the lead's `platform` alongside `email` and branches the prompt:

- **Has email** → a formal cold email (`{subject, body}`), exactly as today.
- **No email + a profile/platform** → a **short direct message** (2–4 sentences, casual, no formal signature) appropriate to the platform; `body` carries the DM text, `subject` becomes a one-line context label.

The result schema is unchanged (`{score, stage, subject, body, rationale}`) — only the prompt adapts, so drafts, storage, and "Mark sent" all keep working.

### Send UI (agent-detail Emails section)

Each draft card picks its send controls from the lead:

- **Has email** → **Open in mail** (`mailto:`) + Mark sent — unchanged.
- **No email, has `profileUrl`** → **Copy message** (writes `body` to the clipboard via `navigator.clipboard`) + **Open profile** (`window.open(profileUrl)`) + Mark sent. The human opens the profile, pastes into the platform's DM, sends, marks sent.
- **Neither** → Copy message + Mark sent (fallback).

A small platform hint (e.g. "Reddit") shows on DM cards. The section keeps its "Emails" name.

### Plumbing

`DraftDTO` gains `leadProfileUrl: string | null` and `leadPlatform: string | null`; `listDraftsForAgent`'s join selects `leads.profileUrl` / `leads.platform` so each card can branch. (Both columns already exist on `leads` from the scrape milestone.)

---

## File map

| File | Change |
|---|---|
| `lib/agentTypes.ts` | `research` capability + Research Agent type + `research` on SDR |
| `lib/db/schema.ts` | `leads.research` JSONB column |
| `lib/db/migrations/NNNN_*.sql` | generated additive migration |
| `lib/leads/types.ts` | `ResearchBrief`; `LeadDTO.research`; `DraftDTO.leadProfileUrl`/`leadPlatform` |
| `lib/leads/store.ts` | `toLeadDTO` maps `research`; `pickLeadsForResearch` + `applyResearchResult`; `listDraftsForAgent` selects profileUrl/platform; **remove** the `ne(email,"")` filter in `pickLeadsForRun`; `draftOutreach` call passes `lead.research` |
| `lib/ai/research.ts` | **new** — `draftResearch` engine |
| `lib/ai/outreach.ts` | optional `research` + `platform` on the lead arg; channel-aware prompt |
| `app/api/jobs/run/route.ts` | claim `outreach`+`research`; `research` branch |
| `app/agents/[id]/page.tsx` | Research section (gated) + "Research leads" trigger; no-email send controls on draft cards |

---

## Verification

No unit-test framework — verification is `npx tsc --noEmit` clean, applying the migration, plus manual/HTTP checks:

- Migration applies (`leads.research`).
- A **Research Agent** shows a Research section + "Research leads"; running it fills briefs (real Gemini brief when configured; fallback otherwise), `leads.research` populated, an `activity` row logged.
- Outreach on a lead **with** a brief includes it in the prompt (sharper draft); outreach still works for leads without a brief.
- A no-email scraped lead now gets a **DM-style** draft; its card shows **Copy message** + **Open profile** (no `mailto`), and copy/open work; an email lead still shows **Open in mail**.
- Capability gating: a research-less agent can't be asked to research (enqueue rejected); the Research section only appears for `research`-capable agents.
- `tsc` clean.

## Deferred / out of scope

- **Browser-based deep research** (the worker filling `research` jobs) — seam left, built later.
- The live "watch it navigate" scrape UI (the other Spec-2 deferral) — not part of this work.
- Re-research / brief history (only the latest brief is kept).
