# Interpret Ask-Who Answer + Chat Continuity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After Outreach asks "who?", interpret the user's plain-text reply against their real leads (name/description/"all") and draft accordingly, with the conversation staying with the right agent.

**Architecture:** `teamChat` derives two things from the persisted thread: the last agent speaker (continuity) and whether the last agent message is Outreach's still-open ask-who prompt (pending). In pending mode an unmentioned, non-command reply is resolved to lead ids via a new Gemini helper, then drafted via a shared `startOutreach`. Otherwise normal routing runs, now with a last-speaker fallback.

**Tech Stack:** Next.js 14 App Router, TypeScript, Drizzle/neon-http, Gemini REST (`geminiJSON`). Server actions in `"use server"` modules; server-only libs.

## Global Constraints

- **No test runner** (no jest/vitest, zero `*.test.ts`). Verification = `npx tsc --noEmit` from `agentic-salesforce/`, plus scratchpad `.mjs` for pure/AI logic. Do NOT add a test framework. There is **no** working `pnpm lint` (no ESLint config; it drops into an interactive wizard) — do not run it.
- **Agent must not write to the DB.** Runtime DB writes and migrations are the user's. Live Gemini calls from a scratchpad `.mjs` (read-only, using the key in `.env.local`) are allowed and are how AI logic is checked here.
- **Commits:** author is the repo default (Ghousted). **No** `Co-Authored-By` / "Generated with Claude" trailer. Do **not** push. Branch: `feat/sales-capabilities`; do not merge.
- Do **not** print or commit `.env.local`.
- Match surrounding style: `geminiJSON` usage mirrors `lib/ai/intent.ts`; server-only libs start with `import "server-only";`.

---

## File Structure

- `lib/chat/outreachTarget.ts` — **modify**: add `askWhoAgainText`, `isAskWhoPrompt` (pure).
- `lib/ai/resolveLeads.ts` — **create**: `resolveTargetLeads(reply, leads)` (one Gemini call).
- `lib/chat/orchestrate.ts` — **modify**: `resolve` gains `opts.lastSpeakerId`; status + chat fallbacks use it.
- `lib/chat/actions.ts` — **modify**: `teamChat` pending-answer path + `startOutreach` helper; refactor the outreach gate to reuse it.

Order = dependency order: 1 (helpers) → 2 (AI resolver) → 3 (resolve opts) → 4 (teamChat).

---

## Task 1: Ask-who prompt helpers

**Files:**
- Modify: `lib/chat/outreachTarget.ts`
- Test (scratchpad, not committed): `<scratchpad>/isaskwho-check.mjs`

**Interfaces:**
- Consumes: existing `askWhoText(agentName)` in the same file.
- Produces: `askWhoAgainText(agentName: string): string`; `isAskWhoPrompt(text: string, agentName: string): boolean`.

- [ ] **Step 1: Add the helpers**

Append to `lib/chat/outreachTarget.ts` (after `askWhoText`):

```ts
/** The re-ask used when a reply to "who?" can't be resolved to any lead. Kept as
 *  a distinct, exact string so isAskWhoPrompt still detects the pending state. */
export function askWhoAgainText(agentName: string): string {
  const first = (agentName || "").split(" ")[0] || "I";
  return `${first} — I couldn't tell which lead you meant. Type /lead to pick, name them (e.g. "Maria"), or say "outreach all".`;
}

/** True if `text` is one of the agent's ask-who prompts (initial or re-ask) —
 *  i.e. Outreach is still waiting for the user to say who to write to. */
export function isAskWhoPrompt(text: string, agentName: string): boolean {
  return text === askWhoText(agentName) || text === askWhoAgainText(agentName);
}
```

- [ ] **Step 2: Headless check (inlines the same logic)**

Create `<scratchpad>/isaskwho-check.mjs` (replace `<scratchpad>` with the session scratchpad dir):

```js
const askWhoText = (n) => { const f = (n||"").split(" ")[0] || "I"; return `${f} here — who should I write to? Type /lead to pick some leads, or say "outreach all" to write to everyone in your book.`; };
const askWhoAgainText = (n) => { const f = (n||"").split(" ")[0] || "I"; return `${f} — I couldn't tell which lead you meant. Type /lead to pick, name them (e.g. "Maria"), or say "outreach all".`; };
const isAskWhoPrompt = (t, n) => t === askWhoText(n) || t === askWhoAgainText(n);
let ok = true;
const cases = [
  [askWhoText("Outreach"), "Outreach", true],
  [askWhoAgainText("Outreach"), "Outreach", true],
  [askWhoText("Emily Ward"), "Emily Ward", true],           // multi-word name → first name
  ["Outreach here — just finished drafting.", "Outreach", false],
  ["random message", "Outreach", false],
  [askWhoText("Outreach"), "Scraper", false],               // wrong agent name
];
for (const [t, n, want] of cases) { const got = isAskWhoPrompt(t, n); if (got !== want) { ok = false; console.log(`FAIL: ${JSON.stringify(t).slice(0,40)} / ${n} → ${got}, want ${want}`); } }
console.log(ok ? "ALL PASS" : "FAILURES ABOVE");
```

- [ ] **Step 3: Run it**

Run: `node <scratchpad>/isaskwho-check.mjs`
Expected: `ALL PASS`. If any FAIL, the helper strings and the inlined strings have drifted — make them identical.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add lib/chat/outreachTarget.ts
git commit -m "Chat: ask-who prompt helpers (askWhoAgainText, isAskWhoPrompt) for pending-answer detection"
```

---

## Task 2: Reply → lead ids (Gemini)

**Files:**
- Create: `lib/ai/resolveLeads.ts`
- Test (scratchpad, not committed): `<scratchpad>/resolveleads-check.mjs` (live Gemini)

**Interfaces:**
- Consumes: `geminiJSON`, `isGeminiConfigured`, `type Turn` from `@/lib/ai/gemini`; `TeamLeadPick` from `@/lib/leads/types`.
- Produces: `resolveTargetLeads(reply: string, leads: TeamLeadPick[]): Promise<{ mode: "all" | "some" | "none"; leadIds: string[] }>`.

- [ ] **Step 1: Create the resolver**

Create `lib/ai/resolveLeads.ts`:

```ts
import "server-only";
// Interpret a free-text reply to Outreach's "who should I write to?" against the
// user's actual leads → which lead ids they mean (or all / none). One Gemini call.
import { geminiJSON, isGeminiConfigured, type Turn } from "./gemini";
import type { TeamLeadPick } from "@/lib/leads/types";

export interface TargetResolution { mode: "all" | "some" | "none"; leadIds: string[] }

const SCHEMA = {
  type: "object",
  properties: {
    mode: { type: "string", enum: ["all", "some", "none"] },
    leadIds: { type: "array", items: { type: "string" } },
  },
  required: ["mode", "leadIds"],
} as const;

/** Map a reply like "Maria", "the Makati buyer", "all", or "this" to lead ids.
 *  Returns mode='none' (safe re-ask) on empty catalog, no Gemini, or error. */
export async function resolveTargetLeads(reply: string, leads: TeamLeadPick[]): Promise<TargetResolution> {
  if (!isGeminiConfigured() || leads.length === 0) return { mode: "none", leadIds: [] };
  const list = leads
    .map((l) => `id=${l.id} | ${l.name}${l.title ? " — " + l.title : ""}${l.company ? " @ " + l.company : ""}${l.platform ? " (" + l.platform + ")" : ""}`)
    .join("\n");
  const system = [
    "A salesperson was asked which of their leads to write outreach to. Read their reply and map it to the lead list.",
    "Return JSON { mode, leadIds }:",
    "- mode='all' if they mean everyone / the whole list / 'all' / 'everyone'. leadIds: [].",
    "- mode='some' if they name or describe specific lead(s); set leadIds to the matching id(s) from the list ONLY.",
    "- mode='none' if you cannot tell which (a vague pointer like 'this'/'that one' with no detail, or unrelated). leadIds: [].",
    "Match on name, title, company, or platform. NEVER invent ids — use only ids from the list.",
    "LEADS:",
    list,
  ].join("\n");
  try {
    const r = await geminiJSON<TargetResolution>(system, [{ role: "user", text: reply }] as Turn[], SCHEMA as unknown as Record<string, unknown>, { maxTokens: 300, temperature: 0.15 });
    const mode = r.mode === "all" || r.mode === "some" || r.mode === "none" ? r.mode : "none";
    const ids = Array.isArray(r.leadIds) ? r.leadIds.filter((id) => leads.some((l) => l.id === id)) : [];
    return { mode, leadIds: mode === "some" ? ids : [] };
  } catch {
    return { mode: "none", leadIds: [] };
  }
}
```

- [ ] **Step 2: Live check against real Gemini**

Create `<scratchpad>/resolveleads-check.mjs` (reads the key from `.env.local`, calls Gemini directly with the SAME prompt shape; read-only, no DB):

```js
import { readFileSync } from "node:fs";
const env = {}; for (const l of readFileSync("/Users/ed3n/Desktop/ApexHuman/AgenticSalesforce/agentic-salesforce/.env.local","utf8").split("\n")) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
const GEM = env.GEMINI_API_KEY;
const leads = [
  { id: "L1", name: "Maria Santos", title: "looking to buy a 2BR condo", company: "", platform: "Facebook" },
  { id: "L2", name: "First-time buyer", title: "Makati, 7M cash", company: "", platform: "Facebook" },
  { id: "L3", name: "Juan Dela Cruz", title: "LF condo BGC", company: "", platform: "Reddit" },
];
const list = leads.map((l) => `id=${l.id} | ${l.name}${l.title ? " — " + l.title : ""}${l.platform ? " (" + l.platform + ")" : ""}`).join("\n");
const system = [
  "A salesperson was asked which of their leads to write outreach to. Read their reply and map it to the lead list.",
  "Return JSON { mode, leadIds }:",
  "- mode='all' if they mean everyone / the whole list / 'all' / 'everyone'. leadIds: [].",
  "- mode='some' if they name or describe specific lead(s); set leadIds to the matching id(s) from the list ONLY.",
  "- mode='none' if you cannot tell which (a vague pointer like 'this'/'that one' with no detail, or unrelated). leadIds: [].",
  "Match on name, title, company, or platform. NEVER invent ids — use only ids from the list.",
  "LEADS:", list,
].join("\n");
const SCHEMA = { type:"object", properties:{ mode:{type:"string",enum:["all","some","none"]}, leadIds:{type:"array",items:{type:"string"}} }, required:["mode","leadIds"] };
async function call(reply) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEM}`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ system_instruction:{parts:[{text:system}]}, contents:[{role:"user",parts:[{text:reply}]}], generationConfig:{ temperature:0.15, maxOutputTokens:300, thinkingConfig:{thinkingBudget:0}, responseMimeType:"application/json", responseSchema:SCHEMA } }) });
  return JSON.parse((await res.json()).candidates[0].content.parts.map((p)=>p.text||"").join(""));
}
for (const [reply, want] of [["everyone","all"],["Maria","some→L1"],["the BGC one","some→L3"],["this","none"]]) {
  const r = await call(reply); console.log(`"${reply}" → ${r.mode} ${JSON.stringify(r.leadIds)}  (want ${want})`);
}
```

- [ ] **Step 3: Run it**

Run: `node <scratchpad>/resolveleads-check.mjs`
Expected (approximate — it's a live model): `everyone`→`all`; `Maria`→`some ["L1"]`; `the BGC one`→`some ["L3"]`; `this`→`none`. Minor variation is OK; the shape and the clear cases (all / a named lead / unresolvable) must be right. If a clear case is wrong, tighten the prompt wording in BOTH the resolver and this script.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/resolveLeads.ts
git commit -m "AI: resolveTargetLeads — map a free-text ask-who reply to lead ids (all/some/none)"
```

---

## Task 3: Continuity fallback in `resolve`

**Files:**
- Modify: `lib/chat/orchestrate.ts`

**Interfaces:**
- Produces: `resolve(userId, teamId, message, intent, opts?: { lastSpeakerId?: string })` — same return type; new optional `opts`.

- [ ] **Step 1: Add the `opts` parameter**

In `lib/chat/orchestrate.ts`, the signature is:

```ts
export async function resolve(userId: string, teamId: string, message: string, intent: Intent): Promise<Resolution> {
```

Change to:

```ts
export async function resolve(userId: string, teamId: string, message: string, intent: Intent, opts?: { lastSpeakerId?: string }): Promise<Resolution> {
```

- [ ] **Step 2: Use last-speaker in the status branch**

Still in `resolve`, the status branch currently reads:

```ts
    const target = mentioned ?? members[0];
```

Change to:

```ts
    const target = mentioned ?? members.find((m) => m.id === opts?.lastSpeakerId) ?? members[0];
```

- [ ] **Step 3: Use last-speaker in the chat/unknown branch**

The chat/unknown branch currently reads:

```ts
  if (cap === "chat" || cap === "unknown") {
    const responder = members[0];
```

Change the `responder` line to:

```ts
  if (cap === "chat" || cap === "unknown") {
    const responder = mentioned ?? members.find((m) => m.id === opts?.lastSpeakerId) ?? members[0];
```

(`mentioned` is already defined earlier in `resolve`.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. (Existing caller `teamChat` still compiles — `opts` is optional; Task 4 will pass it.)

- [ ] **Step 5: Commit**

```bash
git add lib/chat/orchestrate.ts
git commit -m "Chat routing: unmentioned general messages fall back to the last agent who spoke"
```

---

## Task 4: `teamChat` pending-answer path + `startOutreach`

**Files:**
- Modify: `lib/chat/actions.ts`

**Interfaces:**
- Consumes: `askWhoAgainText`, `isAskWhoPrompt`, `isAllRequest`, `askWhoText` (`./outreachTarget`); `resolveTargetLeads` (`@/lib/ai/resolveLeads`); `parseMentions`, `resolve` (`./orchestrate`); `listTeamLeadsForPicker`, `setLeadReview` (`@/lib/leads/store`); `enqueueJob` (`@/lib/jobs/actions`); `_listTeamMessages` (`./teamMessages`).
- Produces: unchanged `teamChat(teamId, message, leadIds?)` signature and `TeamChatResult`.

- [ ] **Step 1: Replace the body of `lib/chat/actions.ts`**

Replace the whole file with:

```ts
"use server";
// The team group-chat orchestration entrypoint: mentions → intent → route →
// enqueue the real job. Returns the messages to post + any job to poll.
import { getSession } from "@/lib/auth/session";
import { membersOfTeam } from "@/lib/teams/membership";
import { agentInfo } from "@/lib/pod/orchestrate";
import { detectIntent } from "@/lib/ai/intent";
import { resolve, parseMentions, type ChatOutMsg } from "./orchestrate";
import { enqueueJob } from "@/lib/jobs/actions";
import { listTeamMessages as _listTeamMessages } from "./teamMessages";
import { listTeamLeadsForPicker, setLeadReview } from "@/lib/leads/store";
import { isAllRequest, askWhoText, askWhoAgainText, isAskWhoPrompt } from "./outreachTarget";
import { resolveTargetLeads } from "@/lib/ai/resolveLeads";

export interface TeamChatResult {
  messages: ChatOutMsg[];
  job?: { id: string; kind: string; agentId: string };
}

type Member = NonNullable<Awaited<ReturnType<typeof agentInfo>>>;

// Capabilities whose jobs consume specific leads (so /lead picks apply to them).
const LEAD_CAPS = new Set(["outreach", "research", "qualify", "proposal"]);

const onItText = (name: string) => `${(name || "").split(" ")[0] || "I"} here — on it, drafting outreach. 🔍`;

/** Approve any picked leads, then enqueue an outreach job for the target. Shared
 *  by the fresh-request gate and the pending-answer path. */
async function startOutreach(actor: Member, target: { leadIds?: string[]; all?: boolean }): Promise<{ jobId: string } | { error: string }> {
  const agent = { id: actor.id, name: actor.name, role: actor.role, goal: actor.goal, task: actor.task };
  if (target.leadIds && target.leadIds.length) {
    await setLeadReview(target.leadIds, "accepted");
    return enqueueJob({ agent, kind: "outreach", capabilities: actor.capabilities, leadIds: target.leadIds, batchSize: target.leadIds.length });
  }
  return enqueueJob({ agent, kind: "outreach", capabilities: actor.capabilities });
}

export async function teamChat(teamId: string, message: string, leadIds?: string[]): Promise<TeamChatResult> {
  const s = await getSession();
  const userId = s?.userId;
  if (!userId) return { messages: [{ who: "system", text: "Not signed in." }] };

  const memberIds = await membersOfTeam(userId, teamId);
  const members = (await Promise.all(memberIds.map((id) => agentInfo(userId, id)))).filter(Boolean) as Member[];

  // Conversation context from the thread: the last agent to speak (continuity),
  // and whether that last agent message is Outreach's still-open "who?" prompt.
  const history = await _listTeamMessages(userId, teamId);
  const byId = new Map(members.map((m) => [m.id, m] as const));
  let lastSpeaker: Member | undefined;
  let lastAgentText = "";
  for (let i = history.length - 1; i >= 0; i--) {
    const spk = byId.get(history[i].who);
    if (spk) { lastSpeaker = spk; lastAgentText = history[i].text; break; }
  }
  const pendingAgent = lastSpeaker && lastSpeaker.capabilities.includes("outreach") && isAskWhoPrompt(lastAgentText, lastSpeaker.name)
    ? lastSpeaker : undefined;

  const intent = await detectIntent(message, members.map((m) => ({ name: m.name, capabilities: m.capabilities })));
  const mentions = parseMentions(message, members);

  // Pending-answer path: Outreach just asked "who?", and this is an unmentioned
  // reply that isn't a different command → interpret it as the answer.
  if (pendingAgent && mentions.length === 0 && (intent.capability === "chat" || intent.capability === "unknown" || intent.capability === "outreach")) {
    const picks = (leadIds ?? []).filter(Boolean);
    let target: { leadIds?: string[]; all?: boolean } | null = null;
    if (picks.length) {
      target = { leadIds: picks };
    } else {
      const teamLeads = await listTeamLeadsForPicker(teamId);
      const hasAccepted = teamLeads.some((l) => l.review === "accepted");
      if (isAllRequest(message)) {
        if (hasAccepted) target = { all: true };
      } else {
        const r = await resolveTargetLeads(message, teamLeads);
        if (r.mode === "all") { if (hasAccepted) target = { all: true }; }
        else if (r.mode === "some" && r.leadIds.length) target = { leadIds: r.leadIds };
      }
    }
    if (!target) return { messages: [{ who: pendingAgent.id, text: askWhoAgainText(pendingAgent.name) }] };
    const enq = await startOutreach(pendingAgent, target);
    if ("error" in enq) return { messages: [{ who: pendingAgent.id, text: "…couldn't start that: " + enq.error }] };
    return { messages: [{ who: pendingAgent.id, text: onItText(pendingAgent.name) }], job: { id: enq.jobId, kind: "outreach", agentId: pendingAgent.id } };
  }

  const res = await resolve(userId, teamId, message, intent, { lastSpeakerId: lastSpeaker?.id });
  if (!res.actor || !res.capability) return { messages: res.messages };
  const actor = res.actor;
  const cap = res.capability;
  const picks = (leadIds ?? []).filter(Boolean);

  // Fresh outreach request.
  if (cap === "outreach") {
    if (picks.length) {
      const enq = await startOutreach(actor, { leadIds: picks });
      if ("error" in enq) return { messages: res.messages.concat([{ who: actor.id, text: "…couldn't start that: " + enq.error }]) };
      return { messages: res.messages, job: { id: enq.jobId, kind: "outreach", agentId: actor.id } };
    }
    // no picks: ask who, unless "all" with at least one accepted lead.
    if (isAllRequest(message)) {
      const teamLeads = await listTeamLeadsForPicker(teamId);
      if (teamLeads.some((l) => l.review === "accepted")) {
        const enq = await startOutreach(actor, { all: true });
        if ("error" in enq) return { messages: res.messages.concat([{ who: actor.id, text: "…couldn't start that: " + enq.error }]) };
        return { messages: res.messages, job: { id: enq.jobId, kind: "outreach", agentId: actor.id } };
      }
    }
    return { messages: [{ who: actor.id, text: askWhoText(actor.name) }] };
  }

  // Other lead-consuming capabilities: approve picks (if any), pass leadIds.
  if (LEAD_CAPS.has(cap) && picks.length) {
    await setLeadReview(picks, "accepted");
  }
  const enq = await enqueueJob({
    agent: { id: actor.id, name: actor.name, role: actor.role, goal: actor.goal, task: actor.task },
    kind: cap, capabilities: actor.capabilities,
    target: intent.params.target ?? 10,
    instruction: cap === "scrape" ? message : undefined,
    leadIds: LEAD_CAPS.has(cap) && picks.length ? picks : undefined,
    batchSize: LEAD_CAPS.has(cap) && picks.length ? picks.length : undefined,
  });
  if ("error" in enq) return { messages: res.messages.concat([{ who: actor.id, text: "…couldn't start that: " + enq.error }]) };
  return { messages: res.messages, job: { id: enq.jobId, kind: cap, agentId: actor.id } };
}

export async function listTeamMessages(teamId: string): Promise<{ who: string; text: string }[]> {
  const s = await getSession();
  if (!s?.userId) return [];
  return _listTeamMessages(s.userId, teamId);
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. Confirm `parseMentions` is exported from `./orchestrate` (it is) and `resolve` accepts the 5th `opts` arg (Task 3).

- [ ] **Step 3: Manual in-app verification (user-run)**

Restart `pnpm dev`. In a team chat with an Outreach agent + some leads:
1. `@Outreach outreach a lead` → Outreach asks "who?". Reply `all` → drafts the accepted book (Outreach responds, not Scraper).
2. Ask again → reply a lead's **name** (e.g. `Maria`) → drafts that lead (approved if it was pending).
3. Ask again → reply `this` → Outreach **re-asks** (askWhoAgain), stays with Outreach.
4. Ask again → reply `/lead` pick → drafts the picked leads.
5. While an ask-who is open, send `scrape linkedin for CTOs` → routes to the scraper (not re-asked).
6. After a draft, an unmentioned "what next?" is answered by Outreach (last speaker), not Scraper.

- [ ] **Step 4: Commit**

```bash
git add lib/chat/actions.ts
git commit -m "Team chat: interpret ask-who replies (name/desc/all) via Outreach + last-speaker continuity"
```

---

## Self-Review

**Spec coverage:**
- Ask-who prompt helpers (spec §1) → Task 1. ✅
- `resolveTargetLeads` reply→ids (spec §2) → Task 2. ✅
- Last-speaker continuity in status + chat (spec §3) → Task 3. ✅
- Pending-answer path: picks / all / some / none→re-ask; only when pending + unmentioned + intent∈{chat,unknown,outreach}; `startOutreach` reused by fresh gate (spec §4) → Task 4. ✅
- "all" with zero accepted → re-ask (no silent 0) → Task 4 (pending path leaves `target` null; fresh gate falls to `askWhoText`). ✅
- Ids validated against team leads (spec Correctness) → Task 2 (`resolveTargetLeads` filters) + Task 4 uses `r.leadIds` already filtered. ✅
- No schema/migration, no runner change → confirmed. ✅

**Placeholder scan:** none — every step has complete code. `<scratchpad>` is a directory token the implementer substitutes (stated in Task 1/2). ✅

**Type consistency:** `Member` = `NonNullable<Awaited<ReturnType<typeof agentInfo>>>` used for `startOutreach`, `lastSpeaker`, `pendingAgent`. `resolveTargetLeads` returns `{mode,leadIds}` consumed in Task 4. `resolve(...,opts?)` defined in Task 3, called with `{ lastSpeakerId }` in Task 4. `askWhoAgainText`/`isAskWhoPrompt` defined Task 1, used Task 4. `TeamLeadPick` (from the prior feature) consumed by Task 2/4. ✅
