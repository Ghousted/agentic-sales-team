# Agents Narrate the Group Chat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The pod pipeline narrates itself in the team group chat — agents post kickoff/hand-off messages when work moves between them, and approval-gated stages @mention the user with inline Approve/Reject buttons — appearing live via chat polling.

**Architecture:** A server `postTeamMessage` primitive writes into the team's chat (`messages`, keyed by teamId). The pod orchestration (`enqueuePodStage`/`chainNext`) calls it to narrate. Approval messages embed a `⟦approve:<jobId>⟧` marker the chat parses into Approve/Reject buttons. The chats page polls `listTeamMessages` + `listPendingApprovals` every 4s so server-written messages appear live. No schema change, no migration.

**Tech Stack:** Next.js 14 / TypeScript / Drizzle / Neon (existing). Reuses `lib/pod/`, `lib/chat/`, `messages` table, `approveJob`/`rejectJob`/`listPendingApprovals`.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-08-agents-narrate-group-chat-design.md`.
- **Git identity:** commit as the user only — `Ghousted <clydepadua091@gmail.com>`. **Never** a `Co-Authored-By: Claude` / AI-attribution line.
- **No push.** `.env.local` gitignored.
- **No unit-test framework, no migration.** Verification is `npx tsc --noEmit` (from `agentic-salesforce/`) clean + code review + manual.
- **User-scoping:** every DB read/write filters by session `userId`.
- **Deferred:** @mention highlighting; websockets/SSE (polling is fine); per-message read state.

---

## File Structure

- `lib/chat/teamMessages.ts` — CREATE (`server-only`): `postTeamMessage`, `listTeamMessages`, `userFirstName`.
- `lib/chat/actions.ts` — MODIFY: add `"use server"` wrapper `listTeamMessages(teamId)`.
- `lib/pod/orchestrate.ts` — MODIFY: `enqueuePodStage` + `chainNext` post narration/approval messages.
- `app/chats/page.tsx` — MODIFY: poll team messages + approvals; render approval Approve/Reject buttons.

---

## Task 1: Server chat message primitives

**Files:** Create `lib/chat/teamMessages.ts`; Modify `lib/chat/actions.ts`.

**Interfaces:**
- Produces: `postTeamMessage(userId, teamId, speakerAgentId, text): Promise<void>`; `listTeamMessages(userId, teamId): Promise<{who: string; text: string}[]>`; `userFirstName(userId): Promise<string>`; and a `"use server"` `listTeamMessages(teamId)` wrapper.

- [ ] **Step 1: Write `lib/chat/teamMessages.ts`.**

```ts
import "server-only";
// Read/write for a team group-chat thread (messages keyed by teamId) + the user's
// display name for @mentions. Used by the pod orchestration to narrate its work.
import { and, asc, eq } from "drizzle-orm";
import { getDb, isDbConfigured, messages, users } from "@/lib/db";

/** Post a message into a team's chat thread, spoken by an agent (or "system"). */
export async function postTeamMessage(userId: string, teamId: string, speakerAgentId: string, text: string): Promise<void> {
  if (!isDbConfigured()) return;
  await getDb().insert(messages).values({ userId, agentId: teamId, who: speakerAgentId, text });
}

/** The full team thread, oldest first. */
export async function listTeamMessages(userId: string, teamId: string): Promise<{ who: string; text: string }[]> {
  if (!isDbConfigured()) return [];
  const rows = await getDb().select({ who: messages.who, text: messages.text })
    .from(messages).where(and(eq(messages.userId, userId), eq(messages.agentId, teamId))).orderBy(asc(messages.id));
  return rows.map((r) => ({ who: r.who, text: r.text }));
}

/** The user's first name, for @mentions in narration. */
export async function userFirstName(userId: string): Promise<string> {
  if (!isDbConfigured()) return "there";
  const [u] = await getDb().select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
  return (u?.name ?? "there").split(" ")[0];
}
```

- [ ] **Step 2: Add the `"use server"` wrapper.** In `lib/chat/actions.ts`, add:

```ts
import { listTeamMessages as _listTeamMessages } from "./teamMessages";

export async function listTeamMessages(teamId: string): Promise<{ who: string; text: string }[]> {
  const s = await getSession();
  if (!s?.userId) return [];
  return _listTeamMessages(s.userId, teamId);
}
```

(`getSession` is already imported in `actions.ts`; if not, add `import { getSession } from "@/lib/auth/session";`.)

- [ ] **Step 3: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors. (`messages`/`users` are exported from `@/lib/db`.)

- [ ] **Step 4: Commit.**

```bash
git add agentic-salesforce/lib/chat/teamMessages.ts agentic-salesforce/lib/chat/actions.ts
git commit -m "Add team-chat message primitives: postTeamMessage / listTeamMessages / userFirstName"
```

---

## Task 2: Pod orchestration narrates + requests approval

**Files:** Modify `lib/pod/orchestrate.ts`.

**Interfaces:** Consumes `postTeamMessage`/`userFirstName` (Task 1). `enqueuePodStage` posts the acting agent's message (auto: "on it"; ask: @user approval + `⟦approve:jobId⟧`). `chainNext` posts the finishing agent's hand-off.

- [ ] **Step 1: Import the primitives.** In `lib/pod/orchestrate.ts`, add after the existing imports:

```ts
import { postTeamMessage, userFirstName } from "@/lib/chat/teamMessages";
```

- [ ] **Step 2: Narrate in `enqueuePodStage`.** Replace the insert at the end of `enqueuePodStage` (the `await getDb().insert(jobs).values({...});` block) so it captures the new job id and posts a message:

```ts
  const [row] = await getDb().insert(jobs).values({
    userId, agentId, kind: capability,
    status: mode === "ask" ? "needs_approval" : "queued",
    params: {
      agent: { id: info.id, name: info.name, role: info.role, goal: info.goal, task: info.task },
      teamId, pod: true, leadCount, batchSize: POD_BATCH, leadIds: null,
    },
  }).returning({ id: jobs.id });

  const doing = capability === "research" ? "researching the book" : "drafting outreach";
  const verb = capability === "research" ? "research these leads" : "draft outreach";
  if (mode === "ask") {
    const first = await userFirstName(userId);
    await postTeamMessage(userId, teamId, info.id, `@${first} — ${leadCount} lead${leadCount === 1 ? "" : "s"} ready to ${verb}. Approve and I'll start. ⟦approve:${row.id}⟧`);
  } else {
    await postTeamMessage(userId, teamId, info.id, `On it — ${doing} now.`);
  }
```

- [ ] **Step 3: Hand-off narration in `chainNext`.** Replace the body of `chainNext` so the finishing agent posts a hand-off before the next stage is enqueued:

```ts
export async function chainNext(userId: string, teamId: string, completedKind: string): Promise<void> {
  const nextCap = nextStageAfter(completedKind);
  if (!nextCap) return;
  const agentId = await memberWithCapability(userId, teamId, nextCap);
  if (!agentId) return;
  // Narrate the hand-off from the finishing agent to the next.
  const finisherId = await memberWithCapability(userId, teamId, completedKind);
  const [finisher, nextInfo] = await Promise.all([
    finisherId ? agentInfo(userId, finisherId) : Promise.resolve(null),
    agentInfo(userId, agentId),
  ]);
  if (finisher && nextInfo) {
    const done = completedKind === "research" ? "researching the book" : "drafting outreach";
    const nextNoun = nextCap === "research" ? "research" : "outreach";
    await postTeamMessage(userId, teamId, finisher.id, `Done ${done} — @${nextInfo.name.split(" ")[0]}, over to you for ${nextNoun}.`);
  }
  await enqueuePodStage(userId, teamId, nextCap, agentId);
}
```

- [ ] **Step 4: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors. (`agentInfo`/`memberWithCapability`/`nextStageAfter` are already in this file; `POD_BATCH` already imported.)

- [ ] **Step 5: Commit.**

```bash
git add agentic-salesforce/lib/pod/orchestrate.ts
git commit -m "Pod: narrate hand-offs + @mention the user for approvals in the team chat"
```

---

## Task 3: Chat client — live polling + inline approvals

**Files:** Modify `app/chats/page.tsx`.

**Interfaces:** Consumes `listTeamMessages` (Task 1), `listPendingApprovals`/`approveJob`/`rejectJob` (existing pod actions). Polls the active team thread; renders Approve/Reject on approval messages.

- [ ] **Step 1: Imports + state.** In `app/chats/page.tsx`:
  - Change the react import to include `useState`: `import { Suspense, useEffect, useState } from "react";`
  - Add:

```ts
import { listTeamMessages } from "@/lib/chat/actions";
import { listPendingApprovals, approveJob, rejectJob } from "@/lib/pod/actions";
```

  In `ChatsInner`, after the existing hooks (near `const messages = ...`), add:

```ts
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [handled, setHandled] = useState<Set<string>>(new Set());
```

- [ ] **Step 2: Poll the active team thread.** Add this effect in `ChatsInner` (after the fallback `useEffect`):

```ts
  // Live-poll the open team thread so agent-written hand-offs / approvals appear.
  useEffect(() => {
    if (!activeTeam) return;
    const teamId = activeTeam.id;
    let alive = true;
    const tick = async () => {
      try {
        const [msgs, pend] = await Promise.all([listTeamMessages(teamId), listPendingApprovals(teamId)]);
        if (!alive) return;
        set((prev) => {
          const local = prev.chats[teamId] || [];
          return msgs.length >= local.length ? { chats: { ...prev.chats, [teamId]: msgs } } : prev;
        });
        setPendingIds(new Set(pend.map((p) => p.id)));
      } catch { /* transient — try again next tick */ }
    };
    tick();
    const iv = setInterval(tick, 4000);
    return () => { alive = false; clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTeam?.id, set]);
```

- [ ] **Step 3: Approval parsing + handlers.** Add near the top of `ChatsInner` (after the state):

```ts
  const APPROVE_RE = /⟦approve:([0-9a-f-]{36})⟧/;
  const onApprove = async (jobId: string) => {
    setHandled((h) => new Set(h).add(jobId));
    await approveJob(jobId);
    try { await fetch("/api/jobs/run", { method: "POST" }); } catch { /* best-effort */ }
  };
  const onReject = async (jobId: string) => {
    setHandled((h) => new Set(h).add(jobId));
    await rejectJob(jobId);
  };
```

- [ ] **Step 4: Render — strip the marker + show buttons.** Replace the `messages.map(...)` block (the team/agent message renderer) with a version that cleans the marker and adds Approve/Reject when the job is still pending:

```tsx
          {messages.map((m, i) => {
            const mine = m.who === "me";
            const speaker = !mine && activeTeam ? byId(m.who) : null;
            const am = m.text.match(APPROVE_RE);
            const clean = am ? m.text.replace(APPROVE_RE, "").trim() : m.text;
            const showApprove = !!am && pendingIds.has(am[1]) && !handled.has(am[1]);
            return (
              <div key={i} style={css("display:flex;gap:8px;justify-content:" + (mine ? "flex-end" : "flex-start"))}>
                {speaker && <div style={css(av(speaker, 26) + ";flex:none;margin-top:2px")}>{speaker.initials}</div>}
                <div style={css("display:flex;flex-direction:column;max-width:62%;gap:2px")}>
                  {speaker && <div style={css("font-size:10.5px;font-weight:600;color:#71717A;padding-left:4px")}>{speaker.name.split(" ")[0]}</div>}
                  <div style={css((mine ? "background:#5122C1;color:#fff;border-radius:16px 16px 4px 16px;" : "background:#fff;color:#3F3F46;border:1px solid #ECECF1;border-radius:16px 16px 16px 4px;") + "padding:11px 15px;font-size:13px;line-height:1.55;animation:fadeUp .25s ease")}>{clean}</div>
                  {showApprove && (
                    <div style={css("display:flex;gap:8px;margin-top:6px;padding-left:2px")}>
                      <Btn onClick={() => onApprove(am![1])} style="background:#E7F7EC;color:#1B7A3D;border:none;border-radius:99px;padding:6px 16px;font-size:12px;font-weight:600;cursor:pointer" styleHover="background:#D6EFDD">Approve</Btn>
                      <Btn onClick={() => onReject(am![1])} style="background:#F4F4F5;color:#71717A;border:none;border-radius:99px;padding:6px 16px;font-size:12px;font-weight:600;cursor:pointer" styleHover="background:#E4E4E7">Reject</Btn>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
```

- [ ] **Step 5: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors. (`Btn`/`av`/`css`/`byId`/`set` already in scope.)

- [ ] **Step 6: Manual check.** With `pnpm dev`: open a team chat; run the book (auto mode) → the researcher's "On it", then a hand-off + the outreach agent's "On it" appear **live** (no refresh). Set a capability to "Ask" (agent detail → Autonomy) → the stage posts an `@you` approval with **Approve/Reject**; Approve runs it (buttons vanish), Reject dismisses it. Reload → narrated messages persist; handled approvals show no buttons.

- [ ] **Step 7: Commit.**

```bash
git add "agentic-salesforce/app/chats/page.tsx"
git commit -m "Chat: live-poll team thread + inline Approve/Reject on approval messages"
```

---

## Self-Review

**Spec coverage:**
- Part A (server posts into the chat) → Task 1 (`postTeamMessage`/`userFirstName`) + Task 2 (wired into `enqueuePodStage`/`chainNext`). Part B (inline approvals via `⟦approve:jobId⟧` marker) → Task 2 (marker in the ask message) + Task 3 (parse → Approve/Reject → `approveJob`/`rejectJob` + `/api/jobs/run`, stale-guard via `listPendingApprovals`). Part C (live polling, @mention by name) → Task 1 (`listTeamMessages`, `userFirstName`) + Task 3 (poll). No schema change.

**Placeholder scan:** every step has complete code or an exact edit target. The `enqueuePodStage`/`chainNext` replacements are given in full.

**Type consistency:** `postTeamMessage(userId, teamId, speakerAgentId, text)` (T1) is called with those args in T2. `listTeamMessages(teamId)` action (T1) returns `{who,text}[]`, consumed by the poll (T3) and assigned into `chats[teamId]` (`ChatMsg[]` = `{who:"me"|string, text}` — `who` is a string, compatible). The `⟦approve:<jobId>⟧` marker written in T2 matches the `APPROVE_RE` in T3. `pendingIds` (T3) is populated from `listPendingApprovals(teamId).map(p=>p.id)` (existing `ApprovalDTO.id`). `enqueuePodStage`'s `.returning({id: jobs.id})` (T2) supplies `row.id` for the marker. Speaker `who = agentId` messages render with `byId(m.who)` (T3), consistent with the existing team-thread renderer.
