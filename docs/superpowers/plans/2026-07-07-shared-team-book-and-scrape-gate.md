# Shared Team Book + Scrape Approval Gate (Slice 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make leads a **shared team book** (worked, not owned — a capability's pool + the leads views expand to an agent's teammates) and put scraped leads behind a **human approval gate** (scrape → Pending candidates → accept/dismiss → active pool).

**Architecture:** No "team owns this lead" column — the team book is *derived* from membership via a new `teammatesOf(userId, agentId)` helper. One new `leads.review` column gates the working pool to `accepted` leads; the worker inserts scraped leads as `pending`. Everything else is store-query + UI changes.

**Tech Stack:** Next.js 14 App Router / TypeScript / Drizzle / Neon / Python worker (psycopg).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-07-shared-team-book-and-scrape-gate-design.md`.
- **Git identity:** commit as the user only — `Ghousted <clydepadua091@gmail.com>`. **Never** add a `Co-Authored-By: Claude` line / AI attribution.
- **No push.** `.env.local` stays gitignored, never committed.
- **No unit-test framework.** Verification is `npx tsc --noEmit` (from `agentic-salesforce/`) clean, applying the migration, a worker import check, and code review. No test framework.
- **User-scoping:** every `leads`/`activity` read+write filters by the session `userId`. `teammatesOf` resolves membership only within the user's own teams.
- **Follow patterns:** store functions mirror the existing ones; UI uses `css()`/`av()`/`chip()`/`Btn`/`Box`; the worker's SQL uses the exact snake_case column names.
- **The working pool is accepted-only:** `listWorkbook` / team-book / `pickLeadsForRun` / `pickLeadsForResearch` all require `review='accepted'`. Only new scrapes are `pending`; existing rows + manual leads default `accepted`.
- **Deferred to Slice 2 (do NOT build):** auto stage-to-stage hand-off (reassigning `agentId`), per-capability approval modes (auto/ask), live "who's on it now", multi-select in Pending.

---

## File Structure

- `lib/db/schema.ts` — MODIFY: `leads.review` column.
- `lib/db/migrations/NNNN_*.sql` — CREATE (generated).
- `lib/leads/types.ts` — MODIFY: `LeadDTO.review`.
- `lib/teams/membership.ts` — CREATE: `teammatesOf`.
- `lib/leads/store.ts` — MODIFY: review filter + `listWorkbook`/`listLeadsForAgents`/`listCandidates`/`setLeadReview`; team-expanded + accepted-only + lead-level-dedup pools; `toLeadDTO` maps review.
- `lib/leads/actions.ts` — MODIFY: expose the new actions.
- `worker/db.py` — MODIFY: `insert_lead` writes `review='pending'`.
- `app/leads/page.tsx` — MODIFY: Active/Pending toggle + review actions + badge.
- `app/agents/[id]/page.tsx` — MODIFY: workbook + assigned-agent per row + "Find leads" review message.
- `app/teams/[id]/page.tsx` — MODIFY: real team book + count.

---

## Task 1: Schema — `leads.review` + DTO

**Files:** Modify `lib/db/schema.ts`, `lib/leads/types.ts`, `lib/leads/store.ts:17-23` (`toLeadDTO`); Create migration.

**Interfaces:** Produces `leads.review` (`text NOT NULL DEFAULT 'accepted'`); `LeadDTO.review: string`.

- [ ] **Step 1: Add the column.** In `lib/db/schema.ts`, inside the `leads` table, after `source: text("source").notNull().default("manual"),`, add:

```ts
    review: text("review").notNull().default("accepted"),
```

- [ ] **Step 2: DTO.** In `lib/leads/types.ts`, add to `LeadDTO` (after `source: string;`):

```ts
  review: string;
```

- [ ] **Step 3: Map it.** In `lib/leads/store.ts` `toLeadDTO`, add `review: r.review,` (alongside `source: r.source,`):

```ts
    email: r.email, status: r.status, score: r.score, source: r.source, review: r.review, profileUrl: r.profileUrl, platform: r.platform, research: r.research ?? null,
```

- [ ] **Step 4: Generate + apply migration.**

Run: `cd agentic-salesforce && pnpm db:generate` → confirm the new SQL has `ALTER TABLE "leads" ADD COLUMN "review" text DEFAULT 'accepted' NOT NULL;`. Then `pnpm db:migrate` → `✓ applied`.

- [ ] **Step 5: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors.

- [ ] **Step 6: Commit.**

```bash
git add agentic-salesforce/lib/db/schema.ts agentic-salesforce/lib/leads/types.ts agentic-salesforce/lib/leads/store.ts agentic-salesforce/lib/db/migrations
git commit -m "Add leads.review column (approval-gate state)"
```

---

## Task 2: Team resolution — `teammatesOf`

**Files:** Create `lib/teams/membership.ts`.

**Interfaces:** Produces `teammatesOf(userId: string, agentId: string) → Promise<string[]>` — agent ids sharing a team with `agentId` (incl. itself); `[agentId]` if on no team.

- [ ] **Step 1: Write the helper.** Create `lib/teams/membership.ts`:

```ts
import "server-only";
// Team membership resolution: which agents share a team with a given agent, for
// this user. Teams = static TEAMS_BASE seeds + the user's created `teams` rows;
// effective membership = the `team_members` override if present, else the team's
// base members. Used to expand a capability's lead pool to the shared team book.
import { eq } from "drizzle-orm";
import { getDb, isDbConfigured, teams as teamsTable, teamMembers } from "@/lib/db";
import { TEAMS_BASE } from "@/lib/data";

export async function teammatesOf(userId: string, agentId: string): Promise<string[]> {
  if (!isDbConfigured()) return [agentId];
  const db = getDb();
  const [userTeams, overrides] = await Promise.all([
    db.select().from(teamsTable).where(eq(teamsTable.userId, userId)),
    db.select().from(teamMembers).where(eq(teamMembers.userId, userId)),
  ]);
  const overrideMap = new Map(overrides.map((o) => [o.teamId, o.members]));
  const allTeams: { id: string; members: string[] }[] = [
    ...TEAMS_BASE.map((t) => ({ id: t.id, members: t.members })),
    ...userTeams.map((t) => ({ id: t.id, members: t.members })),
  ];
  const mates = new Set<string>([agentId]);
  for (const t of allTeams) {
    const members = overrideMap.get(t.id) ?? t.members;
    if (members.includes(agentId)) for (const m of members) mates.add(m);
  }
  return Array.from(mates);
}
```

- [ ] **Step 2: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors. (`teams`/`teamMembers` are exported from `@/lib/db`; `TEAMS_BASE` from `@/lib/data`.)

- [ ] **Step 3: Commit.**

```bash
git add agentic-salesforce/lib/teams/membership.ts
git commit -m "Add teammatesOf: resolve an agent's shared-team members"
```

---

## Task 3: Store — shared-book pools, review filtering, review actions

**Files:** Modify `lib/leads/store.ts`, `lib/leads/actions.ts`.

**Interfaces:** Produces `listLeads({…, review?})` (defaults `'accepted'`); `listWorkbook(agentId)`; `listLeadsForAgents(agentIds)`; `listCandidates({agentId?})`; `setLeadReview(ids, review)`; team-expanded + accepted-only + lead-level-dedup `pickLeadsForRun`/`pickLeadsForResearch`. Actions expose these.

- [ ] **Step 1: Import the resolver.** In `lib/leads/store.ts`, after the existing imports (line ~8), add:

```ts
import { teammatesOf } from "@/lib/teams/membership";
```

- [ ] **Step 2: Review filter on `listLeads`.** Replace `listLeads` (lines 42-52) with:

```ts
export async function listLeads(filter?: { agentId?: string; status?: string; source?: string; review?: string }): Promise<LeadDTO[]> {
  if (!isDbConfigured()) return [];
  const userId = await uid();
  if (!userId) return [];
  const conds = [eq(leads.userId, userId), eq(leads.review, filter?.review ?? "accepted")];
  if (filter?.agentId) conds.push(eq(leads.agentId, filter.agentId));
  if (filter?.status) conds.push(eq(leads.status, filter.status));
  if (filter?.source) conds.push(eq(leads.source, filter.source));
  const rows = await getDb().select().from(leads).where(and(...conds)).orderBy(desc(leads.createdAt));
  return rows.map(toLeadDTO);
}
```

- [ ] **Step 3: Add the shared-book + candidate reads.** After `listLeads`, add:

```ts
/** The agent's working book: leads assigned to any teammate (its shared team
 *  book), accepted-only, newest first. */
export async function listWorkbook(agentId: string): Promise<LeadDTO[]> {
  if (!isDbConfigured()) return [];
  const userId = await uid();
  if (!userId) return [];
  const mates = await teammatesOf(userId, agentId);
  const rows = await getDb().select().from(leads)
    .where(and(eq(leads.userId, userId), inArray(leads.agentId, mates), eq(leads.review, "accepted")))
    .orderBy(desc(leads.createdAt));
  return rows.map(toLeadDTO);
}

/** Accepted leads assigned to any of the given agents (a team's book). */
export async function listLeadsForAgents(agentIds: string[]): Promise<LeadDTO[]> {
  if (!isDbConfigured() || agentIds.length === 0) return [];
  const userId = await uid();
  if (!userId) return [];
  const rows = await getDb().select().from(leads)
    .where(and(eq(leads.userId, userId), inArray(leads.agentId, agentIds), eq(leads.review, "accepted")))
    .orderBy(desc(leads.createdAt));
  return rows.map(toLeadDTO);
}

/** Scraped candidates awaiting human review (review='pending'). */
export async function listCandidates(filter?: { agentId?: string }): Promise<LeadDTO[]> {
  if (!isDbConfigured()) return [];
  const userId = await uid();
  if (!userId) return [];
  const conds = [eq(leads.userId, userId), eq(leads.review, "pending")];
  if (filter?.agentId) conds.push(eq(leads.agentId, filter.agentId));
  const rows = await getDb().select().from(leads).where(and(...conds)).orderBy(desc(leads.createdAt));
  return rows.map(toLeadDTO);
}

/** Accept or dismiss candidate leads (bulk). Dismiss is a soft 'dismissed'. */
export async function setLeadReview(ids: string[], review: "accepted" | "dismissed"): Promise<void> {
  if (!isDbConfigured() || ids.length === 0) return;
  const userId = await uid();
  if (!userId) return;
  await getDb().update(leads).set({ review, updatedAt: new Date() })
    .where(and(eq(leads.userId, userId), inArray(leads.id, ids)));
}
```

- [ ] **Step 4: Team-expand + accepted + lead-dedup the pools.** Replace `pickLeadsForRun` (lines 108-121) with:

```ts
export async function pickLeadsForRun(userId: string, agentId: string, leadIds: string[] | undefined, batchSize: number): Promise<LeadRow[]> {
  const db = getDb();
  const mates = await teammatesOf(userId, agentId);
  if (leadIds && leadIds.length) {
    return db.select().from(leads)
      .where(and(eq(leads.userId, userId), inArray(leads.agentId, mates), inArray(leads.id, leadIds), eq(leads.review, "accepted")))
      .limit(batchSize);
  }
  const pool = await db.select().from(leads)
    .where(and(eq(leads.userId, userId), inArray(leads.agentId, mates), eq(leads.review, "accepted"))).orderBy(asc(leads.createdAt));
  if (!pool.length) return [];
  const poolIds = pool.map((l) => l.id);
  const drafted = await db.select({ leadId: outreachDrafts.leadId }).from(outreachDrafts)
    .where(and(eq(outreachDrafts.userId, userId), inArray(outreachDrafts.leadId, poolIds)));
  const draftedIds = new Set(drafted.map((r) => r.leadId));
  return pool.filter((l) => !draftedIds.has(l.id)).slice(0, batchSize);
}
```

And replace `pickLeadsForResearch` (lines 138-148) with:

```ts
export async function pickLeadsForResearch(userId: string, agentId: string, leadIds: string[] | undefined, batchSize: number): Promise<LeadRow[]> {
  const db = getDb();
  const mates = await teammatesOf(userId, agentId);
  if (leadIds && leadIds.length) {
    return db.select().from(leads)
      .where(and(eq(leads.userId, userId), inArray(leads.agentId, mates), inArray(leads.id, leadIds), eq(leads.review, "accepted")))
      .limit(batchSize);
  }
  const pool = await db.select().from(leads)
    .where(and(eq(leads.userId, userId), inArray(leads.agentId, mates), eq(leads.review, "accepted"))).orderBy(asc(leads.createdAt));
  return pool.filter((l) => !l.research).slice(0, batchSize);
}
```

- [ ] **Step 5: Expose the actions.** In `lib/leads/actions.ts`, update the `listLeads` wrapper's filter type and add the new wrappers:

```ts
export async function listLeads(filter?: { agentId?: string; status?: string; source?: string; review?: string }): Promise<LeadDTO[]> {
  return store.listLeads(filter);
}
export async function listWorkbook(agentId: string): Promise<LeadDTO[]> {
  return store.listWorkbook(agentId);
}
export async function listLeadsForAgents(agentIds: string[]): Promise<LeadDTO[]> {
  return store.listLeadsForAgents(agentIds);
}
export async function listCandidates(filter?: { agentId?: string }): Promise<LeadDTO[]> {
  return store.listCandidates(filter);
}
export async function acceptLeads(ids: string[]): Promise<void> {
  return store.setLeadReview(ids, "accepted");
}
export async function dismissLeads(ids: string[]): Promise<void> {
  return store.setLeadReview(ids, "dismissed");
}
```

- [ ] **Step 6: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors.

- [ ] **Step 7: Commit.**

```bash
git add agentic-salesforce/lib/leads/store.ts agentic-salesforce/lib/leads/actions.ts
git commit -m "Shared-book lead pools (team-expanded, accepted-only, lead-level dedup) + review reads/actions"
```

---

## Task 4: Worker — scraped leads land as `pending`

**Files:** Modify `worker/db.py`.

**Interfaces:** Produces scraped leads inserted with `review='pending'`.

- [ ] **Step 1: Set review on insert.** In `worker/db.py` `insert_lead`, change the INSERT to include the `review` column with `'pending'`:

```python
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO leads (user_id, agent_id, name, title, company, email,
                               source, profile_url, platform, review)
            VALUES (%s, %s, %s, %s, %s, %s, 'scrape', %s, %s, 'pending')
            """,
            (
                user_id, agent_id,
                prospect.get("name", "").strip() or "Unknown",
                prospect.get("title", "") or "",
                prospect.get("company", "") or "",
                prospect.get("email", "") or "",
                prospect.get("profileUrl", "") or "",
                prospect.get("platform", "") or "",
            ),
        )
```

(Only the SQL's column list + `VALUES` gain `review`/`'pending'`; the parameter tuple is unchanged.)

- [ ] **Step 2: Import check.**

Run: `cd agentic-salesforce/worker && source .venv/bin/activate && python -c "import db; print('db OK')"`
Expected: `db OK` (no syntax error). If the venv is missing, note it — the change is a literal SQL edit reviewable without running.

- [ ] **Step 3: Commit.**

```bash
git add agentic-salesforce/worker/db.py
git commit -m "Worker: scraped leads land as review='pending' (approval gate)"
```

---

## Task 5: Leads page — Active/Pending review UI

**Files:** Modify `app/leads/page.tsx`.

**Interfaces:** Consumes `listLeads` (accepted), `listCandidates`, `acceptLeads`, `dismissLeads`.

- [ ] **Step 1: Imports + state.** In `app/leads/page.tsx`, extend the actions import (line 4):

```ts
import { addLead as addLeadAction, listLeads as listLeadsAction, setStage as setStageAction, listCandidates, acceptLeads, dismissLeads } from "@/lib/leads/actions";
```

Add state near the other `useState`s (after `const [leads, setLeads] = useState<LeadDTO[]>([]);`):

```ts
  const [candidates, setCandidates] = useState<LeadDTO[]>([]);
  const [view, setView] = useState<"active" | "pending">("active");
```

- [ ] **Step 2: Load candidates alongside leads.** Replace the `refetch` callback with one that loads both:

```ts
  const refetch = useCallback(async () => {
    setLoading(true);
    const [rows, cands] = await Promise.all([listLeadsAction(), listCandidates()]);
    setLeads(rows);
    setCandidates(cands);
    setLoading(false);
  }, []);
```

- [ ] **Step 3: Review handlers.** Add near `submitAdd`:

```ts
  const review = async (ids: string[], accept: boolean) => {
    if (!ids.length) return;
    if (accept) await acceptLeads(ids); else await dismissLeads(ids);
    showToast(accept ? ids.length + " accepted" : ids.length + " dismissed");
    refetch();
  };
```

- [ ] **Step 4: Add the Active/Pending toggle + pending badge.** In the header row (the `<div>` with the count + filters, ~lines 82-95), add a view toggle at the front. Replace the count line with:

```tsx
        <div style={css("display:flex;background:#F4F4F5;border-radius:99px;padding:3px")}>
          <Box onClick={() => setView("active")} style={"padding:6px 14px;font-size:12.5px;font-weight:600;border-radius:99px;cursor:pointer;" + (view === "active" ? "background:#fff;color:#18181B;box-shadow:0 1px 2px rgba(0,0,0,.08)" : "color:#71717A")}>Active</Box>
          <Box onClick={() => setView("pending")} style={"padding:6px 14px;font-size:12.5px;font-weight:600;border-radius:99px;cursor:pointer;display:flex;align-items:center;gap:6px;" + (view === "pending" ? "background:#fff;color:#18181B;box-shadow:0 1px 2px rgba(0,0,0,.08)" : "color:#71717A")}>Pending{candidates.length > 0 && <span style={css("background:#5122C1;color:#fff;border-radius:99px;font-size:10px;font-weight:700;padding:1px 6px")}>{candidates.length}</span>}</Box>
        </div>
        <div style={css("font-size:13px;color:#71717A")}>{view === "active" ? leads.length + " lead" + (leads.length === 1 ? "" : "s") : candidates.length + " to review"}</div>
```

(Import `Box` from `@/components/primitives` — change the import on line 8 to `import { css, Box, Btn } from "@/components/primitives";`.)

- [ ] **Step 5: Render the Pending list when the view is pending.** Wrap the existing leads table so it shows only in `active` view, and add a pending table. Replace the table container (`<div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;overflow:hidden")}>…</div>`) with a conditional:

```tsx
      {view === "active" ? (
        <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;overflow:hidden")}>
          {/* …the existing header row + filtered leads rows, unchanged… */}
        </div>
      ) : (
        <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;overflow:hidden")}>
          <div style={css("display:flex;align-items:center;padding:11px 18px;border-bottom:1px solid #ECECF1;background:#FAFAFB;gap:10px")}>
            <div style={css("font-size:11px;font-weight:600;color:#71717A;text-transform:uppercase;letter-spacing:.05em")}>Scraped candidates — accept the good ones</div>
            {candidates.length > 0 && (<>
              <Btn onClick={() => review(candidates.map((c) => c.id), true)} style="margin-left:auto;background:#5122C1;color:#fff;border:none;border-radius:99px;padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer" styleHover="background:#42199E">Accept all</Btn>
              <Btn onClick={() => review(candidates.map((c) => c.id), false)} style="background:#F4F4F5;color:#3F3F46;border:none;border-radius:99px;padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer" styleHover="background:#E4E4E7">Dismiss all</Btn>
            </>)}
          </div>
          {loading ? (
            <div style={css("padding:20px;font-size:12.5px;color:#A1A1AA")}>Loading…</div>
          ) : candidates.length === 0 ? (
            <div style={css("padding:20px;font-size:12.5px;color:#A1A1AA")}>No candidates awaiting review. Run “Find leads” on a scraping agent.</div>
          ) : candidates.map((c) => {
            const a = byId(c.agentId);
            return (
              <div key={c.id} style={css("display:grid;grid-template-columns:1.4fr 1.2fr 1fr 1.2fr;padding:12px 18px;font-size:12.5px;border-bottom:1px solid #F4F4F6;align-items:center;gap:10px")}>
                <div style={css("font-weight:600")}>{c.name}<div style={css("font-size:11px;color:#A1A1AA;font-weight:400")}>{c.title || (c.platform ? c.platform : "—")}</div></div>
                <div style={css("color:#3F3F46")}>{c.company || "—"}</div>
                <div style={css("display:flex;align-items:center;gap:7px;min-width:0")}>{a && <div style={css(av(a, 20))}>{a.initials}</div>}<span style={css("white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{a ? a.name : c.agentId}</span></div>
                <div style={css("display:flex;gap:6px;align-items:center")}>
                  {c.profileUrl && <Box onClick={() => window.open(c.profileUrl!, "_blank")} style="font-size:11.5px;font-weight:600;color:#5122C1;cursor:pointer" styleHover="text-decoration:underline">Profile ↗</Box>}
                  <Btn onClick={() => review([c.id], true)} style="margin-left:auto;border:none;border-radius:8px;padding:5px 10px;font-size:11.5px;font-weight:600;cursor:pointer;background:#E7F7EC;color:#1B7A3D" styleHover="background:#D6EFDD">Accept</Btn>
                  <Btn onClick={() => review([c.id], false)} style="border:none;border-radius:8px;padding:5px 10px;font-size:11.5px;font-weight:600;cursor:pointer;background:#F4F4F5;color:#71717A" styleHover="background:#E4E4E7">Dismiss</Btn>
                </div>
              </div>
            );
          })}
        </div>
      )}
```

- [ ] **Step 6: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors. (`av` is already imported; `Box` now imported; `window.open(c.profileUrl!, …)` is guarded by `c.profileUrl &&`.)

- [ ] **Step 7: Manual check.** With `pnpm dev`: the Leads page shows an Active/Pending toggle; Active is the existing table; Pending lists candidates with Accept/Dismiss + Accept all/Dismiss all, and the badge shows the count. (Real candidates appear after a worker scrape — Task 4.)

- [ ] **Step 8: Commit.**

```bash
git add "agentic-salesforce/app/leads/page.tsx"
git commit -m "Leads page: Active/Pending review with accept/dismiss + pending badge"
```

---

## Task 6: Agent detail — workbook + assigned agent + review message

**Files:** Modify `app/agents/[id]/page.tsx`.

**Interfaces:** Consumes `listWorkbook` (replaces the `listLeads({agentId})` load); shows the assigned agent per lead.

- [ ] **Step 1: Import workbook.** In `app/agents/[id]/page.tsx` line 9, change to:

```ts
import { listWorkbook, listDraftsForAgent, markDraftSent } from "@/lib/leads/actions";
```

(Remove `listLeads` from that import — it's replaced by `listWorkbook` below. If any other use of `listLeads` remains, keep it; there should be none after this task.)

- [ ] **Step 2: Load the workbook.** Change the `agentLeads` loader (line 85) from `listLeads({ agentId: selId }).then(setAgentLeads)` to:

```ts
    if (selId) listWorkbook(selId).then(setAgentLeads);
```

And the two refetches — the scrape-done refetch (line 131) and the `runResearch` refetch (line 161) — from `listLeads({ agentId: sel.id }).then(setAgentLeads)` to:

```ts
        listWorkbook(sel.id).then(setAgentLeads);
```

- [ ] **Step 3: Review-aware scrape message.** In `runScrape`, change the done-state message (line 129) to point at review:

```ts
        setScrapeNote(`Found ${r.leadsFound ?? 0} lead${r.leadsFound === 1 ? "" : "s"} to review — open the Leads module’s Pending tab.`);
```

- [ ] **Step 4: Show the assigned agent per lead row.** In the Leads section's row (the `agentLeads.map((l) => …)` grid, ~lines 292-308), add the assigned agent. Change the row's grid to include an agent cell — replace the row's column template and add an agent cell as the first inner element. Concretely, in the header row (line ~289 with `Name/Company/Status/Score/Added`) and each data row, prepend an "Agent" column. In the data row, add before the Name cell:

```tsx
                  <div style={css("display:flex;align-items:center;gap:6px;min-width:0")}>{(() => { const a = byId(l.agentId); return a ? <><div style={css(av(a, 18))}>{a.initials}</div><span style={css("white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{a.name.split(" ")[0]}</span></> : <span>{l.agentId}</span>; })()}</div>
```

Update BOTH the header grid template and the row grid template to prepend a column, e.g. change `grid-template-columns:1.4fr 1.2fr .9fr .6fr .9fr` → `grid-template-columns:.9fr 1.4fr 1.2fr .9fr .6fr .9fr`, and add `<div>Agent</div>` as the first header cell. (`byId` is already destructured from `useApp()`; `av` is imported.)

- [ ] **Step 5: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors.

- [ ] **Step 6: Manual check.** With `pnpm dev`: an agent on a team shows its **team's** leads (each row tagged with the assigned agent); a solo agent shows its own. "Find leads" reports "…to review".

- [ ] **Step 7: Commit.**

```bash
git add "agentic-salesforce/app/agents/[id]/page.tsx"
git commit -m "Agent detail: show the team workbook (assigned agent per row) + review message"
```

---

## Task 7: Team page — the real team book

**Files:** Modify `app/teams/[id]/page.tsx`.

**Interfaces:** Consumes `listLeadsForAgents(team.members)`.

- [ ] **Step 1: Imports + state.** In `app/teams/[id]/page.tsx`, add imports:

```ts
import { useState, useEffect } from "react";
import { listLeadsForAgents } from "@/lib/leads/actions";
import type { LeadDTO } from "@/lib/leads/types";
```

(Merge `useEffect` into the existing `import { useState } from "react";`.)

- [ ] **Step 2: Load the team book.** After the `team` is resolved (after line 35 `if (!team) return null;` — but hooks can't be after an early return, so place the state+effect BEFORE the early return, guarded on `team`). Add near the top of the component (after the `pick` state, before `const team = …`), then load in an effect:

```ts
  const [teamLeads, setTeamLeads] = useState<LeadDTO[]>([]);
```

And after `const team = teams.find(...)` (before the `if (!team) return null;`), add:

```ts
  const memberIds = team ? team.members : [];
  useEffect(() => {
    if (memberIds.length) listLeadsForAgents(memberIds).then(setTeamLeads);
    else setTeamLeads([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberIds.join(",")]);
```

- [ ] **Step 3: Real leads count.** Change the KPI (line 54) from `team.leads.toLocaleString()` to `String(teamLeads.length)`:

```ts
    ["Meetings", String(team.meetings)], ["Pipeline", team.pipeline], ["Leads", String(teamLeads.length)], ["Avg score", avgScore ? String(avgScore) : "—"],
```

- [ ] **Step 4: Render the team book.** Add a "Team leads" card in the left column, after the Members card (after its closing `</div>` around line 116, before the Team-performance card):

```tsx
          <div style={css("background:#fff;border:1px solid #ECECF1;border-radius:16px;padding:16px 18px")}>
            <div style={css("font-size:13.5px;font-weight:700;margin-bottom:12px")}>Team leads <span style={css("font-size:12px;font-weight:400;color:#A1A1AA")}>· {teamLeads.length}</span></div>
            {teamLeads.length === 0 ? (
              <div style={css("font-size:12.5px;color:#A1A1AA;padding:6px 2px")}>No leads in this team’s book yet.</div>
            ) : (
              <div style={css("display:flex;flex-direction:column")}>
                {teamLeads.slice(0, 12).map((l) => {
                  const a = byId(l.agentId);
                  return (
                    <div key={l.id} style={css("display:flex;align-items:center;gap:10px;padding:8px 2px;border-bottom:1px solid #F4F4F6")}>
                      <div style={css("font-size:12.5px;font-weight:600;min-width:0;flex:1")}>{l.name}<span style={css("font-size:11px;color:#A1A1AA;font-weight:400")}>{l.company ? " · " + l.company : ""}</span></div>
                      {a && <div style={css("display:flex;align-items:center;gap:5px;flex:none")}><div style={css(av(a, 18))}>{a.initials}</div><span style={css("font-size:11px;color:#71717A")}>{a.name.split(" ")[0]}</span></div>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
```

- [ ] **Step 5: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors. (`av`/`byId` already in scope; `LeadDTO` imported.)

- [ ] **Step 6: Manual check.** With `pnpm dev`: the team page shows a "Team leads" card = the union of members' accepted leads (each tagged by its assigned agent), and the Leads KPI is the real count.

- [ ] **Step 7: Commit.**

```bash
git add "agentic-salesforce/app/teams/[id]/page.tsx"
git commit -m "Team page: show the real team book (shared leads) + live count"
```

---

## Self-Review

**Spec coverage:**
- Part A: `teammatesOf` → Task 2. Pool expansion + lead-level dedup → Task 3 (`pickLeadsForRun`/`pickLeadsForResearch`). Workbook + team book reads → Task 3; displayed in Task 6 (agent) + Task 7 (team). Assigned-agent per row → Task 6/7.
- Part B: `leads.review` → Task 1. Worker inserts `pending` → Task 4. Accepted-only pool → Task 3 (all reads/pools filter `review='accepted'`). `listCandidates`/`setLeadReview` → Task 3; Pending review UI + badge → Task 5. "Find leads" review message → Task 6.

**Placeholder scan:** every step shows complete code. The two "…unchanged…" notes (Task 5 Step 5 active table, Task 6 Step 4 existing cells) reference existing code left in place, not omitted new code.

**Type consistency:** `LeadDTO.review` (Task 1) is read by Task 5's UI. `teammatesOf(userId, agentId): Promise<string[]>` (Task 2) is called by Task 3's `listWorkbook`/`pickLeadsForRun`/`pickLeadsForResearch`. `listWorkbook`/`listLeadsForAgents`/`listCandidates`/`acceptLeads`/`dismissLeads` (Task 3 store + actions) match their consumers in Tasks 5–7. The worker's `review` column (Task 4) matches the schema column name from Task 1. `pickLeadsForRun`/`pickLeadsForResearch` keep their existing `(userId, agentId, leadIds, batchSize)` signature — the runner (`/api/jobs/run`) calls them unchanged.
