# Typed Agents & Team Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn agents into functional, sales-suited **types** whose behaviour is a preset bundle of **capabilities** (each mapping to a `jobs.kind`), add a **Custom** type, and make teams **templates** that declare required capabilities with a guided, non-blocking coverage/gap-fill flow.

**Architecture:** A static catalog (`lib/agentTypes.ts`) defines capabilities, agent-type presets, and team templates. Agents gain `type` + `capabilities`; per-capability `settings` live in `agent_config`; teams gain `template`. The wizard becomes type-first; job enqueue is capability-gated and the runner switches on `job.kind`. Milestone 1's `outreach` path is preserved unchanged. This ships **before** Milestone 2 (the `scrape` engine).

**Tech Stack:** Next.js 14 App Router + TypeScript, Neon Postgres + Drizzle, custom migrate runner (`pnpm db:generate` + `pnpm db:migrate`), inline `css()` helper + `Box`/`Btn` primitives, React Context store (`lib/store.tsx`), static base data (`lib/data.ts`).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-07-typed-agents-and-team-templates-design.md`.
- **No new runtime dependencies.**
- **Per-user isolation** on every DB read/write: `const userId = await uid()` from `getSession()`, filter every query by it (matches `lib/workspace/actions.ts`).
- **`agentId`/`teamId` are plain `text`** (never FKs), matching existing tables.
- **Capabilities are exactly** `scrape` | `outreach` | `follow-up` | `book-meeting`; capability id **===** `jobs.kind`.
- **Agent types (10):** `sdr, bdr, ae, csm, recruiter, manager, scout, writer, followup, custom`. **Team templates (9):** `outbound, leadgen, enterprise, fullcycle, nurture, meetings, recruitment, success, custom`.
- **No "Email Sender" type** — email is manually sent via `mailto` (M1).
- **`role` stays** as the human display label (set to the type's `label`) so `lib/agentDetail.ts` keeps working.
- **M1 `outreach` behaviour unchanged;** `enqueueOutreachJob` remains a working wrapper so its callers need no edits.
- **Verification = `npx tsc --noEmit` + browser + DB** (no test runner). Dev server on `http://localhost:3001` (reuse it; don't spawn duplicates).
- **Commits:** user's git identity only, NO `Co-Authored-By` line. Do not push.

---

### Task 1: Schema migration + backfill

**Files:**
- Modify: `lib/db/schema.ts` (add columns to `agents`, `agentConfig`, `teams`)
- Create: `scripts/backfill-agent-types.mjs`

**Interfaces:**
- Produces: `agents.type` (text), `agents.capabilities` (jsonb string[]), `agentConfig.settings` (jsonb), `teams.template` (text) — importable via `@/lib/db`.

- [ ] **Step 1: Add columns in `lib/db/schema.ts`.** In the `agents` table object, after the `char` line add:

```typescript
    type: text("type").notNull().default("custom"),
    capabilities: jsonb("capabilities").$type<string[]>().notNull().default([]),
```

In the `agentConfig` table object, after the `permissions` line add:

```typescript
    settings: jsonb("settings").$type<Record<string, Record<string, unknown>>>(),
```

In the `teams` table object, after the `leads` line add:

```typescript
    template: text("template").notNull().default("custom"),
```

- [ ] **Step 2: Generate + apply the migration.**

Run: `pnpm db:generate && pnpm db:migrate`
Expected: a new `lib/db/migrations/00NN_*.sql` altering `agents` (+`type`,+`capabilities`), `agent_config` (+`settings`), `teams` (+`template`); `db:migrate` ends `✓ applied: 00NN_*.sql`.

- [ ] **Step 3: Create `scripts/backfill-agent-types.mjs`** (tags pre-existing created agents by their `role`, mirroring `scripts/migrate.mjs`'s neon usage):

```javascript
// One-time backfill: set type/capabilities on created agents that predate the
// typed-agent migration, inferring from the legacy `role` label. Unmatched rows
// stay type='custom' with empty capabilities (safe; editable in the UI).
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[m[1]] = v;
}
const sql = neon(env.DATABASE_URL);

const BY_ROLE = {
  "SDR": ["sdr", ["scrape", "outreach", "follow-up"]],
  "BDR": ["bdr", ["outreach", "follow-up"]],
  "Account Executive": ["ae", ["outreach", "book-meeting"]],
  "Sales Manager": ["manager", []],
  "Customer Success": ["csm", ["follow-up"]],
  "Recruiter": ["recruiter", ["scrape", "outreach"]],
};

let updated = 0;
for (const [role, [type, caps]] of Object.entries(BY_ROLE)) {
  const res = await sql`update agents set type = ${type}, capabilities = ${JSON.stringify(caps)}::jsonb
    where role = ${role} and type = 'custom' returning id`;
  updated += res.length;
}
console.log(`Backfilled ${updated} agent(s) by role.`);
```

- [ ] **Step 4: Run the backfill.**

Run: `node scripts/backfill-agent-types.mjs`
Expected: prints `Backfilled N agent(s) by role.` (N may be 0 if no created agents match — that's fine).

- [ ] **Step 5: Typecheck + commit.**

Run: `npx tsc --noEmit` → exit 0.
```bash
git add lib/db/schema.ts lib/db/migrations scripts/backfill-agent-types.mjs
git commit -m "Add agent type/capabilities, agent_config settings, team template columns + backfill"
```

---

### Task 2: Catalog + typed model wiring

**Files:**
- Create: `lib/agentTypes.ts`
- Modify: `lib/types.ts` (Agent, Team), `lib/data.ts` (tag AGENTS_BASE/TEAMS_BASE), `lib/store.tsx` (createAgent/createTeam defaults), `lib/workspace/actions.ts` (saveAgent, saveTeam, loadWorkspace mapping)

**Interfaces:**
- Consumes: schema columns from Task 1.
- Produces (`@/lib/agentTypes`): `Capability` type; `CAPABILITIES`; `AGENT_TYPES`; `typeById(id)`; `TEAM_TEMPLATES`; `templateById(id)`; `capabilitiesForType(id)`. `Agent` now has `type: string` + `capabilities: string[]`; `Team` has `template: string`.

- [ ] **Step 1: Create `lib/agentTypes.ts`:**

```typescript
// Static catalog for the typed-agent harness: capabilities (engine-backed atoms,
// one per jobs.kind), agent-type presets (bundles of capabilities), and team
// templates (required capabilities). Developer-curated, like AGENTS_BASE.

export type Capability = "scrape" | "outreach" | "follow-up" | "book-meeting";

export const CAPABILITIES: { id: Capability; label: string; desc: string; jobKind: string; engineReady: boolean }[] = [
  { id: "scrape", label: "Lead scraping", desc: "Find & import prospects matching an ICP", jobKind: "scrape", engineReady: false },
  { id: "outreach", label: "Email drafting", desc: "Qualify leads and draft personalized emails", jobKind: "outreach", engineReady: true },
  { id: "follow-up", label: "Follow-ups", desc: "Re-engage non-repliers and cold leads", jobKind: "follow-up", engineReady: false },
  { id: "book-meeting", label: "Meeting booking", desc: "Propose times and book on positive replies", jobKind: "book-meeting", engineReady: false },
];

export interface AgentType { id: string; label: string; desc: string; capabilities: Capability[]; custom?: boolean }

export const AGENT_TYPES: AgentType[] = [
  { id: "sdr", label: "SDR", desc: "Full-funnel prospector — finds, writes, and follows up.", capabilities: ["scrape", "outreach", "follow-up"] },
  { id: "bdr", label: "BDR", desc: "High-volume outbound on a given list.", capabilities: ["outreach", "follow-up"] },
  { id: "ae", label: "Account Executive", desc: "Works warm leads to booked meetings.", capabilities: ["outreach", "book-meeting"] },
  { id: "csm", label: "Customer Success", desc: "Check-ins and re-engagement for accounts.", capabilities: ["follow-up"] },
  { id: "recruiter", label: "Recruiter", desc: "Sources and contacts candidates.", capabilities: ["scrape", "outreach"] },
  { id: "manager", label: "Sales Manager", desc: "Coordinates the team and reports — no direct outreach.", capabilities: [] },
  { id: "scout", label: "Lead Scout", desc: "Pure lead-gen — finds and imports prospects.", capabilities: ["scrape"] },
  { id: "writer", label: "Outreach Writer", desc: "Pure email drafter.", capabilities: ["outreach"] },
  { id: "followup", label: "Follow-up Agent", desc: "Pure re-engagement for cold leads.", capabilities: ["follow-up"] },
  { id: "custom", label: "Custom", desc: "Build your own — pick the capabilities you want.", capabilities: [], custom: true },
];

export function typeById(id: string): AgentType | undefined {
  return AGENT_TYPES.find((t) => t.id === id);
}
export function capabilitiesForType(id: string): Capability[] {
  return typeById(id)?.capabilities ?? [];
}

export interface TeamTemplate { id: string; label: string; desc: string; requiredCapabilities: Capability[] }

export const TEAM_TEMPLATES: TeamTemplate[] = [
  { id: "outbound", label: "Outbound", desc: "Cold prospecting engine.", requiredCapabilities: ["scrape", "outreach", "follow-up"] },
  { id: "leadgen", label: "Lead-Gen / Research", desc: "Top-of-funnel list building.", requiredCapabilities: ["scrape"] },
  { id: "enterprise", label: "Enterprise / Named Accounts", desc: "Multi-thread warm accounts to meetings.", requiredCapabilities: ["outreach", "book-meeting"] },
  { id: "fullcycle", label: "Full-Cycle Pod", desc: "Self-contained squad, end to end.", requiredCapabilities: ["scrape", "outreach", "follow-up", "book-meeting"] },
  { id: "nurture", label: "Nurture / Re-engagement", desc: "Revive cold & stalled leads.", requiredCapabilities: ["follow-up", "outreach"] },
  { id: "meetings", label: "Meeting-Booking / SDR→AE", desc: "Book demos, hand off to closers.", requiredCapabilities: ["outreach", "book-meeting"] },
  { id: "recruitment", label: "Recruitment", desc: "Source & contact candidates.", requiredCapabilities: ["scrape", "outreach"] },
  { id: "success", label: "Customer Success", desc: "Retention, check-ins, renewals.", requiredCapabilities: ["follow-up"] },
  { id: "custom", label: "Custom", desc: "Freeform — pick any agents.", requiredCapabilities: [] },
];

export function templateById(id: string): TeamTemplate | undefined {
  return TEAM_TEMPLATES.find((t) => t.id === id);
}
```

- [ ] **Step 2: Add fields in `lib/types.ts`.** In `interface Agent`, after `char?: number;` add:

```typescript
  type: string;              // AGENT_TYPES id (e.g. "sdr", "scout", "custom")
  capabilities: string[];    // resolved capability ids this agent can run
```

In `interface Team`, after `activity: string[];` add:

```typescript
  template: string;          // TEAM_TEMPLATES id
```

- [ ] **Step 3: Tag the seeds in `lib/data.ts`.** Replace the `AGENTS_BASE` array entries with the same objects plus `type`/`capabilities`, and `TEAMS_BASE` entries plus `template`:

```typescript
export const AGENTS_BASE: Agent[] = [
  { id: "sk", name: "Sarah Kim", initials: "SK", role: "SDR", color: "#5122C1", status: "working", task: "Booking meetings with Fintech CTOs", score: 94, goal: "Book 30 meetings / month", type: "sdr", capabilities: ["scrape", "outreach", "follow-up"] },
  { id: "mt", name: "Michael Torres", initials: "MT", role: "BDR", color: "#0EA5E9", status: "working", task: "Sending personalized outreach — Fintech segment", score: 88, goal: "120 personalized emails / week", type: "bdr", capabilities: ["outreach", "follow-up"] },
  { id: "ew", name: "Emily Watson", initials: "EW", role: "SDR", color: "#2FA45C", status: "working", task: "Discovering Healthcare ICP leads", score: 91, goal: "200 qualified leads / month", type: "sdr", capabilities: ["scrape", "outreach", "follow-up"] },
  { id: "rp", name: "Ryan Patel", initials: "RP", role: "Account Executive", color: "#F43F7E", status: "waiting", task: "Awaiting approval on Snowflake proposal", score: 86, goal: "$500K pipeline / quarter", type: "ae", capabilities: ["outreach", "book-meeting"] },
  { id: "al", name: "Ava Lindqvist", initials: "AL", role: "SDR", color: "#F59E0B", status: "working", task: "Following up with Snowflake reply", score: 90, goal: "25% reply rate", type: "sdr", capabilities: ["scrape", "outreach", "follow-up"] },
  { id: "nc", name: "Noah Chen", initials: "NC", role: "Sales Manager", color: "#8B5CF6", status: "working", task: "Reviewing team pipeline for Q3", score: 83, goal: "Keep team above 85 score", type: "manager", capabilities: [] },
  { id: "ps", name: "Priya Sharma", initials: "PS", role: "Customer Success", color: "#14B8A6", status: "offline", task: "Idle — next shift at 6:00pm", score: 79, goal: "NPS 60+ across accounts", type: "csm", capabilities: ["follow-up"] },
  { id: "lm", name: "Leo Martins", initials: "LM", role: "Recruiter", color: "#EF4444", status: "error", task: "LinkedIn connection failed — needs reauth", score: 72, goal: "15 qualified candidates / month", type: "recruiter", capabilities: ["scrape", "outreach"] },
];
```

For `TEAMS_BASE`, add `template` to each entry: `t1` → `template: "outbound"`, `t2` → `template: "enterprise"`, `t3` → `template: "outbound"`, `t4` → `template: "recruitment"` (append `, template: "outbound"` etc. before each closing `}`).

- [ ] **Step 4: Set fields on created agents/teams in `lib/store.tsx`.** In `createAgent`, change the `agent` object's `role` line and add type/capabilities. Replace:

```typescript
    const agent: Agent = {
      id, name, initials, role: cur.wPosition, color: cur.wColor, status: "working",
      task: "Onboarding — building prospect list for " + cur.wIndustry, score: 75,
      goal: cur.wGoals.split(".")[0] || "Ramp up in week 1",
      char: cur.wCharacter, // the illustrated character chosen in the wizard
    };
```
with (uses `wType`/`wCapabilities` added in Task 3 — for now reference them with fallbacks so this compiles independently):

```typescript
    const at = typeById(cur.wType) ;
    const capabilities = at?.custom ? cur.wCapabilities : (at?.capabilities ?? []);
    const agent: Agent = {
      id, name, initials, role: at?.label ?? "Custom", color: cur.wColor, status: "working",
      task: "Onboarding — configuring capabilities", score: 75,
      goal: cur.wGoals.split(".")[0] || "Ramp up in week 1",
      char: cur.wCharacter,
      type: cur.wType, capabilities,
    };
```
Add the import at the top of `lib/store.tsx`: `import { typeById } from "./agentTypes";`

**Note:** this references `cur.wType` and `cur.wCapabilities`, added to `WizardState` in Task 3. To keep Task 2 self-contained and compiling, also add those two fields to `WizardState` and `initialWizard` now (full wiring is Task 3): in `interface WizardState` add `wType: string; wCapabilities: string[];` and in `initialWizard` add `wType: "sdr", wCapabilities: [],`.

In `createTeam`, add `template: "custom"` to the `team` object (before `activity:`):

```typescript
      goal: cur.tGoal.trim() || "Define a shared goal for this team.",
      activity: ["Team created — agents onboarding", "Shared goal set"],
      template: "custom",
```

- [ ] **Step 5: Persist the fields in `lib/workspace/actions.ts`.** In `saveAgent`, add `type`/`capabilities` to the insert `.values({...})`:

```typescript
  await getDb().insert(agents).values({
    userId, id: agent.id, name: agent.name, initials: agent.initials, role: agent.role,
    color: agent.color, status: agent.status, task: agent.task, score: agent.score,
    goal: agent.goal, char: agent.char ?? null,
    type: agent.type, capabilities: agent.capabilities,
  });
```

In `saveTeam`, add `template` to the insert `.values({...})`:

```typescript
    description: team.desc, goal: team.goal, members: team.members, activity: team.activity,
    meetings: team.meetings, pipeline: team.pipeline, leads: team.leads,
    template: team.template,
```

In `loadWorkspace`, where `extraAgents` are mapped from `agentRows`, add `type`/`capabilities`; where `extraTeams` are mapped, add `template`:

```typescript
    extraAgents: agentRows.map((r) => ({
      id: r.id, name: r.name, initials: r.initials, role: r.role, color: r.color,
      status: r.status as StatusKey, task: r.task, score: r.score, goal: r.goal,
      char: r.char ?? undefined, type: r.type, capabilities: r.capabilities,
    })),
    extraTeams: teamRows.map((r) => ({
      id: r.id, name: r.name, icon: r.icon, iconBg: r.iconBg, desc: r.description,
      goal: r.goal, members: r.members, activity: r.activity,
      meetings: r.meetings, pipeline: r.pipeline, leads: r.leads, template: r.template,
    })),
```

- [ ] **Step 6: Typecheck + commit.**

Run: `npx tsc --noEmit` → exit 0.
```bash
git add lib/agentTypes.ts lib/types.ts lib/data.ts lib/store.tsx lib/workspace/actions.ts
git commit -m "Add typed-agent catalog; wire type/capabilities/template through model + persistence"
```

---

### Task 3: Wizard store state + per-capability settings persistence

**Files:**
- Modify: `lib/store.tsx` (WizardState, initialWizard, createAgent settings persist), `lib/workspace/actions.ts` (AgentConfig.settings load/save)

**Interfaces:**
- Consumes: `agentConfig.settings` column (Task 1), catalog (Task 2).
- Produces: wizard state `wType: string`, `wCapabilities: string[]`, `wSettings: Record<string, Record<string, unknown>>`; `AgentConfig.settings?: Record<string, Record<string, unknown>>` loaded/saved; `createAgent` writes `agent_config.settings`.

- [ ] **Step 1: Add `wSettings` to wizard state in `lib/store.tsx`.** (`wType`/`wCapabilities` were added in Task 2.) In `interface WizardState` add `wSettings: Record<string, Record<string, unknown>>;`. In `initialWizard` add `wSettings: {},`.

- [ ] **Step 2: Extend `AgentConfig` + persistence in `lib/workspace/actions.ts`.** Update the `AgentConfig` interface:

```typescript
export interface AgentConfig {
  role?: string;
  goal?: string;
  permissions?: Record<string, boolean>;
  settings?: Record<string, Record<string, unknown>>;
}
```

In `loadWorkspace`, where the config map is built from `configRows`, add `settings`:

```typescript
    config[c.agentId] = {
      role: c.role ?? undefined,
      goal: c.goal ?? undefined,
      permissions: c.permissions ?? undefined,
      settings: c.settings ?? undefined,
    };
```

In `saveAgentConfig`, include `settings` in both `.values(...)` and the `onConflictDoUpdate` `set`:

```typescript
    .values({ userId, agentId, role: cfg.role ?? null, goal: cfg.goal ?? null, permissions: cfg.permissions ?? null, settings: cfg.settings ?? null })
    .onConflictDoUpdate({
      target: [agentConfig.userId, agentConfig.agentId],
      set: { role: cfg.role ?? null, goal: cfg.goal ?? null, permissions: cfg.permissions ?? null, settings: cfg.settings ?? null },
    });
```

- [ ] **Step 3: Persist settings on create in `lib/store.tsx`.** In `createAgent`, after the `saveAgent(agent)...` line, persist the wizard settings via the config layer. Add an import at top: `import { saveAgentConfig as saveAgentConfigAction } from "./workspace/actions";` (if not already imported — it is imported in this file as `saveAgentConfigAction`; reuse it). Then after `saveAgent(agent).catch(...)`:

```typescript
    if (Object.keys(cur.wSettings).length) {
      saveAgentConfigAction(id, { settings: cur.wSettings }).catch((e) => console.error("[createAgent] settings persist failed:", e));
      set((prev) => ({ agentConfig: { ...prev.agentConfig, [id]: { ...prev.agentConfig[id], settings: cur.wSettings } } }));
    }
```

- [ ] **Step 4: Typecheck + commit.**

Run: `npx tsc --noEmit` → exit 0.
```bash
git add lib/store.tsx lib/workspace/actions.ts
git commit -m "Persist per-capability agent settings via agent_config; wizard settings state"
```

---

### Task 4: Type-first wizard UI

**Files:**
- Modify: `app/create/page.tsx`

**Interfaces:**
- Consumes: `@/lib/agentTypes` (`AGENT_TYPES`, `CAPABILITIES`, `typeById`, `capabilitiesForType`, `Capability`); wizard state `wType`/`wCapabilities`/`wSettings` (Tasks 2–3).
- Produces: the new 5-step flow. `createAgent` (already updated) consumes `wType`/`wCapabilities`/`wSettings`.

- [ ] **Step 1: Update imports + step labels in `app/create/page.tsx`.** Add:

```typescript
import { AGENT_TYPES, CAPABILITIES, typeById, capabilitiesForType, type Capability } from "@/lib/agentTypes";
```
Change the `STEPS` const to:
```typescript
const STEPS = ["Identity", "Type", "Appearance", "Settings", "Goal"];
```
Delete the `POSITIONS` and `POSITION_SUGGESTIONS` consts (no longer used).

- [ ] **Step 2: Add helpers inside `CreatePage`** (after the existing `const character = s.wCharacter;` area). These resolve the agent's effective capabilities and a settings setter:

```typescript
  const at = typeById(s.wType);
  const caps: Capability[] = (at?.custom ? s.wCapabilities : (at?.capabilities ?? [])) as Capability[];
  const setCap = (id: Capability) =>
    set((p) => ({ wCapabilities: p.wCapabilities.includes(id) ? p.wCapabilities.filter((c) => c !== id) : p.wCapabilities.concat([id]) }));
  const setSetting = (cap: string, key: string, val: unknown) =>
    set((p) => ({ wSettings: { ...p.wSettings, [cap]: { ...(p.wSettings[cap] || {}), [key]: val } } }));
  const sv = (cap: string, key: string) => (s.wSettings[cap]?.[key] ?? "") as string;
```

- [ ] **Step 3: Replace the step bodies.** The wizard renders step content by `step` index. Re-map: **step 0 = Identity (name)** — keep the existing name-input block. **step 1 = Type** (new). **step 2 = Appearance** — keep the existing character-picker block. **step 3 = Settings** (new, replaces Prospect). **step 4 = Goal** — keep the existing goal textarea. Update each block's `{step === N && (...)}` guard to the new index, and insert the two new blocks. The **Type** block (`step === 1`):

```tsx
{step === 1 && (
  <>
    <div style={css("display:flex;flex-direction:column;gap:8px")}>
      <div style={css(titleStyle)}>What will this agent do?</div>
      <div style={css(subtitleStyle)}>Pick a type — its capabilities are preset. Choose Custom to hand-pick.</div>
    </div>
    <div style={css("display:grid;grid-template-columns:repeat(3,1fr);gap:12px")}>
      {AGENT_TYPES.map((t) => {
        const on = s.wType === t.id;
        const chips = t.custom ? (s.wCapabilities.length ? s.wCapabilities : ["pick capabilities"]) : t.capabilities;
        return (
          <Box key={t.id} onClick={() => set({ wType: t.id })} style={"border-radius:12px;padding:14px 16px;cursor:pointer;transition:all .12s;border:2px solid " + (on ? "#5122c1;background:#F8F5FE" : "#ECECF1;background:#fff")} styleHover="border-color:#C9B8F5">
            <div style={css("font-size:14px;font-weight:700;color:#181d27")}>{t.label}</div>
            <div style={css("font-size:12px;color:#606b79;margin-top:4px;line-height:1.4")}>{t.desc}</div>
            <div style={css("display:flex;gap:5px;flex-wrap:wrap;margin-top:8px")}>
              {chips.map((c) => <span key={c} style={css("font-size:10.5px;font-weight:600;color:#5122c1;background:#F1EDFD;border-radius:99px;padding:2px 9px")}>{c}</span>)}
            </div>
          </Box>
        );
      })}
    </div>
    {at?.custom && (
      <div style={css("border-top:1px solid #ECECF1;padding-top:16px")}>
        <div style={css("font-size:14px;font-weight:600;color:#414651;margin-bottom:10px")}>Capabilities</div>
        <div style={css("display:grid;grid-template-columns:1fr 1fr;gap:10px")}>
          {CAPABILITIES.map((c) => {
            const on = s.wCapabilities.includes(c.id);
            return (
              <Box key={c.id} onClick={() => setCap(c.id)} style={"display:flex;align-items:center;gap:10px;border-radius:12px;padding:12px 14px;cursor:pointer;border:2px solid " + (on ? "#5122c1;background:#F8F5FE" : "#ECECF1;background:#fff")} styleHover="border-color:#C9B8F5">
                <span style={css("width:20px;height:20px;border-radius:6px;flex:none;display:flex;align-items:center;justify-content:center;border:1px solid " + (on ? "#5122c1" : "#D4D4D8") + ";background:" + (on ? "#5122c1" : "#fff"))}>
                  {on && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
                </span>
                <div><div style={css("font-size:13px;font-weight:600")}>{c.label}</div><div style={css("font-size:11px;color:#606b79")}>{c.desc}</div></div>
              </Box>
            );
          })}
        </div>
      </div>
    )}
  </>
)}
```

The **Settings** block (`step === 3`) — capability-driven sub-forms:

```tsx
{step === 3 && (
  <>
    <div style={css("display:flex;flex-direction:column;gap:8px")}>
      <div style={css(titleStyle)}>Capability settings</div>
      <div style={css(subtitleStyle)}>Tune how each capability behaves. You can change these later.</div>
    </div>
    {caps.length === 0 && (
      <div style={css("font-size:13px;color:#606b79;background:#FAFAFB;border:1px solid #ECECF1;border-radius:12px;padding:16px")}>This type coordinates the team and has no capability settings.</div>
    )}
    <div style={css("display:flex;flex-direction:column;gap:20px")}>
      {caps.includes("scrape") && (
        <div>
          <div style={css("font-size:13.5px;font-weight:700;margin-bottom:10px")}>Lead scraping — target</div>
          <div style={css("display:flex;flex-direction:column;gap:12px")}>
            <input value={sv("scrape", "industry")} onChange={(e) => setSetting("scrape", "industry", e.target.value)} placeholder="Target industry (e.g. Fintech)" style={css("width:100%;border:1px solid #E4E4E7;border-radius:12px;padding:12px 15px;font-size:14px;outline:none")} />
            <input value={sv("scrape", "titles")} onChange={(e) => setSetting("scrape", "titles", e.target.value)} placeholder="Job titles (e.g. CTO, VP Eng)" style={css("width:100%;border:1px solid #E4E4E7;border-radius:12px;padding:12px 15px;font-size:14px;outline:none")} />
            <input value={sv("scrape", "geo")} onChange={(e) => setSetting("scrape", "geo", e.target.value)} placeholder="Geography (e.g. North America)" style={css("width:100%;border:1px solid #E4E4E7;border-radius:12px;padding:12px 15px;font-size:14px;outline:none")} />
          </div>
        </div>
      )}
      {caps.includes("outreach") && (
        <div>
          <div style={css("font-size:13.5px;font-weight:700;margin-bottom:10px")}>Email drafting</div>
          <div style={css("display:flex;gap:8px;flex-wrap:wrap")}>
            {["Direct", "Warm", "Formal"].map((t) => {
              const on = sv("outreach", "tone") === t || (!sv("outreach", "tone") && t === "Warm");
              return <Box key={t} onClick={() => setSetting("outreach", "tone", t)} style={"font-size:13px;font-weight:600;border-radius:99px;padding:7px 15px;cursor:pointer;border:2px solid " + (on ? "#5122c1;background:#F1EDFD;color:#5122c1" : "#ECECF1;background:#fff;color:#3F3F46")} styleHover="border-color:#C9B8F5">{t} tone</Box>;
            })}
          </div>
        </div>
      )}
      {caps.includes("follow-up") && (
        <div>
          <div style={css("font-size:13.5px;font-weight:700;margin-bottom:10px")}>Follow-ups</div>
          <input value={sv("follow-up", "touches")} onChange={(e) => setSetting("follow-up", "touches", e.target.value)} placeholder="Number of touches (e.g. 3)" style={css("width:100%;border:1px solid #E4E4E7;border-radius:12px;padding:12px 15px;font-size:14px;outline:none")} />
        </div>
      )}
      {caps.includes("book-meeting") && (
        <div>
          <div style={css("font-size:13.5px;font-weight:700;margin-bottom:10px")}>Meeting booking</div>
          <input value={sv("book-meeting", "length")} onChange={(e) => setSetting("book-meeting", "length", e.target.value)} placeholder="Meeting length (e.g. 30 min)" style={css("width:100%;border:1px solid #E4E4E7;border-radius:12px;padding:12px 15px;font-size:14px;outline:none")} />
        </div>
      )}
    </div>
  </>
)}
```

Keep the Identity (name) block as `step === 0`, the Appearance/character block as `step === 2`, and the Goal textarea as `step === 4`. The footer button already fires `createAgent` on the last step (`step === 4`) via its existing `step === 4 ? createAgent : next` logic — leave that; just confirm it still points at step 4.

- [ ] **Step 4: Reset new fields in `reset()`.** In the `reset` function, add the new wizard fields so a fresh wizard starts clean:

```typescript
  const reset = () => set({ wStep: 0, wName: "", wGoals: "", wTitles: "", wGeo: "", wPosInput: "", wType: "sdr", wCapabilities: [], wSettings: {} });
```

- [ ] **Step 5: Typecheck + commit.**

Run: `npx tsc --noEmit` → exit 0 (if `wIndustry`/`wSize` become unused and tsc flags nothing, leave them; they're harmless legacy state).
```bash
git add "app/create/page.tsx"
git commit -m "Type-first agent wizard: Type step (+Custom picker) and capability-driven Settings"
```

- [ ] **Step 6: Browser verification (controller runs this).** Create an SDR (see scrape+outreach+follow-up settings sections), a Lead Scout (only scrape settings), a Sales Manager (no settings, step auto-empty), and a Custom agent (pick outreach only → only outreach settings show). Confirm each persists (reload the agent's Config tab / DB) with correct `type` and `capabilities`.

---

### Task 5: Capability-gated `enqueueJob` + runner switch

**Files:**
- Modify: `lib/jobs/actions.ts`, `app/api/jobs/run/route.ts`

**Interfaces:**
- Consumes: `AgentSnapshot` (`@/lib/leads/types`), `Capability`/catalog.
- Produces: `enqueueJob(input: { agent: AgentSnapshot & { capabilities?: string[] }; kind: string; leadIds?: string[]; batchSize?: number }) => Promise<{ jobId: string } | { error: string }>`; `enqueueOutreachJob` kept as a wrapper. Runner handles `job.kind ∈ {outreach, scrape, follow-up, book-meeting}`.

- [ ] **Step 1: Generalize enqueue in `lib/jobs/actions.ts`.** Add `enqueueJob` and make `enqueueOutreachJob` a wrapper. The `AgentSnapshot` type is `{id,name,role,goal,task}`; extend the enqueue input to also accept `capabilities` for gating (callers pass the agent's capabilities). Replace the existing `enqueueOutreachJob` with:

```typescript
export async function enqueueJob(input: { agent: AgentSnapshot; kind: string; capabilities?: string[]; leadIds?: string[]; batchSize?: number }): Promise<{ jobId: string } | { error: string }> {
  if (!isDbConfigured()) return { error: "Server not configured." };
  const userId = await uid();
  if (!userId) return { error: "Not signed in." };
  // Capability gating: an agent can only run a kind its capabilities include.
  if (input.capabilities && !input.capabilities.includes(input.kind)) {
    return { error: "This agent can't run " + input.kind + "." };
  }
  const [row] = await getDb().insert(jobs).values({
    userId, agentId: input.agent.id, kind: input.kind, status: "queued",
    params: { agent: input.agent, leadIds: input.leadIds ?? null, batchSize: input.batchSize ?? 5 },
  }).returning({ id: jobs.id });
  return { jobId: row.id };
}

export async function enqueueOutreachJob(input: { agent: AgentSnapshot; leadIds?: string[]; batchSize?: number }): Promise<{ jobId: string } | { error: string }> {
  return enqueueJob({ agent: input.agent, kind: "outreach", leadIds: input.leadIds, batchSize: input.batchSize });
}
```

- [ ] **Step 2: Switch on `kind` in `app/api/jobs/run/route.ts`.** The per-job body currently always drafts outreach. Wrap the lead loop in a `kind` switch. Replace the block that builds `batch` and loops calling `draftOutreach`/`applyOutreachResult` with:

```typescript
    const params = candidate.params as { agent: AgentSnapshot; leadIds: string[] | null; batchSize: number };
    let created = 0;
    let failed = 0;
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
        // scrape / follow-up / book-meeting engines land in later milestones.
        await db.update(jobs).set({ status: "done", finishedAt: new Date(), result: { note: "Engine for '" + candidate.kind + "' is coming soon." } })
          .where(and(eq(jobs.id, candidate.id), eq(jobs.userId, userId)));
      }
    } catch (e) {
      await db.update(jobs).set({ status: "failed", finishedAt: new Date(), error: String(e).slice(0, 500) })
        .where(and(eq(jobs.id, candidate.id), eq(jobs.userId, userId)));
    }
```

- [ ] **Step 3: Typecheck + commit.**

Run: `npx tsc --noEmit` → exit 0.
```bash
git add lib/jobs/actions.ts app/api/jobs/run/route.ts
git commit -m "Generalize job enqueue with capability gating; runner switches on job kind"
```

- [ ] **Step 4: Verification (controller runs, HTTP like M1).** Confirm an `outreach` job for an outreach-capable agent still produces a real draft (M1 unchanged); a `follow-up` job completes `done` with the "coming soon" note; `enqueueJob` with a `kind` not in `capabilities` returns `{ error }`.

---

### Task 6: Team template picker + live coverage

**Files:**
- Modify: `components/TeamModal.tsx`, `lib/store.tsx` (createTeam uses selected template)

**Interfaces:**
- Consumes: `@/lib/agentTypes` (`TEAM_TEMPLATES`, `templateById`, `Capability`); `useApp` `agents` (each with `capabilities`).
- Produces: team-modal template state `tTemplate` on the store; `createTeam` stores the chosen `template`. Coverage helper reused by Task 7.

- [ ] **Step 1: Add `tTemplate` to store state.** In `lib/store.tsx` `interface State` add `tTemplate: string;`; in `initialState` add `tTemplate: "custom",`. In `createTeam`, replace the hardcoded `template: "custom"` with `template: cur.tTemplate || "custom"`, and reset it: in the `set(...)` that closes the modal, add `tTemplate: "custom"` to the reset fields.

- [ ] **Step 2: Add the template picker + coverage to `components/TeamModal.tsx`.** Add imports:

```typescript
import { TEAM_TEMPLATES, templateById, type Capability } from "@/lib/agentTypes";
```
Destructure `set, s, agents, createTeam` (already present). After the "Team name" field block, insert a **Template** picker and a **coverage strip**. Add this JSX right after the Icon block (before Members):

```tsx
<div>
  <div style={css("font-size:12px;font-weight:600;color:#3F3F46;margin-bottom:8px")}>Template</div>
  <div style={css("display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px")}>
    {TEAM_TEMPLATES.map((t) => {
      const on = s.tTemplate === t.id;
      return (
        <Box key={t.id} onClick={() => set({ tTemplate: t.id })} style={"border-radius:12px;padding:10px 12px;cursor:pointer;border:2px solid " + (on ? "#5122c1;background:#F8F5FE" : "#ECECF1;background:#fff")} styleHover="border-color:#C9B8F5">
          <div style={css("font-size:12.5px;font-weight:700")}>{t.label}</div>
          <div style={css("font-size:10.5px;color:#71717A;margin-top:3px")}>{t.requiredCapabilities.length ? t.requiredCapabilities.join(" · ") : "freeform"}</div>
        </Box>
      );
    })}
  </div>
</div>
```

Below the Members list (which sets `s.tSel`), add a **coverage strip** computed from selected members' capabilities:

```tsx
{(() => {
  const req = (templateById(s.tTemplate)?.requiredCapabilities ?? []) as Capability[];
  if (!req.length) return null;
  const selectedIds = Object.keys(s.tSel).filter((k) => s.tSel[k]);
  const covered = new Set<string>();
  for (const a of agents) if (selectedIds.includes(a.id)) for (const c of a.capabilities) covered.add(c);
  return (
    <div>
      <div style={css("font-size:12px;font-weight:600;color:#3F3F46;margin-bottom:8px")}>Coverage</div>
      <div style={css("display:flex;gap:8px;flex-wrap:wrap")}>
        {req.map((c) => {
          const ok = covered.has(c);
          return <span key={c} style={css("font-size:11px;font-weight:600;border-radius:99px;padding:4px 11px;" + (ok ? "color:#1B7A3D;background:#E7F7EC" : "color:#B45309;background:#FDEBCB"))}>{ok ? "✓ " : "○ "}{c}</span>;
        })}
      </div>
    </div>
  );
})()}
```

- [ ] **Step 3: Typecheck + commit.**

Run: `npx tsc --noEmit` → exit 0.
```bash
git add components/TeamModal.tsx lib/store.tsx
git commit -m "Team creation: template picker + live capability coverage strip"
```

- [ ] **Step 4: Browser verification (controller).** Open "+ New team", pick "Outbound" → coverage shows `scrape/outreach/follow-up` as ○; selecting Sarah Kim (SDR) flips all three to ✓; "Custom" shows no coverage strip. Create a team and confirm its `template` persists.

---

### Task 7: Guided inline gap-create + team-detail coverage row

**Files:**
- Modify: `components/TeamModal.tsx` (inline gap-create), `app/teams/[id]/page.tsx` (coverage row)

**Interfaces:**
- Consumes: coverage logic (Task 6), `createAgent`/agents from the store, `templateById`.
- Produces: per-gap "Create a [type]" inline creation that adds a fitting agent to the selection; team-detail coverage row.

- [ ] **Step 1: Add a store helper to create a minimal typed agent.** In `lib/store.tsx`, add a `Ctx` method `quickCreateAgent(typeId: string, name: string): string` that builds+persists a typed agent (reusing the same id/persist pattern as `createAgent`) and returns its id:

```typescript
  const quickCreateAgent = useCallback((typeId: string, name: string): string => {
    const at = typeById(typeId);
    const id = "x" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const nm = name.trim() || (at?.label ?? "Agent");
    const initials = nm.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
    const agent: Agent = {
      id, name: nm, initials, role: at?.label ?? "Custom", color: "#5122C1", status: "working",
      task: "Onboarding", score: 75, goal: "Ramp up in week 1",
      type: typeId, capabilities: at?.capabilities ?? [],
    };
    set((prev) => ({ extraAgents: prev.extraAgents.concat([agent]) }));
    saveAgent(agent).catch((e) => console.error("[quickCreateAgent] persist failed:", e));
    return id;
  }, [set]);
```
Add `quickCreateAgent: (typeId: string, name: string) => string;` to the `Ctx` interface and include `quickCreateAgent` in the `value` object.

- [ ] **Step 2: Add inline gap-create to `components/TeamModal.tsx`.** Import `AGENT_TYPES` alongside the existing agentTypes import, and destructure `quickCreateAgent` from `useApp()`. Under the coverage strip, for each **uncovered** required capability, render a compact create row: a name input + a "Create [type]" button that calls `quickCreateAgent`, auto-selects the new agent, and (coverage recomputes from `s.tSel`). Add after the coverage strip block:

```tsx
{(() => {
  const req = (templateById(s.tTemplate)?.requiredCapabilities ?? []) as Capability[];
  const selectedIds = Object.keys(s.tSel).filter((k) => s.tSel[k]);
  const covered = new Set<string>();
  for (const a of agents) if (selectedIds.includes(a.id)) for (const c of a.capabilities) covered.add(c);
  const gaps = req.filter((c) => !covered.has(c));
  if (!gaps.length) return null;
  // Prefer a single-capability type for each gap (scout/writer/followup), else first type that has it.
  const typeForCap = (c: string) => (AGENT_TYPES.find((t) => !t.custom && t.capabilities.length === 1 && t.capabilities[0] === c) || AGENT_TYPES.find((t) => t.capabilities.includes(c as Capability)));
  return (
    <div style={css("display:flex;flex-direction:column;gap:8px")}>
      <div style={css("font-size:11.5px;color:#71717A")}>Missing capabilities — create a fitting agent:</div>
      {gaps.map((c) => {
        const t = typeForCap(c);
        if (!t) return null;
        return (
          <div key={c} style={css("display:flex;gap:8px;align-items:center;background:#FAFAFB;border:1px solid #ECECF1;border-radius:12px;padding:8px 10px")}>
            <div style={css("font-size:12px;font-weight:600;color:#3F3F46;flex:1")}>{t.label} <span style={css("color:#A1A1AA;font-weight:400")}>· {c}</span></div>
            <input value={s.tGapName[c] || ""} onChange={(e) => set((p) => ({ tGapName: { ...p.tGapName, [c]: e.target.value } }))} placeholder="Name" style={css("border:1px solid #E4E4E7;border-radius:8px;padding:6px 10px;font-size:12px;width:120px;outline:none")} />
            <Btn onClick={() => { const id = quickCreateAgent(t.id, s.tGapName[c] || t.label); set((p) => ({ tSel: { ...p.tSel, [id]: true } })); }} style="background:#5122C1;color:#fff;border:none;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer" styleHover="background:#42199E">Create</Btn>
          </div>
        );
      })}
    </div>
  );
})()}
```
Add `tGapName: Record<string, string>` to the store `State` (init `tGapName: {}`) and reset it when the modal closes (alongside `tSel`).

- [ ] **Step 3: Add a coverage row to `app/teams/[id]/page.tsx`.** Import `templateById, type Capability` from `@/lib/agentTypes`. In the team-detail render, compute coverage from the team's members and show a chip row near the KPIs:

```tsx
{(() => {
  const req = (templateById(team.template)?.requiredCapabilities ?? []) as Capability[];
  if (!req.length) return null;
  const covered = new Set<string>();
  for (const a of members) if (a) for (const c of a.capabilities) covered.add(c);
  return (
    <div style={css("display:flex;align-items:center;gap:8px;flex-wrap:wrap")}>
      <div style={css("font-size:12px;font-weight:600;color:#71717A")}>Coverage:</div>
      {req.map((c) => {
        const ok = covered.has(c);
        return <span key={c} style={css("font-size:11px;font-weight:600;border-radius:99px;padding:4px 11px;" + (ok ? "color:#1B7A3D;background:#E7F7EC" : "color:#B45309;background:#FDEBCB"))}>{ok ? "✓ " : "missing "}{c}</span>;
      })}
    </div>
  );
})()}
```
Place it directly below the KPI row `<div>` in the team-detail layout. (`members` is the existing `team.members.map((id) => byId(id)).filter(Boolean)` array; each has `.capabilities`.)

- [ ] **Step 4: Typecheck + commit.**

Run: `npx tsc --noEmit` → exit 0.
```bash
git add components/TeamModal.tsx "app/teams/[id]/page.tsx" lib/store.tsx
git commit -m "Guided inline gap-create in team modal + coverage row on team detail"
```

- [ ] **Step 5: Browser verification (controller).** New team → "Enterprise" template with no matching agents → gaps `outreach`, `book-meeting` show "Create Outreach Writer / [AE-ish]" rows; naming one + Create adds it, auto-selects it, and coverage flips ✓. Team detail page shows the coverage row (✓/missing). Create with a gap remaining → team still creates (non-blocking).

---

## Self-Review

**1. Spec coverage:**
- Two-layer catalog (capabilities + types + templates) → Task 2 (`lib/agentTypes.ts`). ✓
- Schema (`agents.type/capabilities`, `agent_config.settings`, `teams.template`) + seed tagging + backfill → Tasks 1–2. ✓
- Custom type (hand-picked capabilities) → Task 2 (catalog `custom:true`) + Task 4 (Custom picker). ✓
- Wizard Name→Type→Appearance→Settings→Goal + capability-driven settings + persistence → Tasks 3–4. ✓
- `enqueueJob` capability gating + runner switch + `enqueueOutreachJob` wrapper + M1 unchanged → Task 5. ✓
- Team templates + live coverage + guided inline gap-create + team-detail coverage row → Tasks 6–7. ✓
- `role` = type label preserved → Task 2 (createAgent/quickCreateAgent set `role: at.label`) + seeds keep `role`. ✓
- Deferred engines (follow-up/book-meeting/scrape) as no-op with note → Task 5. ✓

**2. Placeholder scan:** No TBD/TODO; every code step is complete. The engine-less runner branch is intentional (spec-defined no-op), not a placeholder.

**3. Type consistency:** `Capability` union is identical across `lib/agentTypes.ts` and all consumers. `type`/`capabilities` added to `Agent` in Task 2 are set by `createAgent` (Task 2/4) and `quickCreateAgent` (Task 7), mapped in `loadWorkspace` (Task 2), persisted by `saveAgent` (Task 2). `template` on `Team` set by `createTeam` (Task 6), persisted by `saveTeam` (Task 2), mapped in `loadWorkspace` (Task 2). Wizard state `wType`/`wCapabilities` added in Task 2, `wSettings` in Task 3, all consumed in Task 4. `enqueueJob` signature in Task 5 matches its `enqueueOutreachJob` wrapper and existing callers (which call the wrapper, unchanged). `tTemplate`/`tGapName` store fields added in Tasks 6–7 and reset with the modal.

**Note on task ordering:** Task 2 adds `wType`/`wCapabilities` to `WizardState` (needed so `createAgent` compiles) while Task 3 adds `wSettings`; both precede the wizard UI (Task 4). Tasks 6→7 both touch `TeamModal.tsx`/`lib/store.tsx` and must run in order.
