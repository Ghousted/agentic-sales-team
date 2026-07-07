# Team-Shared Leads · Slice 1 — Shared Book + Scrape Approval Gate

The first slice of the "leads are worked, not owned" model: a lead belongs to no single agent — a **team works a shared book of leads together**, and scraped leads pass through a **human approval gate** before they enter that book.

> This is **Slice 1** of a larger lifecycle. **Slice 2** (later) adds automatic stage-to-stage hand-off (the assigned agent *changing* as a lead moves researcher→writer→follow-up), the per-capability approval modes (auto / ask-permission), and the live "who's on it right now" view.

---

## Part A — Shared team book

A lead's `agentId` stops meaning "owner" and becomes the **assigned agent** (who scraped/added it). The team's shared book is **derived from membership** — no "team owns this lead" column.

### Team resolution (`lib/teams/membership.ts`, new, server-only)

`teammatesOf(userId, agentId) → Promise<string[]>` resolves every agent that shares a team with the given agent:

1. Load the user's teams: `TEAMS_BASE` (static, from `lib/data`) + the user's `teams` rows.
2. Effective members of each team = `team_members[teamId]` override (if present) else the team's base `members`.
3. The agent's teams = those whose effective members include `agentId`.
4. Return the **union** of effective members across those teams (always including `agentId` itself). An agent on no team → `[agentId]`.

### Pool + view expansion (`lib/leads/store.ts`)

- **Capability pools** — `pickLeadsForResearch` / `pickLeadsForRun` change their agent filter from `agentId = A` to `agentId ∈ teammatesOf(userId, A)` (plus `review='accepted'`, Part B). So a pod works one shared book.
- **Lead-level dedup** — dedup moves from per-drafting-agent to per-lead across the book: a lead already researched (`leads.research` set) or drafted (a row in `outreach_drafts` for that `leadId` by **any** team member) is not re-worked. This prevents double-drafting the shared book.
- **The agent's Leads view** (`listWorkbook(agentId)`) shows the agent's working book — its team's shared book (accepted) — with **each lead tagged by its assigned agent** (so you see who's on it individually).
- **The team page** shows the team's book: leads whose assigned agent is a current member (accepted). This replaces today's cosmetic `team.leads` count with the real book.

### What "who's working it" means in Slice 1

- **Individually:** each lead row shows its **assigned agent** (avatar/name).
- **As a team:** the team page shows the whole shared book.

The assigned agent does **not** yet change as the lead moves through the pod (that reassignment/hand-off is Slice 2) — Slice 1 delivers the shared pool + team book so a researcher's brief reaches a teammate writer.

---

## Part B — Scrape approval gate

Scraped leads arrive as **candidates for review** instead of landing in the working pool.

### Schema — one column (`lib/db/schema.ts`)

`leads.review` — `text NOT NULL DEFAULT 'accepted'`, values `'pending' | 'accepted' | 'dismissed'`. Additive migration. (Existing rows + manually-added leads default `'accepted'`; only new scrapes go to `'pending'`.) `LeadDTO` gains `review: string` (mapped in `toLeadDTO`).

### Worker (`worker/db.py`)

`insert_lead` writes scraped leads with `review='pending'`. The existing dedup (`lead_exists` by `profileUrl`) already ignores `review`, so it also skips previously-**dismissed** profiles — a re-scrape won't resurface junk the human already threw out.

### Accepted-only working pool (`lib/leads/store.ts`)

Every active-pool read filters `review='accepted'`:
- `listLeads` gains a `review` filter defaulting to `'accepted'`; `listWorkbook` / the team book / `pickLeadsForRun` / `pickLeadsForResearch` all require `'accepted'`.
- Drafts are only ever created for accepted leads (the pool is accepted-only), so `listDraftsForAgent` needs no change.

So pending candidates are never researched, drafted, or counted until a human accepts them.

### Review actions + surface

- **Store/actions:** `listCandidates(filter?)` (review `'pending'`), `acceptLead(id)` (→ `'accepted'` + activity), `dismissLead(id)` (→ soft `'dismissed'`), and a bulk `acceptLeads(ids)` / `dismissLeads(ids)`. All `userId`-scoped.
- **UI (`app/leads/page.tsx`):** an **Active / Pending** toggle. The Pending view lists candidates (name · title · company · platform · source agent · profile link) with **Accept** / **Dismiss** per row and **Accept all** / **Dismiss all**. A **badge shows the pending count** so waiting candidates are visible. Accept moves a lead into the pool (and the team book); Dismiss soft-hides it.
- **The "Find leads" trigger** (`app/agents/[id]/page.tsx`): its success message becomes *"Found N leads to review"* and points to the Pending view (scraped results now wait there, not in the agent's leads).

### End-to-end flow

**scrape → Pending candidates → human filters (Accept / Dismiss) → accepted leads enter the shared team book → the pod (research → outreach) works them.**

---

## File map

| File | Change |
|---|---|
| `lib/db/schema.ts` | `leads.review` column |
| `lib/db/migrations/NNNN_*.sql` | generated additive migration |
| `lib/teams/membership.ts` | **new** — `teammatesOf(userId, agentId)` (server-only) |
| `lib/leads/types.ts` | `LeadDTO.review` |
| `lib/leads/store.ts` | `review` filter + `listWorkbook` + team-book query; team-expanded + accepted-only + lead-level-dedup pools; `listCandidates` / `acceptLead` / `dismissLead` / bulk; `toLeadDTO` maps review |
| `lib/leads/actions.ts` | expose the new client actions + `review`/workbook/team-book reads |
| `worker/db.py` | `insert_lead` writes `review='pending'` |
| `app/leads/page.tsx` | Active/Pending toggle + review actions + pending badge |
| `app/agents/[id]/page.tsx` | Leads section shows the workbook (assigned-agent per row); "Find leads" → review message |
| `app/teams/[id]/page.tsx` | show the real team book |

---

## Verification

No unit-test framework — verification is `npx tsc --noEmit` clean, the migration, plus manual/HTTP checks:

- Migration applies (`leads.review`); existing leads read as `'accepted'`.
- Two agents on the same team: a lead assigned to agent A is visible in agent B's workbook and the team page; running research on A briefs it; running outreach on B drafts it **using A's brief** (the pod works across agents). A solo agent's workbook is unchanged (its own leads only).
- Lead-level dedup: a lead drafted by one team member isn't re-drafted by another.
- Scrape (worker running): new scraped leads appear in **Pending**, not the active pool, and are **not** researched/drafted until accepted. Accept moves one into the pool + team book; Dismiss soft-hides it and a re-scrape doesn't resurface it. The pending badge reflects the count.
- `tsc` clean.

## Deferred (Slice 2 / later)

- Automatic stage-to-stage hand-off — the assigned agent changing as a lead moves researcher → writer → follow-up.
- Per-capability approval modes (auto / ask-permission) + the ask-permission request/approve flow.
- Live "who's on it right now" (active-job) indicators.
- Multi-select filtering in the Pending view (Slice 1 ships per-row + accept-all/dismiss-all).
