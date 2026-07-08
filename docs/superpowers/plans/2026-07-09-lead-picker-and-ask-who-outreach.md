# `/lead` Picker + "Ask Who" Outreach — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/lead` picker to the team-chat composer so the user selects exactly which leads to reach out to, and make outreach ask "who?" instead of silently drafting 0 emails.

**Architecture:** Client `/lead` popover (mirrors the existing `@mention` popover) collects lead ids into a "To:" chip row; those ids ride the `sendTeamChat → teamChat` call. `teamChat` gates outreach: picked leads are approved-on-send and drafted; a bare "outreach" with no pick and no "all" returns an "ask who" reply and enqueues nothing. No job-runner changes — `enqueueJob`/`pickLeadsForRun` already honor `leadIds`.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Drizzle (neon-http), Gemini REST. Inline styles via `css()` + `Box`/`Btn`. Server actions in `"use server"` modules.

## Global Constraints

- **No test runner exists** (no jest/vitest, zero `*.test.ts`). Verification = `npx tsc --noEmit` (run from `agentic-salesforce/`), `pnpm lint`, scratchpad `.mjs` for pure logic, and manual in-app checks. Do **not** add a test framework.
- **Agent must not write to the DB** (migrations and runtime DB writes are the user's to run). Do not run scripts that mutate Postgres. DB-touching behavior is verified by `tsc` + the user's manual in-app pass.
- **Commits:** author is Ghousted. **No** `Co-Authored-By` / "Generated with Claude" trailer. Do **not** push (the user pushes explicitly).
- **Do not** print or commit `.env.local`.
- Styling: match surrounding code — inline `css("…")` strings, `Box`/`Btn` primitives, the app purple `#5122C1`.
- Branch: work on the current `feat/sales-capabilities` branch. Do not merge.

---

## File Structure

- `lib/leads/types.ts` — **modify**: add `TeamLeadPick` DTO.
- `lib/leads/store.ts` — **modify**: add `listTeamLeadsForPicker(teamId)` (session-scoped; pending+accepted team leads).
- `lib/leads/actions.ts` — **modify**: add `listTeamLeads(teamId)` `"use server"` wrapper.
- `lib/chat/outreachTarget.ts` — **create**: pure `isAllRequest(message)` + `askWhoText(agentName)`.
- `lib/chat/actions.ts` — **modify**: `teamChat(teamId, message, leadIds?)` + outreach gate + approve picks + pass `leadIds`.
- `lib/store.tsx` — **modify**: `chatLeadPicks` state + `sendTeamChat(teamId, text, leadIds?)`.
- `app/chats/page.tsx` — **modify**: `/lead` popover, "To:" chip row, send wiring, placeholder.

Task order is dependency order: 1 (leads data) → 2 (server gate) → 3 (store) → 4 (client UI).

---

## Task 1: Server — team leads for the `/lead` picker

**Files:**
- Modify: `lib/leads/types.ts` (add `TeamLeadPick`)
- Modify: `lib/leads/store.ts` (add `listTeamLeadsForPicker`)
- Modify: `lib/leads/actions.ts` (add `listTeamLeads`)

**Interfaces:**
- Produces: `TeamLeadPick { id, name, title, company, platform, review }`; `listTeamLeadsForPicker(teamId: string): Promise<TeamLeadPick[]>` (server-only store fn, session-scoped); `listTeamLeads(teamId: string): Promise<TeamLeadPick[]>` (server action).

- [ ] **Step 1: Add the `TeamLeadPick` type**

In `lib/leads/types.ts`, append after `ProposalResult` (end of file):

```ts
// A slim lead shape for the team-chat /lead picker (pending + accepted only).
export interface TeamLeadPick {
  id: string;
  name: string;
  title: string;
  company: string;
  platform: string | null;
  review: string; // "pending" | "accepted"
}
```

- [ ] **Step 2: Import `membersOfTeam` and `TeamLeadPick` in the store**

In `lib/leads/store.ts`, the membership import is currently:

```ts
import { teammatesOf } from "@/lib/teams/membership";
```

Change it to:

```ts
import { teammatesOf, membersOfTeam } from "@/lib/teams/membership";
```

And add `TeamLeadPick` to the existing `./types` import (which currently imports `LEAD_STAGES, type LeadDTO, …, type LiveWorkDTO`) by adding `type TeamLeadPick` to that list.

- [ ] **Step 3: Add `listTeamLeadsForPicker` to the store**

In `lib/leads/store.ts`, add after `listCandidates` (around L139, before `setLeadReview`):

```ts
/** Leads for the team-chat /lead picker: every non-dismissed lead (pending +
 *  accepted) owned by any member of the team, newest first. Session-scoped. */
export async function listTeamLeadsForPicker(teamId: string): Promise<TeamLeadPick[]> {
  if (!isDbConfigured()) return [];
  const userId = await uid();
  if (!userId) return [];
  const memberIds = await membersOfTeam(userId, teamId);
  if (memberIds.length === 0) return [];
  const rows = await getDb().select().from(leads)
    .where(and(eq(leads.userId, userId), inArray(leads.agentId, memberIds), inArray(leads.review, ["pending", "accepted"])))
    .orderBy(desc(leads.createdAt));
  return rows.map((r) => ({ id: r.id, name: r.name, title: r.title, company: r.company, platform: r.platform, review: r.review }));
}
```

(`and`, `desc`, `eq`, `inArray`, `getDb`, `isDbConfigured`, `leads`, `uid` are all already imported in this file.)

- [ ] **Step 4: Add the `listTeamLeads` server action**

In `lib/leads/actions.ts`, add `TeamLeadPick` to the `./types` import line:

```ts
import type { LeadDTO, DraftDTO, LiveWorkDTO, TeamLeadPick } from "./types";
```

Then add a wrapper after `listCandidates` (L21):

```ts
export async function listTeamLeads(teamId: string): Promise<TeamLeadPick[]> {
  return store.listTeamLeadsForPicker(teamId);
}
```

- [ ] **Step 5: Typecheck**

Run (from `agentic-salesforce/`): `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/leads/types.ts lib/leads/store.ts lib/leads/actions.ts
git commit -m "Leads: team-scoped /lead picker query (pending+accepted) + listTeamLeads action"
```

---

## Task 2: Server — outreach targeting helper + `teamChat` gate

**Files:**
- Create: `lib/chat/outreachTarget.ts`
- Create (scratchpad, not committed): a `.mjs` truth-table check for `isAllRequest`
- Modify: `lib/chat/actions.ts`

**Interfaces:**
- Consumes: `listTeamLeadsForPicker(teamId)` and `setLeadReview(ids, review)` from `@/lib/leads/store`; `enqueueJob({ …, leadIds? })` from `@/lib/jobs/actions`.
- Produces: `isAllRequest(message: string): boolean`; `askWhoText(agentName: string): string`; `teamChat(teamId: string, message: string, leadIds?: string[]): Promise<TeamChatResult>` (signature gains `leadIds?`).

- [ ] **Step 1: Create the pure targeting helper**

Create `lib/chat/outreachTarget.ts`:

```ts
// Pure helpers for the team-chat outreach "ask who" gate. No I/O — unit-checkable.

// Matches an explicit "everyone" ask so outreach can target the whole book
// without a /lead pick. Word-boundaried so it won't fire inside "call"/"small".
const ALL_RE = /\b(all|everyone|everybody|every ?(one|lead|body))\b/i;

/** True when the message asks to outreach the entire book ("all", "everyone"). */
export function isAllRequest(message: string): boolean {
  return ALL_RE.test(message || "");
}

/** The reply that asks the user who to write to when no leads were picked. */
export function askWhoText(agentName: string): string {
  const first = (agentName || "").split(" ")[0] || "I";
  return `${first} here — who should I write to? Type /lead to pick some leads, or say "outreach all" to write to everyone in your book.`;
}
```

- [ ] **Step 2: Headless-check the `isAllRequest` truth table**

Create `<scratchpad>/isallrequest-check.mjs` (inlines the same regex; validates the boundary cases before wiring):

```js
const ALL_RE = /\b(all|everyone|everybody|every ?(one|lead|body))\b/i;
const isAll = (m) => ALL_RE.test(m || "");
const cases = [
  ["outreach all", true],
  ["outreach all my leads", true],
  ["message everyone", true],
  ["write to every one of them", true],
  ["email everybody", true],
  ["outreach a lead", false],
  ["follow up with the makati buyer", false],
  ["give me a call summary", false],   // must NOT match inside "call"
  ["a small favor", false],            // must NOT match inside "small"
];
let ok = true;
for (const [m, want] of cases) {
  const got = isAll(m);
  if (got !== want) { ok = false; console.log(`FAIL: "${m}" → ${got}, want ${want}`); }
}
console.log(ok ? "ALL PASS" : "FAILURES ABOVE");
```

- [ ] **Step 3: Run the check**

Run: `node <scratchpad>/isallrequest-check.mjs`
Expected: `ALL PASS`. If any FAIL prints, fix `ALL_RE` in **both** the helper and this script until it passes.

- [ ] **Step 4: Rewrite `teamChat` with the gate**

Replace the body of `lib/chat/actions.ts` with:

```ts
"use server";
// The team group-chat orchestration entrypoint: mentions → intent → route →
// enqueue the real job. Returns the messages to post + any job to poll.
import { getSession } from "@/lib/auth/session";
import { membersOfTeam } from "@/lib/teams/membership";
import { agentInfo } from "@/lib/pod/orchestrate";
import { detectIntent } from "@/lib/ai/intent";
import { resolve, type ChatOutMsg } from "./orchestrate";
import { enqueueJob } from "@/lib/jobs/actions";
import { listTeamMessages as _listTeamMessages } from "./teamMessages";
import { listTeamLeadsForPicker, setLeadReview } from "@/lib/leads/store";
import { isAllRequest, askWhoText } from "./outreachTarget";

export interface TeamChatResult {
  messages: ChatOutMsg[];
  job?: { id: string; kind: string; agentId: string };
}

// Capabilities whose jobs consume specific leads (so /lead picks apply to them).
const LEAD_CAPS = new Set(["outreach", "research", "qualify", "proposal"]);

export async function teamChat(teamId: string, message: string, leadIds?: string[]): Promise<TeamChatResult> {
  const s = await getSession();
  const userId = s?.userId;
  if (!userId) return { messages: [{ who: "system", text: "Not signed in." }] };

  const memberIds = await membersOfTeam(userId, teamId);
  const members = (await Promise.all(memberIds.map((id) => agentInfo(userId, id)))).filter(Boolean) as NonNullable<Awaited<ReturnType<typeof agentInfo>>>[];
  const intent = await detectIntent(message, members.map((m) => ({ name: m.name, capabilities: m.capabilities })));

  const res = await resolve(userId, teamId, message, intent);
  if (!res.actor || !res.capability) return { messages: res.messages };
  const actor = res.actor;
  const cap = res.capability;
  const picks = (leadIds ?? []).filter(Boolean);

  // Outreach "ask who" gate: with no pick and no explicit "all", ask instead of
  // drafting. "all" only proceeds when there is at least one accepted lead.
  if (cap === "outreach" && picks.length === 0) {
    if (isAllRequest(message)) {
      const teamLeads = await listTeamLeadsForPicker(teamId);
      const hasAccepted = teamLeads.some((l) => l.review === "accepted");
      if (!hasAccepted) return { messages: [{ who: actor.id, text: askWhoText(actor.name) }] };
      // fall through → enqueue outreach with no leadIds (all accepted, undrafted)
    } else {
      return { messages: [{ who: actor.id, text: askWhoText(actor.name) }] };
    }
  }

  // Picking = approving: flip any picked leads to accepted so the runner (which
  // only drafts review='accepted') will pick them up.
  if (LEAD_CAPS.has(cap) && picks.length) {
    await setLeadReview(picks, "accepted");
  }

  const enq = await enqueueJob({
    agent: { id: actor.id, name: actor.name, role: actor.role, goal: actor.goal, task: actor.task },
    kind: cap, capabilities: actor.capabilities,
    target: intent.params.target ?? 10,
    // The user's raw message is the sole targeting for a scrape (no ICP).
    instruction: cap === "scrape" ? message : undefined,
    // /lead picks target specific leads for lead-consuming capabilities.
    leadIds: LEAD_CAPS.has(cap) && picks.length ? picks : undefined,
  });
  if ("error" in enq) {
    return { messages: res.messages.concat([{ who: actor.id, text: "…couldn't start that: " + enq.error }]) };
  }
  return { messages: res.messages, job: { id: enq.jobId, kind: cap, agentId: actor.id } };
}

export async function listTeamMessages(teamId: string): Promise<{ who: string; text: string }[]> {
  const s = await getSession();
  if (!s?.userId) return [];
  return _listTeamMessages(s.userId, teamId);
}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (`enqueueJob` already accepts `leadIds?: string[]`; `setLeadReview` and `listTeamLeadsForPicker` are exported from `lib/leads/store.ts`.)

- [ ] **Step 6: Commit**

```bash
git add lib/chat/outreachTarget.ts lib/chat/actions.ts
git commit -m "Team chat: outreach ask-who gate + /lead picks approve-on-send and target the job"
```

---

## Task 3: Store — `chatLeadPicks` state + `sendTeamChat(leadIds?)`

**Files:**
- Modify: `lib/store.tsx`

**Interfaces:**
- Consumes: `teamChat(teamId, text, leadIds?)` from `./chat/actions`.
- Produces: `s.chatLeadPicks: { id: string; name: string }[]` on the app state; `sendTeamChat(teamId: string, text: string, leadIds?: string[]): void` on the context.

- [ ] **Step 1: Add `chatLeadPicks` to the `State` interface**

In `lib/store.tsx`, in `interface State` (right after `chatTyping: boolean;`, L51), add:

```ts
  chatLeadPicks: { id: string; name: string }[];
```

- [ ] **Step 2: Add it to `initialState`**

In `initialState`, the line is:

```ts
  chats: chatsInit(), convId: "sk", chatInput: "", chatTyping: false,
```

Change it to:

```ts
  chats: chatsInit(), convId: "sk", chatInput: "", chatTyping: false, chatLeadPicks: [],
```

- [ ] **Step 3: Update the context type for `sendTeamChat`**

In the `Ctx` interface, change:

```ts
  sendTeamChat: (teamId: string, text: string) => void;
```

to:

```ts
  sendTeamChat: (teamId: string, text: string, leadIds?: string[]) => void;
```

- [ ] **Step 4: Thread `leadIds` through `sendTeamChat`**

In `lib/store.tsx`, the `sendTeamChat` definition starts:

```ts
  const sendTeamChat = useCallback((teamId: string, text: string) => {
    const t = (text || "").trim();
    if (!t) return;
    set((prev) => ({
      chats: { ...prev.chats, [teamId]: (prev.chats[teamId] || []).concat([{ who: "me", text: t }]) },
      chatInput: "", chatTyping: true,
    }));
```

Change the signature and the `set` to clear picks:

```ts
  const sendTeamChat = useCallback((teamId: string, text: string, leadIds?: string[]) => {
    const t = (text || "").trim();
    if (!t) return;
    set((prev) => ({
      chats: { ...prev.chats, [teamId]: (prev.chats[teamId] || []).concat([{ who: "me", text: t }]) },
      chatInput: "", chatTyping: true, chatLeadPicks: [],
    }));
```

Then in the same function, the call is currently:

```ts
    teamChat(teamId, t).then(async (res) => {
```

Change it to pass the ids:

```ts
    teamChat(teamId, t, leadIds).then(async (res) => {
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/store.tsx
git commit -m "Store: chatLeadPicks state + sendTeamChat forwards picked lead ids"
```

---

## Task 4: Client — `/lead` popover + "To:" chips in the composer

**Files:**
- Modify: `app/chats/page.tsx`

**Interfaces:**
- Consumes: `listTeamLeads(teamId)` from `@/lib/leads/actions`; `s.chatLeadPicks` and `sendTeamChat(teamId, text, leadIds)` from the store.

- [ ] **Step 1: Import `listTeamLeads` and the pick type**

In `app/chats/page.tsx`, near the top imports (after the `listPendingApprovals` import, L8), add:

```ts
import { listTeamLeads } from "@/lib/leads/actions";
import type { TeamLeadPick } from "@/lib/leads/types";
```

- [ ] **Step 2: Load the team's leads into local state**

Inside `ChatsInner`, after `const [handled, setHandled] = useState<Set<string>>(new Set());` (L42), add:

```ts
  const [teamLeads, setTeamLeads] = useState<TeamLeadPick[]>([]);
  useEffect(() => {
    if (!activeTeam) { setTeamLeads([]); return; }
    let alive = true;
    listTeamLeads(activeTeam.id).then((ls) => { if (alive) setTeamLeads(ls); }).catch(() => {});
    return () => { alive = false; };
  }, [activeTeam]);
```

(`useState`/`useEffect` are already imported from `react` at L2. `activeTeam` is already computed at L37.)

- [ ] **Step 3: Add a lead helper for labels**

Directly below that effect, add a small formatter (keeps JSX tidy):

```ts
  const leadLabel = (l: TeamLeadPick) => l.name + (l.title ? " — " + l.title : l.company ? " — " + l.company : "");
  const addPick = (l: TeamLeadPick) => set((prev) => ({
    chatInput: prev.chatInput.replace(/\/lead[^\s]*$/i, ""),
    chatLeadPicks: prev.chatLeadPicks.some((p) => p.id === l.id) ? prev.chatLeadPicks : prev.chatLeadPicks.concat([{ id: l.id, name: l.name }]),
  }));
  const removePick = (id: string) => set((prev) => ({ chatLeadPicks: prev.chatLeadPicks.filter((p) => p.id !== id) }));
```

- [ ] **Step 4: Add the `/lead` popover**

In the composer area, the mention popover block ends at L191 with `})()}`. Immediately after it (before the `{!activeTeam && (` suggestions block at L192), add the `/lead` popover:

```tsx
          {activeTeam && (() => {
            const m = s.chatInput.match(/\/lead([^\s]*)$/i);
            if (!m) return null;
            const q = m[1].toLowerCase();
            const hits = teamLeads.filter((l) => (l.name + " " + l.title + " " + l.company).toLowerCase().includes(q)).slice(0, 6);
            if (hits.length === 0) return (
              <div style={css("position:absolute;bottom:64px;left:20px;background:#fff;border:1px solid #ECECF1;border-radius:12px;box-shadow:0 12px 32px rgba(24,24,27,.14);padding:11px 14px;z-index:20;font-size:12px;color:#A1A1AA")}>
                No leads yet — scrape some first.
              </div>
            );
            return (
              <div style={css("position:absolute;bottom:64px;left:20px;background:#fff;border:1px solid #ECECF1;border-radius:12px;box-shadow:0 12px 32px rgba(24,24,27,.14);overflow:hidden;z-index:20;min-width:280px;max-height:280px;overflow-y:auto")}>
                {hits.map((l) => (
                  <Box key={l.id} onClick={() => addPick(l)} style="display:flex;align-items:center;gap:9px;padding:9px 12px;cursor:pointer" styleHover="background:#F4F4F5">
                    <div style={css("flex:1;font-size:12.5px;font-weight:600;color:#18181B")}>{l.name}<span style={css("font-size:10.5px;color:#A1A1AA;font-weight:400")}> · {l.title || l.company || l.platform || "lead"}</span></div>
                    <div style={css("font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;border-radius:99px;padding:2px 7px;" + (l.review === "accepted" ? "background:#E7F7EC;color:#1B7A3D" : "background:#FEF3E7;color:#B7791F"))}>{l.review}</div>
                  </Box>
                ))}
              </div>
            );
          })()}
```

- [ ] **Step 5: Add the "To:" chip row**

The composer input wrapper starts at L197 (`<div style={css("display:flex;gap:10px;background:#fff;border:1px solid #ECECF1;border-radius:99px;…`). Immediately **before** that wrapper `<div>`, add the chip row:

```tsx
          {activeTeam && s.chatLeadPicks.length > 0 && (
            <div style={css("display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;align-items:center")}>
              <span style={css("font-size:11px;color:#A1A1AA;font-weight:600")}>To:</span>
              {s.chatLeadPicks.map((p) => (
                <span key={p.id} style={css("display:inline-flex;align-items:center;gap:6px;background:#F1EDFD;color:#5122C1;border-radius:99px;padding:4px 10px;font-size:11.5px;font-weight:600")}>
                  {p.name}
                  <span onClick={() => removePick(p.id)} style={css("cursor:pointer;font-weight:700;opacity:.7")}>✕</span>
                </span>
              ))}
            </div>
          )}
```

- [ ] **Step 6: Wire send (Enter + button) to pass picks, and update the placeholder**

The input's `onKeyDown` Enter branch currently calls `sendTeamChat(activeTeam.id, s.chatInput);` (L208). Change that one call to:

```tsx
                  sendTeamChat(activeTeam.id, s.chatInput, s.chatLeadPicks.map((p) => p.id));
```

The Send button (L214) currently reads:

```tsx
            <Btn onClick={() => { activeTeam ? sendTeamChat(activeTeam.id, s.chatInput) : sendChat(s.chatInput); }} …>Send ↑</Btn>
```

Change the `sendTeamChat` call there to:

```tsx
            <Btn onClick={() => { activeTeam ? sendTeamChat(activeTeam.id, s.chatInput, s.chatLeadPicks.map((p) => p.id)) : sendChat(s.chatInput); }} style="background:#5122C1;color:#fff;border:none;border-radius:99px;padding:8px 18px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#42199E">Send ↑</Btn>
```

Update the placeholder (L211) from `"Message the team — @mention an agent…"` to:

```tsx
              placeholder={activeTeam ? "Message the team — @mention an agent, /lead to pick leads…" : "Message " + activeAgent.name.split(" ")[0] + "…"}
```

- [ ] **Step 7: Typecheck + lint**

Run: `npx tsc --noEmit && pnpm lint`
Expected: no type errors; lint clean (or only pre-existing warnings unrelated to these files).

- [ ] **Step 8: Manual in-app verification (user-run)**

Restart `pnpm dev` if needed, then in a team chat:
1. Ensure the team's agent has scraped a few leads (they show as `pending`). Type `/lead` → popover lists them with `pending` badges. Pick two → two "To:" chips appear, `/lead` text is cleared. Send `@Outreach follow up`.
   Expected: thread shows "On it — drafting outreach 🔍" then "Drafted 2 emails — in the Emails tab"; the two leads are now `accepted` in Leads; 2 drafts in the Emails tab.
2. `@Outreach outreach a lead` with **no** chips → agent replies asking who ("Type /lead to pick… or say 'outreach all'"); no draft is created.
3. `@Outreach outreach all` with ≥1 accepted lead → drafts for the accepted book.
4. `@Outreach outreach all` when nothing is accepted → agent asks who.

- [ ] **Step 9: Commit**

```bash
git add app/chats/page.tsx
git commit -m "Chat composer: /lead picker popover + To: chips wired into sendTeamChat"
```

---

## Self-Review

**Spec coverage:**
- `/lead` picker (spec §1) → Task 4 Steps 4–5. ✅
- Team leads pending+accepted data (spec §1, §4) → Task 1. ✅
- Picking = approving (spec Goals, §3) → Task 2 Step 4 (`setLeadReview(picks, "accepted")`). ✅
- Send plumbing `sendTeamChat(…, leadIds)` → `teamChat(…, leadIds)` (spec §2, §3) → Task 3 + Task 2. ✅
- Outreach "ask who" gate, "all" shortcut, no silent 0 (spec §2, Goals, Edge cases) → Task 2 Step 4. ✅
- `/lead` flows to research/qualify/proposal but ask-who is outreach-only (spec §2) → Task 2 (`LEAD_CAPS` for picks, gate keyed on `cap === "outreach"`). ✅
- No job-runner changes (spec §3) → confirmed; runner untouched. ✅
- Out of scope: agent-page button, review screen (spec Non-goals) → not touched. ✅

**Deviation from spec (intentional):** the spec proposed a new user-scoped `acceptLeads(userId, ids)`; the plan instead reuses the existing session-scoped `setLeadReview(ids, "accepted")` since `teamChat` runs with the session. Simpler, DRY, same effect.

**Placeholder scan:** no TBD/TODO; every code step shows complete code. ✅

**Type consistency:** `TeamLeadPick` fields (`id,name,title,company,platform,review`) are produced identically in Task 1 Step 3 and consumed in Task 4. `sendTeamChat(teamId, text, leadIds?)` matches between Task 3 (store) and Task 4 (callers). `teamChat(teamId, message, leadIds?)` matches between Task 2 (def) and Task 3 (caller). `isAllRequest`/`askWhoText` defined in Task 2 Step 1, used in Task 2 Step 4. ✅
