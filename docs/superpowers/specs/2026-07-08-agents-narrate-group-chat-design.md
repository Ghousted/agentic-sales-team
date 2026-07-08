# Agents Narrate the Group Chat — Hand-offs + Inline Approvals

Make the team's orchestration **visible and interactive in the team group chat**: agents post when they hand a task off to one another, and when a stage needs the user's approval they **@mention the user** in the thread with inline **Approve / Reject** buttons. Turns the silent pod pipeline into a narrated, actionable conversation.

> Builds on the existing pod orchestration (`lib/pod/`), the team group chat (`lib/chat/`, `app/chats/page.tsx`, `messages` table), and approvals (`workTheBook`/`enqueuePodStage`/`approveJob`/`rejectJob`). No new engines — it surfaces what already happens.

---

## Today (the gap)

- Pod auto-hand-off (`chainNext`) enqueues the next stage **silently** — nothing appears in the chat.
- Approval-gated stages (`enqueuePodStage` in "Ask" mode → `needs_approval`) surface **only** on the team detail page's approvals panel — not in the chat, and the user isn't notified there.
- Team-chat messages are only ever written by a user-triggered `teamChat` call; the **autonomous** pod flow never posts.

## Goal

The team chat becomes the place where the team narrates its work and asks permission:
- **Hand-off:** *Emily:* "Done researching 6 leads — @Michael, over to you for outreach." → *Michael:* "On it."
- **Approval:** *Emily:* "@Clyde — 20 leads ready to research. Approve and I'll start." with **[Approve] [Reject]** buttons inline.
- **Kickoff / completion:** short lines so the thread reads like the team working.

---

## Part A — Server posts into the team chat

- **`postTeamMessage(userId, teamId, speakerAgentId, text)`** (server-only): inserts a row into `messages` for the team conversation (`agentId = teamId`, `who = speakerAgentId`, `text`). This is the single primitive the orchestration uses to "speak."
- Wire it into `lib/pod/`:
  - **`workTheBook`** — on start, the first stage's agent posts a kickoff ("Starting on the book — I'll research first.").
  - **`enqueuePodStage`** — when it enqueues a stage:
    - **Auto mode** → the acting agent posts "On it — {researching / drafting outreach for} the book…".
    - **Ask mode** (`needs_approval`) → the acting agent posts an **approval request that @mentions the user** by name, carrying the job id (Part B).
  - **`chainNext`** — when a completed stage chains to the next, the **finishing agent posts a hand-off** ("Done {stage} ({N} leads) — @{NextAgent}, over to you for {nextStage}."), and the next stage's post (auto "on it" or ask approval) follows from `enqueuePodStage`.
- The user's display name for @mentions comes from `users.name` (looked up in the helper).

## Part B — Inline approvals

- An approval request is a normal chat message whose text carries a **marker** the client understands: e.g. `⟦approve:<jobId>⟧` appended to the text (stripped before display). No schema change — `messages.text` is free-form.
- In `app/chats/page.tsx`, when a team message contains `⟦approve:<jobId>⟧`, render the text plus **[Approve] [Reject]** buttons:
  - **Approve** → `approveJob(jobId)` (`needs_approval → queued`) then POST `/api/jobs/run` so the stage runs; the agent posts "Thanks — starting now."
  - **Reject** → `rejectJob(jobId)` (`→ dismissed`); the agent posts "No problem — holding off."
- **Stale-button guard:** buttons show only while the job is still `needs_approval`. The chat cross-checks the team's live pending approvals (`listPendingApprovals(teamId)`); once a job is approved/rejected/handled, its buttons are hidden (and hidden optimistically on click).

## Part C — Live chat (polling)

- The team chat **polls the team conversation for new messages** while open (every ~4s) via a new `listTeamMessages(teamId)` action, merging any messages not already shown. This is what makes server-written hand-off/approval/kickoff messages appear **live** (the pod runs server-side during `/api/jobs/run`; without polling the user would only see them on refresh).
- Messages remain speaker-attributed (Part-A `who = agentId`); `@mentions` in text render as-is (highlighting still deferred).

---

## File map

| File | Change |
|---|---|
| `lib/chat/teamMessages.ts` (or `lib/chat/orchestrate.ts`) | **new** `postTeamMessage` (server-only insert) + `listTeamMessages(teamId)` |
| `lib/chat/actions.ts` | `"use server"` wrappers: `listTeamMessages` |
| `lib/pod/orchestrate.ts` | post kickoff / hand-off / auto-start / approval messages (uses `postTeamMessage`; approval carries the `⟦approve:jobId⟧` marker + @user) |
| `lib/pod/actions.ts` | `workTheBook` posts kickoff; keep `approveJob`/`rejectJob` (called from chat) |
| `app/chats/page.tsx` | poll `listTeamMessages`; parse the approval marker → Approve/Reject buttons wired to `approveJob`/`rejectJob` + `/api/jobs/run`; stale-button guard via `listPendingApprovals` |
| `lib/store.tsx` | (if needed) team-chat message polling merge; expose approve/reject helpers |

---

## Verification

No unit-test framework — `npx tsc --noEmit` clean + manual (no migration):

- **Hand-off narration:** run a team's book (auto mode) from the chat/team page → the chat shows the researcher's kickoff, a completion + hand-off to the outreach agent, and the outreach agent's start — appearing **live** (no refresh).
- **Approval @mention:** set a capability to "Ask" → the stage posts an @{user} approval request with **Approve/Reject** in the chat → **Approve** runs the stage (and the agent confirms); **Reject** dismisses it; buttons disappear after either.
- **Live:** messages written by the server pod flow appear in the open thread within a few seconds without reload; no duplicate messages on re-poll.
- **Persistence:** the narrated messages persist (reload shows them); approval buttons don't reappear for already-handled jobs.
- `tsc` clean.

## Deferred

- `@mention` highlighting/chips in message text.
- Real-time transport (websockets/SSE) — polling is fine for now.
- Narration for the non-pod, single-command chat path already posts hand-offs (via `resolve`); this spec adds the **autonomous pod** narration + approvals.
- Per-message read state / notifications badge for chat mentions.
