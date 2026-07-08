# Team Group Chat + @-Mention Orchestration — Design

A group chat per team in the Chats panel where you **`@mention` agents in plain language and they actually do the work** — detecting your intent, routing to a capable teammate (or another team) when the mentioned agent can't do it, and executing the real scrape/research/outreach jobs, with status reported back in the thread.

> Builds on: the Chats store + `sendChat`, the capability catalog (`lib/agentTypes.ts`), team membership (`teammatesOf`/`membersOfTeam`), the job system (`enqueueJob` + runner + Python worker), and Gemini (`geminiJSON`). No new engines — a conversational orchestration layer over what exists.

---

## Part A — Group-chat model

- A **team group chat** is a conversation keyed by **`teamId`** in the existing `chats: Record<convId, ChatMsg[]>` store (alongside per-agent chats keyed by agentId).
- **`ChatMsg.who` widens** from `"ai" | "me"` to **`"me" | string`** — for team threads the speaker's **agentId** is stored in `who`, so the UI can attribute each message to an agent (avatar/name). (`"ai"`/`"me"` stay valid for legacy per-agent threads.) `text` column already stores `who` free-form, so **no schema change** — persistence via the existing `appendMessages(convId, msgs)` with `convId = teamId`.
- The Chats left rail gains a **Teams** section (resolved via `teams`, not `byId`); selecting a team opens its thread.

---

## Part B — Intent + routing brain (`lib/chat/orchestrate.ts`, server-only)

The core action **`teamChat(teamId, message)`** runs per sent message:

1. **Parse mentions (deterministic).** Regex `@Name` tokens → agent ids, matched against the team's members (and the whole roster for cross-team).
2. **Detect intent (one `geminiJSON` call).** Message + the team's agents (names + capabilities) → structured intent:
   ```ts
   { capability: "scrape"|"research"|"outreach"|"follow-up"|"book-meeting"|"chat"|"unknown",
     params: { industry?: string; titles?: string; geo?: string; target?: number },
     summary: string }
   ```
   Scrape params are pulled from the message ("20 fintech CTOs in the US" → `{industry:"Fintech", titles:"CTO", geo:"US", target:20}`). A graceful no-Gemini fallback returns `capability:"chat"`.
3. **Route (deterministic tree).** For capability `C`, mentioned agent `M`, team `T`:
   - `C = chat`/`unknown` → conversational reply, no job.
   - `M` has `C` → **M acts**.
   - `M` lacks `C`, a teammate has `C` → M replies "not my area — @X handles it," **X acts**.
   - nobody on `T`, an agent on another team has `C` → "@Y on *Team Z* can — handing off," **Y acts** (cross-team).
   - nobody has `C` → reply: "no agent can do that yet — create one?"
   - no `@mention` → pick `T`'s agent with `C` (else cross-team, else the message above).
   - **Not-ready capability** (`engineReady:false`: follow-up/book-meeting) → the resolved agent replies "that engine isn't wired up yet," **no job**.
4. **Compose reply messages (templated).** In the acting agent's voice — acknowledgement (`"On it — scraping Fintech CTOs now."`) and, for a hand-off, the mentioned agent's redirect + the actor's pickup. Templated (fast/deterministic); Gemini-generated character replies are a later upgrade. Intent stays the one meaningful Gemini call.

`teamChat` returns `{ messages: { who, text }[], job?: { id, kind } }` — the messages to post + any enqueued job to poll.

---

## Part C — Execution wiring

- **`scrape`** → `enqueueJob({ agent, kind:"scrape", capabilities, target, icp })` carrying the **chat-extracted ICP** in `params.icp`. The **Python worker prefers `params.icp`** over `agent_config.settings.scrape` (falls back to stored settings / goal when the message is vague). Results land in **Leads → Pending** (approval gate, unchanged).
- **`research` / `outreach`** → `enqueueJob(kind)` on the **team's shared book** (existing pool logic via `teammatesOf`). Briefs / drafts, as built. Node runner + `/api/jobs/run`.
- **`follow-up` / `book-meeting`** → reply-only (engine not ready), no enqueue.
- **Kick + poll (reuses existing):** the client (`sendTeamChat`) posts the returned messages, then for research/outreach POSTs `/api/jobs/run` + polls `getJob`; for scrape the worker claims it and the client polls. Each poll appends/updates a **status line** message (speaker = acting agent), ending with a result line ("Found 8 leads — in Leads → Pending" / "Drafted 5 emails" / "Researched 6 leads").

---

## Part D — Chats UI (`app/chats/page.tsx` + a store handler)

- **Left rail — Teams section:** each team (icon + name + member-avatar cluster) above the existing per-agent conversations. Selecting sets `convId = teamId`.
- **Team thread:**
  - **Header:** team icon/name + participant agent avatars, each with a capability hint (so you can see who scrapes/researches/drafts).
  - **Messages, speaker-attributed:** `who = "me"` → right bubble; `who = <agentId>` → left bubble with that agent's avatar/name (via `byId`). **Status lines** render as a muted/system row. `@mentions` in text shown as highlighted chips.
  - **Input with `@`-mention autocomplete:** typing `@` opens a dropdown of the team's agents (name + capability chip), filtered by the partial; arrow/enter or click inserts `@Name`.
- **`sendTeamChat(teamId, text)`** (store, sibling to `sendChat`): append the user message → call `teamChat` action → append agent messages → kick + poll the job → append status/result lines. Persists team messages like agent chats.

---

## File map

| File | Change |
|---|---|
| `lib/types.ts` | widen `ChatMsg.who` to `"me" \| string` |
| `lib/ai/intent.ts` | **new** — `detectIntent(message, teamAgents)` (Gemini structured) + fallback |
| `lib/chat/orchestrate.ts` | **new** — routing tree + templated replies + capability resolution (server-only) |
| `lib/chat/actions.ts` | **new** — `teamChat(teamId, message)` `"use server"` (mentions → intent → route → enqueue) |
| `lib/jobs/actions.ts` | `enqueueJob` carries optional `icp` into scrape `params` |
| `worker/db.py` / `worker/main.py` | prefer `params.icp` over stored `agent_config.settings.scrape` |
| `lib/store.tsx` | `sendTeamChat(teamId, text)` + team convId handling |
| `app/chats/page.tsx` | Teams rail section + team-thread render (speaker attribution + status) + `@`-mention autocomplete |

---

## Verification

No unit-test framework — `npx tsc --noEmit` clean + manual (no migration):

- **Routing:** in a team with a scraper (Sarah) + researcher (Emily): "@Sarah find fintech CTOs" → Sarah acts (scrape enqueued, ICP from message, lands in Pending). "@Sarah research the leads" → Sarah replies "not my area — @Emily," Emily acts (research runs on the book). A capability no member has → cross-team hand-off or "create one?" message.
- **Execution:** the enqueued jobs run through the real pipeline (scrape→Pending, research→briefs, outreach→drafts); status lines update in-thread to the result.
- **Chit-chat** ("how's it going?") → conversational reply, no job.
- **UI:** Teams section in the rail; team thread shows speaker avatars; `@` autocomplete lists the team's agents; messages persist across reload.
- **Fallback:** with no Gemini key, intent → `chat` (a plain reply), nothing crashes.
- `tsc` clean.

## Deferred

- Gemini-generated in-character replies (templated in this slice).
- Multi-capability / multi-step commands in one message ("scrape then draft") — one capability per message here.
- Streaming/typing indicators beyond the status lines.
- @-mentioning a whole team ("@NorthAmericaSDR") — agent mentions only this slice.
