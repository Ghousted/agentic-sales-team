# Team chat: interpret the answer to Outreach's "who?" + conversation continuity

**Date:** 2026-07-09
**Status:** Approved (design)

## Problem

The outreach "ask-who" gate (shipped in the `/lead` feature) makes Outreach reply
*"who should I write to? Type /lead to pick some leads, or say 'outreach all'."*
But the chat has no memory of that question:

1. The user's reply (e.g. "this", "Maria", "all") is classified as a fresh
   message. Plain text that isn't a capability falls to `chat` intent.
2. An **unmentioned** message defaults to the **first team member** — so the reply
   is answered by the wrong agent (e.g. *Scraper* instead of *Outreach*).

The user wants the chat to (a) keep the conversation with the agent they're talking
to, and (b) **interpret the content** of their answer to "who?" against their real
leads and act on it.

## Goals

- After Outreach asks "who?", the user's next reply is handled by **Outreach** and
  read as the answer:
  - "all" / "everyone" → draft for the whole accepted book.
  - a name or description ("Maria", "the Makati condo buyer", "the first one") →
    AI matches it to specific lead ids → approve-on-send + draft for those.
  - a `/lead` pick (unchanged) → draft for the picked leads.
  - something it can't pin down ("this", off-topic) → Outreach **re-asks** (and the
    conversation stays with Outreach).
- **Conversation continuity**: an unmentioned general message routes to the last
  agent who spoke in the thread, not always the first member.

## Non-goals

- No new persistence/table. Pending state is **derived from the thread** (the last
  agent message being the ask-who prompt). No schema change / migration.
- Resolving deictic references with no context ("this") — those legitimately
  re-ask. We set that expectation; names/descriptions/"all" resolve.
- No change to the `/lead` picker, the Leads screen, or the job runner.
- The interpretation applies **only** to outreach's ask-who window. Research /
  qualify / proposal keep their batch defaults.

## Architecture

Everything hangs off two derivations from the persisted thread (`listTeamMessages`):
the **last agent speaker** (for continuity) and whether the **last agent message is
an ask-who prompt** (for pending-answer interpretation). One new AI helper resolves
a free-text reply to lead ids.

### 1. Ask-who prompt helpers — `lib/chat/outreachTarget.ts` (extend)

Add two pure, headless-testable helpers next to the existing `askWhoText`:

- `askWhoAgainText(agentName)` — the re-ask used when a reply can't be resolved:
  `"<First> — I couldn't tell which lead you meant. Type /lead to pick, name them (e.g. 'Maria'), or say 'outreach all'."`
- `isAskWhoPrompt(text, agentName)` — `text === askWhoText(agentName) || text === askWhoAgainText(agentName)`.

Both re-ask paths use one of these exact strings, so the next turn's detection
(comparing the last agent message to these) still recognizes the pending state.

### 2. Reply → lead ids — `lib/ai/resolveLeads.ts` (new)

`resolveTargetLeads(reply: string, leads: TeamLeadPick[]): Promise<{ mode: "all" | "some" | "none"; leadIds: string[] }>`

One Gemini JSON call (`gemini-2.5-flash`, `thinkingBudget: 0`, temp ~0.15,
`geminiJSON`). System prompt: the user was asked which leads to write to; given
their reply and the numbered lead list (id, name, title, company, platform),
return `mode='all'` if they mean everyone/the whole list; `mode='some'` with
`leadIds` for leads they name or describe (ids **only** from the provided list);
`mode='none'` if it can't be determined (vague deictic like "this"/"that one", or
unrelated). Schema `{ mode: enum[all,some,none], leadIds: string[] }`. On no-Gemini
or error, return `{ mode: "none", leadIds: [] }` (→ safe re-ask). Empty `leads` →
short-circuit `{ mode: "none", leadIds: [] }` without calling Gemini.

### 3. Continuity fallback — `lib/chat/orchestrate.ts` (extend)

- `resolve(userId, teamId, message, intent, opts?: { lastSpeakerId?: string })` — new
  optional `opts.lastSpeakerId`.
- In the **status** branch and the **chat/unknown** branch, change the fallback
  responder from `members[0]` to
  `mentioned ?? members.find(m => m.id === opts?.lastSpeakerId) ?? members[0]`.
- No other routing changes (capability routing is unchanged).

### 4. Pending-answer handling — `lib/chat/actions.ts` (`teamChat`, extend)

`teamChat(teamId, message, leadIds?)`:

1. Load `members` (as today) and `history = listTeamMessages(userId, teamId)`.
2. Derive from `history` (newest-first, skipping `"me"`/`"system"`):
   - `lastSpeakerId` = the most recent `who` that is a current member id.
   - `pendingAgent` = that member **iff** it's outreach-capable **and**
     `isAskWhoPrompt(lastAgentMessageText, member.name)`.
   - (Because we only look at the last *agent* message, the concurrently-persisted
     user message doesn't interfere — see Timing.)
3. `intent = detectIntent(...)`; `mentions = parseMentions(message, members)`.
4. **Pending-answer path** — if `pendingAgent` **and** `mentions.length === 0`
   **and** `intent.capability ∈ { chat, unknown, outreach }`:
   - `picks = (leadIds ?? []).filter(Boolean)`.
   - If `picks.length` → `target = { leadIds: picks }`.
   - Else `teamLeads = listTeamLeadsForPicker(teamId)`; `r = resolveTargetLeads(message, teamLeads)`:
     - `r.mode === "all"` → if ≥1 accepted lead → `target = { all: true }`; else re-ask.
     - `r.mode === "some"` → `ids = r.leadIds ∩ teamLeads.id`; if non-empty → `target = { leadIds: ids }`; else re-ask.
     - `r.mode === "none"` → re-ask.
   - **re-ask** = `return { messages: [{ who: pendingAgent.id, text: askWhoAgainText(pendingAgent.name) }] }` (no job; stays pending).
   - **draft** = `startOutreach(pendingAgent, target)` (below) → `return { messages: [{ who: pendingAgent.id, text: outreach "On it" line }], job }`.
5. **Normal path** — otherwise `res = resolve(userId, teamId, message, intent, { lastSpeakerId })` and the existing gate/enqueue logic (unchanged), so a fresh `@Outreach outreach a lead`, a topic change ("scrape LinkedIn"), or an @mention all route normally.

**`startOutreach(actor, target)` helper** (in `actions.ts`) — factor the approve+enqueue used by both the pending path and the existing gate:
- `target.leadIds` → `setLeadReview(ids, "accepted")`; `enqueueJob({ agent: actor, kind: "outreach", capabilities: actor.capabilities, leadIds: ids, batchSize: ids.length })`.
- `target.all` → `enqueueJob({ agent: actor, kind: "outreach", capabilities: actor.capabilities })` (no leadIds → runner drafts all accepted, undrafted).
- Returns the `enqueueJob` result; caller builds the message + `job`.

The existing gate's picks / "all" branches are refactored to call `startOutreach`
so there is one approve+enqueue implementation.

## Data flow

```
Outreach asks "who?"  (last agent msg = askWhoText(Outreach))
User: "the makati buyer"   (no @mention, intent=chat)
 teamChat: pendingAgent=Outreach (isAskWhoPrompt matches)
   → intent chat, no mention → pending-answer path
   → resolveTargetLeads("the makati buyer", teamLeads) → { mode:"some", leadIds:[L3] }
   → ids=[L3] valid → startOutreach(Outreach, { leadIds:[L3] })
       setLeadReview([L3],"accepted"); enqueueJob(outreach, leadIds:[L3], batchSize:1)
   → { messages:[{who:Outreach, "On it — drafting outreach. 🔍"}], job }
 store polls → "Drafted 1 email — in the Emails tab."
```

Unresolvable:
```
User: "this"  → resolveTargetLeads → { mode:"none" }
 → { messages:[{who:Outreach, text: askWhoAgainText(Outreach)}] }   (re-ask, still pending)
```

## Timing / correctness

- `sendTeamChat` persists the user's message and calls `teamChat` concurrently, so
  the current user message may or may not be in `history` when `teamChat` reads it.
  Detection only inspects the **last agent** message, and `"me"` rows are skipped,
  so the race is immaterial.
- Pending clears naturally: once Outreach drafts (last agent msg = "On it…") the
  next turn's `isAskWhoPrompt` is false. A re-ask re-emits an ask-who prompt string,
  so pending persists across re-asks.
- Topic change ("scrape …", intent≠chat/unknown/outreach) or an @mention bypasses
  the pending path → normal routing; the ask-who message is superseded → pending
  clears.
- `resolveTargetLeads` returns ids only from the provided team leads; `teamChat`
  additionally intersects with `teamLeads` before use — no foreign/hallucinated ids.
- Cross-team correctness from the prior feature holds: `startOutreach` passes
  explicit `leadIds`, which the runner honors regardless of team book.

## Testing

- **tsc** clean.
- **Headless (scratchpad .mjs, pure):** `isAskWhoPrompt` truth table (matches
  `askWhoText`/`askWhoAgainText` for an agent, rejects other text); and a live
  `resolveTargetLeads` check against real Gemini with a small fixture lead list —
  "all"→all, a name→some(correct id), "this"→none. (Read-only; no DB writes.)
- **Manual in-app:** ask-who → reply "all" drafts the book; reply a lead's name
  drafts that lead (and approves it if pending); reply "this" → Outreach re-asks
  (not Scraper); a `/lead` pick still works; "scrape linkedin" mid-pending routes to
  the scraper, not re-asked.

## Files

- `lib/ai/resolveLeads.ts` — new: `resolveTargetLeads`.
- `lib/chat/outreachTarget.ts` — add `askWhoAgainText`, `isAskWhoPrompt`.
- `lib/chat/orchestrate.ts` — `resolve` gains `opts.lastSpeakerId`; status + chat
  fallbacks use it.
- `lib/chat/actions.ts` — `teamChat` pending-answer path + `startOutreach` helper;
  refactor existing gate to reuse `startOutreach`.
