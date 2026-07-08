# `/lead` picker + "ask who" for outreach in team chat

**Date:** 2026-07-09
**Status:** Approved (design)

## Problem

In the team group chat, asking an agent to "outreach a lead" enqueues an outreach
job with **no lead selection**. The runner (`pickLeadsForRun`) then drafts for
*all accepted, undrafted* leads. Two failures result:

1. **Silent "Drafted 0 emails."** Scraped leads land as `review: "pending"`
   (the approval gate). Outreach only ever touches `review: "accepted"` leads, so
   if nothing has been approved yet, outreach drafts nothing — with no explanation.
2. **No way to say WHO.** There is no targeting step anywhere in the chat path;
   outreach always blasts the whole accepted book.

The user wants: (a) outreach to genuinely have access to their leads, and (b) when
they ask for outreach, the agent should **ask who** — via a `/lead` command in the
composer that lets them pick specific leads.

## Goals

- A `/lead` command in the team-chat composer that opens a picker of the team's
  leads (pending **and** accepted) and lets the user select one or more.
- Picking a **pending** lead **approves it on send** ("picking = approving"), so
  the picker is never uselessly empty and the 0-emails trap disappears.
- When outreach is requested with **no** pick and no "all", the agent **asks who**
  instead of silently drafting.
- No silent "Drafted 0 emails" ever again.

## Non-goals

- No change to the agent-detail-page **"Run outreach"** button. It stays a
  "run for the whole accepted book" action.
- No change to the **Leads → Pending** review screen. Picking in chat is simply a
  faster second path to approve+act on specific leads.
- The "ask who" prompt is **outreach-only**. Research / qualify / proposal keep
  their existing batch-all defaults (they may still *receive* `/lead` picks, see
  below, but they never block asking "who").

## Architecture

Four localized changes on top of patterns that already exist (the `@mention`
autocomplete popover, the `leadIds` job plumbing, the `review` accept-gate). No
job-runner changes.

### 1. Client — `/lead` picker in the composer (`app/chats/page.tsx`, `lib/store.tsx`)

Mirrors the existing `@mention` popover (`app/chats/page.tsx` ~L175–191).

- **New client state:** `chatLeadPicks: { id: string; name: string }[]` on the app
  store, initialized `[]`, cleared on send. (Add to the state interface, initial
  state, and the `set` reducer — same shape treatment as `chatInput`.)
- **Team leads data:** fetched via a new server action `listTeamLeads(teamId)`
  into local component state when a team conversation is active — loaded the same
  way `teamMembers` is derived / the thread is polled. Shape per lead:
  `{ id, name, title, company, platform, review }`.
- **Trigger:** when `s.chatInput` matches `/\/lead([^\s]*)$/` (in a team chat),
  render a popover (same styling as the mention popover) listing team leads whose
  name/title/company contains the trailing partial, capped at ~6. Each row:
  name · title-or-company · platform, plus a small `pending` / `accepted` badge.
- **On pick:** append `{ id, name }` to `chatLeadPicks` (dedupe by id); strip the
  `/lead…` token from `chatInput` (`replace(/\/lead[^\s]*$/, "")`).
- **Chip row:** above the input, render `chatLeadPicks` as removable chips
  (`To: [Maria S. ✕] [Juan D. ✕]`), `✕` removes that id.
- **Send** (Enter and Send button): call
  `sendTeamChat(activeTeam.id, s.chatInput, chatLeadPicks.map(p => p.id))`;
  then clear `chatLeadPicks`.
- **Placeholder:** `Message the team — @mention an agent, /lead to pick leads…`
- **Enter handling:** the existing mention-completion branch on Enter is preserved;
  the new `/lead` popover does not complete on Enter (selection is by click), so a
  bare Enter with `/lead…` still sends. (Acceptable; matches how a half-typed
  mention sends today when there is no match.)

### 2. Store — thread the picked ids (`lib/store.tsx`)

- `sendTeamChat(teamId: string, text: string, leadIds?: string[])`. Forward
  `leadIds` to `teamChat(teamId, t, leadIds)`. Everything else in `sendTeamChat`
  (optimistic user message, typing indicator, job polling, the outreach
  done-message that reads `draftsCreated`) is unchanged.
- Update the `sendTeamChat` type in the store context interface.

### 3. Server — the "ask who" gate (`lib/chat/actions.ts`)

`teamChat(teamId, message, leadIds?)`. After `resolve(...)` returns
`{ messages, actor, capability }`:

- If `res.capability === "outreach"`, compute the **target**:
  - **Picks present** (`leadIds?.length`): `acceptLeads(userId, leadIds)` to flip any
    pending picks to accepted, then enqueue outreach with `leadIds`.
  - **No picks, message matches "all"** (`/\b(all|everyone|every( |-)?(lead|one))\b/i`):
    look up the team's accepted leads. If ≥1 → enqueue outreach with **no**
    `leadIds` (existing "all accepted, undrafted" path, which correctly skips
    already-drafted leads). If **0** accepted → fall through to *ask who*.
  - **Otherwise (vague):** do **not** enqueue. Replace the reply with the actor
    asking who:
    `"<First> here — who should I write to? Type /lead to pick some leads, or say 'outreach all' to write to everyone in your book."`
- For **non-outreach** lead-consuming capabilities (research / qualify / proposal):
  pass `leadIds` through to `enqueueJob` when present, but never gate/ask — keep the
  current batch-all behavior.
- For **scrape**: unchanged (the raw message is the instruction; `leadIds` ignored).

The gate lives in `teamChat`, not `resolve`, because `resolve` has already composed
the "On it — drafting outreach 🔍" line; when the gate decides to ask instead,
`teamChat` returns the ask message and **no** `job`.

### 4. Server — team leads for the picker + accept helper (`lib/leads/store.ts`, `lib/leads/actions.ts`)

- `lib/leads/store.ts`:
  - `listTeamLeadsForPicker(userId, teamId)`: `membersOfTeam(userId, teamId)` →
    agent ids; select leads where `userId`, `agentId ∈ members`,
    `review ∈ ('pending','accepted')`, newest first; map to
    `{ id, name, title, company, platform, review }`.
  - `acceptLeads(userId, ids)`: user-scoped
    `update(leads).set({ review: 'accepted', updatedAt })` where
    `userId` and `id ∈ ids`. (A user-scoped sibling of the existing
    session-scoped `setLeadReview`, so `teamChat` can call it with the `userId`
    it already has.)
- `lib/leads/actions.ts`: `use server` wrapper
  `listTeamLeads(teamId): Promise<TeamLeadPick[]>` → `listTeamLeadsForPicker(uid, teamId)`.

## Data flow (happy path)

```
User types "@Outreach follow up" then "/lead" → picks Maria (pending) + Juan (accepted)
  → chips: To: [Maria S. ✕] [Juan D. ✕]
Send → sendTeamChat(teamId, "@Outreach follow up", [maria, juan])
  → teamChat(teamId, msg, [maria, juan])
    → resolve → actor=Outreach, capability=outreach, "On it — drafting outreach 🔍"
    → acceptLeads(userId, [maria, juan])   // Maria pending→accepted, Juan no-op
    → enqueueJob({ kind: "outreach", leadIds: [maria, juan], agent, ... })
  → POST /api/jobs/run → pickLeadsForRun(userId, actor, [maria, juan], batch)
      (both now review='accepted' → both returned) → draftOutreach ×2
  → poll getJob → "Drafted 2 emails — in the Emails tab."
```

## Edge cases

- **Picked lead outside the acting agent's book:** the picker is team-scoped and
  the actor is a team member, so `teammatesOf(actor) ⊇ team` and
  `pickLeadsForRun`'s `agentId ∈ mates` filter keeps every pick. No orphan drops.
- **"outreach all" with zero accepted leads:** falls through to *ask who* — no
  silent 0.
- **Re-picking an already-drafted lead:** the `leadIds` path in `pickLeadsForRun`
  does not skip drafted leads, so an explicit re-pick drafts a fresh email. This is
  intended (the user explicitly chose them).
- **Picked lead was `dismissed`:** `acceptLeads` will resurrect it to `accepted`.
  Acceptable — an explicit pick is a stronger signal than a past dismissal.
- **Non-team (single-agent) chat:** `/lead` and the gate apply only when
  `activeTeam` is set (same guard the mention popover uses). Single-agent chats are
  unchanged.

## Testing

- **tsc** clean (`npx tsc --noEmit`).
- **Server unit-ish (scratchpad .mjs against the real DB is not required):** verify
  by reading the code paths — `acceptLeads` flips only the given ids; the gate
  returns no `job` for the vague case, a `job` with `leadIds` for the pick case, a
  `job` without `leadIds` for the "all"+accepted case, and the ask for
  "all"+zero-accepted.
- **Manual, in-app (primary):**
  1. Scrape a few leads (they land Pending). In a team chat, `@Outreach` + `/lead`
     → picker shows them badged `pending`. Pick two, send → thread shows
     "Drafted 2 emails", Emails tab has 2 drafts, and those two leads are now
     `accepted` in Leads.
  2. `@Outreach outreach a lead` (no pick) → agent replies asking who (no draft).
  3. `@Outreach outreach all` with ≥1 accepted → drafts for the accepted book.
  4. `@Outreach outreach all` with 0 accepted → agent asks who.

## Files touched

- `app/chats/page.tsx` — `/lead` popover, chip row, send wiring, placeholder.
- `lib/store.tsx` — `chatLeadPicks` state, `sendTeamChat(…, leadIds?)`.
- `lib/chat/actions.ts` — `teamChat(…, leadIds?)` + outreach gate.
- `lib/leads/store.ts` — `listTeamLeadsForPicker`, `acceptLeads`.
- `lib/leads/actions.ts` — `listTeamLeads` server action.
