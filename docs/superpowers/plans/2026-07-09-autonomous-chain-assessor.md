# Autonomous agent chain + Assessor gate — Implementation Plan (inline)

**Goal:** A team-chat scrape kicks off a chain where each agent finishes and @mentions the next — scrape → assess → match → outreach → you (send). An **Assessor** agent auto-accepts fitting scraped leads (the automatic approval gate). "Ask"-mode agents still pause for your Approve/Reject. The chat thread is the ledger. No "Work the book" button.

**Architecture:** Reuses the pod pipeline (`enqueuePodStage`/`chainNext`/approval-mode). Extends `POD_ORDER` to the full funnel, makes `chainNext` skip stages a team lacks and end by @mentioning the user, adds an `assess` capability/engine, and triggers `chainNext` from a chat-initiated scrape. No new table.

## Global Constraints
- No test runner/lint. Verify: `npx tsc --noEmit` (+ scratchpad live-Gemini check for the assess engine). No migration (assess only flips `leads.review`).
- Commits: Ghousted, no trailer, no push. Branch `feat/sales-capabilities`.

## Tasks
1. **Capability/type/intent/result** — `agentTypes` (`assess` cap + `assessor` type), `ai/intent` (assess), `leads/types` (`AssessResult { accept, reason, score }`).
2. **Engine + store** — `ai/assess.ts` (`assessLead` → accept/dismiss+reason vs `agent.goal`); `leads/store` (`pickLeadsForAssess` = pending teammate leads; `applyAssessResult` = set review accepted/dismissed + activity).
3. **Pod chain + runner** — `pod/types` `POD_ORDER = [scrape, assess, research, qualify, match, outreach, proposal]`; `pod/orchestrate` generic `countPending`/`enqueuePodStage`/label maps + `nextCoverableStage` (skip missing; scrape→assess special-case; else→final user @mention) + `chainNext(…, count)`; `jobs/run` assess branch + fire `chainNext` for every `params.pod` kind (pass the stage count).
4. **Scrape triggers chain** — `jobs/actions.enqueueJob` gains `pod?/teamId?`; `chat/actions.teamChat` marks team-chat scrapes `pod:true, teamId` (both fresh + pending-clarify enqueues); `api/scrape` calls `chainNext(userId, teamId, "scrape", leadsFound)` after leads are added; `store.sendTeamChat` POSTs `/api/jobs/run` after a scrape so the chained stages run (thread poll surfaces the ledger).
5. **Remove "Work the book" button** — `app/teams/[id]/page.tsx` (keep the approvals list).

## Chain rules
- After **scrape**: if team has an Assessor → hand to it; else @mention the user to review Leads → Pending (stop — downstream needs accepted leads).
- After **assess/research/qualify/match/outreach/proposal**: hand to the next covered stage; if none → @mention the user with the final action (outreach→"review and send from your inbox").
- Each hand-off is one thread message: `"I've {done N}. @{Next} — over to you for {noun}."`; approval-gated ("Ask") stages post the `⟦approve⟧` message and wait.
