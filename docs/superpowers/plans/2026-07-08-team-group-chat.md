# Team Group Chat + @-Mention Orchestration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-team group chat in the Chats panel where you `@mention` agents in plain language; a Gemini intent engine + deterministic capability router picks the right agent (teammate or cross-team), the acting agent replies in-thread and **executes the real scrape/research/outreach job**, with status reported back.

**Architecture:** `teamChat(teamId, message)` server action = parse mentions → detect intent (Gemini) → route by capability → enqueue the real job. The client (`sendTeamChat`) posts the messages, kicks `/api/jobs/run` (research/outreach) or lets the Python worker claim it (scrape), and polls for status. No new engines.

**Tech Stack:** Next.js 14 App Router / TypeScript / Drizzle / Neon / Gemini `geminiJSON` / the Python worker (existing).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-08-team-group-chat-design.md`.
- **Git identity:** commit as the user only — `Ghousted <clydepadua091@gmail.com>`. **Never** a `Co-Authored-By: Claude` / AI-attribution line.
- **No push.** `.env.local` gitignored.
- **No unit-test framework, no migration.** Verification is `npx tsc --noEmit` (from `agentic-salesforce/`) clean + code review + manual. (`worker/main.py` verified by `python -c "import main"` if the venv is active.)
- **User-scoping:** every DB read/write filters by session `userId`.
- **Reuse:** `membersOfTeam`/`teammatesOf` (`lib/teams/membership.ts`), `agentInfo` (`lib/pod/orchestrate.ts`), `enqueueJob`/`getJob` (`lib/jobs/actions.ts`), `geminiJSON` (`lib/ai/gemini.ts`), `CAPABILITIES` (`lib/agentTypes.ts`). Capability id === `jobs.kind`; `engineReady` gates execution.
- **Deferred:** Gemini character-replies (templated here); multi-capability per message; @mentioning a whole team; streaming beyond status lines.

---

## File Structure

- `lib/types.ts` — MODIFY: `ChatMsg.who: "me" | string`.
- `lib/ai/intent.ts` — CREATE: `detectIntent` (Gemini structured) + `Intent` type + fallback.
- `lib/chat/orchestrate.ts` — CREATE: routing tree + templated replies + capability resolution (server-only).
- `lib/chat/actions.ts` — CREATE: `teamChat(teamId, message)` `"use server"`.
- `lib/jobs/actions.ts` — MODIFY: `enqueueJob` carries optional `icp`.
- `worker/main.py` — MODIFY: prefer `params.icp` over stored scrape settings.
- `lib/store.tsx` — MODIFY: `sendTeamChat(teamId, text)` + expose it.
- `app/chats/page.tsx` — MODIFY: Teams rail + team-thread render + `@`-mention autocomplete.

---

## Task 1: Types + intent engine

**Files:** Modify `lib/types.ts`; Create `lib/ai/intent.ts`.

**Interfaces:** `ChatMsg.who: "me" | string`; `Intent` + `detectIntent(message, agents): Promise<Intent>`.

- [ ] **Step 1: Widen `ChatMsg.who`.** In `lib/types.ts`, change:

```ts
export interface ChatMsg {
  who: "me" | string;
  text: string;
}
```

(Keep the `text` field as-is. `"ai"`/`"me"`/agentId all satisfy `"me" | string`.)

- [ ] **Step 2: Write `lib/ai/intent.ts`.**

```ts
import "server-only";
// Natural-language intent detection for the team group chat: a message → the
// capability the user wants + any scrape params. One Gemini JSON call.
import { geminiJSON, isGeminiConfigured, type Turn } from "./gemini";

export interface Intent {
  capability: "scrape" | "research" | "outreach" | "follow-up" | "book-meeting" | "chat" | "unknown";
  params: { industry?: string; titles?: string; geo?: string; target?: number };
  summary: string;
}

const SCHEMA = {
  type: "object",
  properties: {
    capability: { type: "string", enum: ["scrape", "research", "outreach", "follow-up", "book-meeting", "chat", "unknown"] },
    params: {
      type: "object",
      properties: { industry: { type: "string" }, titles: { type: "string" }, geo: { type: "string" }, target: { type: "integer" } },
    },
    summary: { type: "string" },
  },
  required: ["capability", "params", "summary"],
} as const;

function systemPrompt(agents: { name: string; capabilities: string[] }[]): string {
  const roster = agents.map((a) => `- ${a.name}: ${a.capabilities.join(", ") || "(no capabilities)"}`).join("\n");
  return [
    "You route messages in a B2B sales team chat. Given a user's message, decide which single capability they want done:",
    "- scrape: find/import new prospects/leads matching a description (an ICP).",
    "- research: enrich existing leads with a research brief.",
    "- outreach: draft/write emails or messages to leads.",
    "- follow-up: re-engage cold/non-replying leads.",
    "- book-meeting: propose times / book meetings.",
    "- chat: small talk, questions, status — no action.",
    "- unknown: a task request that fits none of the above.",
    "For a scrape request, extract params from the message: industry, titles (job titles), geo (geography), target (how many, integer).",
    "Return a short `summary` restating the ask in a few words.",
    "The team's agents and their capabilities (for context only — you pick the capability, not the agent):",
    roster,
    "Return ONLY JSON matching the schema.",
  ].join("\n");
}

export async function detectIntent(message: string, agents: { name: string; capabilities: string[] }[]): Promise<Intent> {
  if (!isGeminiConfigured()) return { capability: "chat", params: {}, summary: message.slice(0, 60) };
  const turns: Turn[] = [{ role: "user", text: message }];
  try {
    const r = await geminiJSON<Intent>(systemPrompt(agents), turns, SCHEMA as unknown as Record<string, unknown>, { maxTokens: 400, temperature: 0.2 });
    return {
      capability: r.capability ?? "unknown",
      params: r.params ?? {},
      summary: (r.summary ?? message.slice(0, 60)).trim(),
    };
  } catch {
    return { capability: "chat", params: {}, summary: message.slice(0, 60) };
  }
}
```

- [ ] **Step 3: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors.

- [ ] **Step 4: Commit.**

```bash
git add agentic-salesforce/lib/types.ts agentic-salesforce/lib/ai/intent.ts
git commit -m "Widen ChatMsg.who to speaker id; add detectIntent (Gemini) for team chat"
```

---

## Task 2: enqueueJob ICP + worker ICP preference

**Files:** Modify `lib/jobs/actions.ts`, `worker/main.py`.

**Interfaces:** `enqueueJob` accepts optional `icp` (→ `params.icp`); the worker prefers `params.icp` over stored settings.

- [ ] **Step 1: Add `icp` to `enqueueJob`.** In `lib/jobs/actions.ts`, change the signature + params:

```ts
export async function enqueueJob(input: { agent: AgentSnapshot; kind: string; capabilities?: string[]; leadIds?: string[]; batchSize?: number; target?: number; icp?: { industry?: string; titles?: string; geo?: string } }): Promise<{ jobId: string } | { error: string }> {
  if (!isDbConfigured()) return { error: "Server not configured." };
  const userId = await uid();
  if (!userId) return { error: "Not signed in." };
  if (input.capabilities && !input.capabilities.includes(input.kind)) {
    return { error: "This agent can't run " + input.kind + "." };
  }
  const [row] = await getDb().insert(jobs).values({
    userId, agentId: input.agent.id, kind: input.kind, status: "queued",
    params: { agent: input.agent, leadIds: input.leadIds ?? null, batchSize: input.batchSize ?? 5, target: input.target ?? 10, icp: input.icp ?? null },
  }).returning({ id: jobs.id });
  return { jobId: row.id };
}
```

- [ ] **Step 2: Worker prefers chat ICP.** In `worker/main.py` `run_job`, change the settings line (line ~40):

```python
    icp = params.get("icp")
    settings = icp if (icp and any(icp.values())) else db.get_scrape_settings(conn, user_id, agent_id)
```

(The rest of `run_job` is unchanged — `build_task(settings, agent, target)` consumes the same `{industry,titles,geo}` dict shape.)

- [ ] **Step 3: Type-check + worker import.** `cd agentic-salesforce && npx tsc --noEmit` → clean. If the worker venv is available: `cd agentic-salesforce/worker && source .venv/bin/activate && python -c "import main; print('worker import OK')"`.

- [ ] **Step 4: Commit.**

```bash
git add agentic-salesforce/lib/jobs/actions.ts agentic-salesforce/worker/main.py
git commit -m "enqueueJob carries chat-supplied ICP; worker prefers params.icp for scrape"
```

---

## Task 3: Orchestration + `teamChat` action

**Files:** Create `lib/chat/orchestrate.ts`, `lib/chat/actions.ts`.

**Interfaces:** Consumes `detectIntent` (T1), `membersOfTeam`/`agentInfo`, `enqueueJob` (T2), `CAPABILITIES`. Produces `teamChat(teamId, message): Promise<TeamChatResult>`.

- [ ] **Step 1: Write `lib/chat/orchestrate.ts`.**

```ts
import "server-only";
// Team-chat orchestration: mentions → intent → capability routing → templated
// replies. Server-only. Pairs with lib/chat/actions.ts (which enqueues jobs).
import { and, eq } from "drizzle-orm";
import { getDb, isDbConfigured, agents, teams as teamsTable } from "@/lib/db";
import { AGENTS_BASE, TEAMS_BASE } from "@/lib/data";
import { membersOfTeam } from "@/lib/teams/membership";
import { agentInfo } from "@/lib/pod/orchestrate";
import { CAPABILITIES } from "@/lib/agentTypes";
import type { Intent } from "@/lib/ai/intent";

export interface ChatOutMsg { who: string; text: string } // who = speaker agentId
export interface Resolution {
  messages: ChatOutMsg[];
  actor?: { id: string; name: string; role: string; goal: string; task: string; capabilities: string[] };
  capability?: string;
}

const engineReady = (cap: string) => CAPABILITIES.find((c) => c.id === cap)?.engineReady ?? false;

/** Resolve @Name mentions in the message to agent ids among the given roster. */
export function parseMentions(message: string, roster: { id: string; name: string }[]): string[] {
  const tokens = (message.match(/@([\w'-]+)/g) ?? []).map((t) => t.slice(1).toLowerCase());
  const ids: string[] = [];
  for (const tok of tokens) {
    const hit = roster.find((a) => a.name.toLowerCase().split(" ")[0] === tok || a.name.toLowerCase().replace(/\s+/g, "") === tok);
    if (hit && !ids.includes(hit.id)) ids.push(hit.id);
  }
  return ids;
}

/** All the user's agents (seed + created), for cross-team routing. */
async function allAgents(userId: string): Promise<{ id: string; name: string; capabilities: string[] }[]> {
  const seed = AGENTS_BASE.map((a) => ({ id: a.id, name: a.name, capabilities: a.capabilities }));
  if (!isDbConfigured()) return seed;
  const rows = await getDb().select().from(agents).where(eq(agents.userId, userId));
  const created = rows.map((r) => ({ id: r.id, name: r.name, capabilities: r.capabilities }));
  const seen = new Set(created.map((a) => a.id));
  return created.concat(seed.filter((a) => !seen.has(a.id)));
}

async function teamName(userId: string, teamId: string): Promise<string> {
  const seed = TEAMS_BASE.find((t) => t.id === teamId);
  if (seed) return seed.name;
  if (!isDbConfigured()) return "the team";
  const [row] = await getDb().select().from(teamsTable).where(and(eq(teamsTable.userId, userId), eq(teamsTable.id, teamId))).limit(1);
  return row?.name ?? "the team";
}

/** Decide who acts + the reply messages, given the detected intent. */
export async function resolve(userId: string, teamId: string, message: string, intent: Intent): Promise<Resolution> {
  const memberIds = await membersOfTeam(userId, teamId);
  const members = (await Promise.all(memberIds.map((id) => agentInfo(userId, id)))).filter(Boolean) as NonNullable<Awaited<ReturnType<typeof agentInfo>>>[];
  const cap = intent.capability;

  if (cap === "chat" || cap === "unknown") {
    const responder = members[0];
    return { messages: [{ who: responder?.id ?? "system", text: responder ? `${responder.name.split(" ")[0]} here — I can help the team scrape, research, or draft. What do you need?` : "No agents on this team yet." }] };
  }

  const mentions = parseMentions(message, members);
  const mentioned = mentions.length ? members.find((m) => m.id === mentions[0]) : undefined;

  const capLabel = CAPABILITIES.find((c) => c.id === cap)?.label ?? cap;
  const first = (n: string) => n.split(" ")[0];

  // A capable actor: mentioned-if-able, else a teammate, else cross-team.
  if (mentioned && mentioned.capabilities.includes(cap)) {
    return actWith(mentioned, cap, intent);
  }
  const teammate = members.find((m) => m.capabilities.includes(cap));
  if (mentioned && teammate) {
    // mentioned can't; a teammate can → hand off
    const res = actWith(teammate, cap, intent);
    res.messages.unshift({ who: mentioned.id, text: `That's not my area — @${first(teammate.name)} handles ${capLabel.toLowerCase()}. ${first(teammate.name)}, can you take this?` });
    return res;
  }
  if (teammate) {
    return actWith(teammate, cap, intent);
  }
  // nobody on this team — look across the user's other teams
  const roster = await allAgents(userId);
  const outsider = roster.find((a) => a.capabilities.includes(cap) && !members.some((m) => m.id === a.id));
  if (outsider) {
    const info = await agentInfo(userId, outsider.id);
    if (info) {
      const res = actWith(info, cap, intent);
      const speaker = mentioned ?? members[0];
      res.messages.unshift({ who: speaker?.id ?? outsider.id, text: `No one here does ${capLabel.toLowerCase()} — @${first(info.name)} can. Handing off.` });
      return res;
    }
  }
  const speaker = mentioned ?? members[0];
  return { messages: [{ who: speaker?.id ?? "system", text: `No agent can ${capLabel.toLowerCase()} yet — create one with that capability and I'll route to them.` }] };
}

function actWith(actor: { id: string; name: string; role: string; goal: string; task: string; capabilities: string[] }, cap: string, intent: Intent): Resolution {
  const first = actor.name.split(" ")[0];
  if (!engineReady(cap)) {
    return { messages: [{ who: actor.id, text: `${first} here — ${CAPABILITIES.find((c) => c.id === cap)?.label ?? cap} isn't wired up yet, so I can't run it. Coming soon!` }] };
  }
  const verb = cap === "scrape" ? "finding leads" : cap === "research" ? "researching the team's leads" : "drafting outreach";
  return { messages: [{ who: actor.id, text: `On it — ${verb}${intent.summary ? " (" + intent.summary + ")" : ""}. 🔍` }], actor, capability: cap };
}

export { teamName };
```

- [ ] **Step 2: Write `lib/chat/actions.ts`.**

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

export interface TeamChatResult {
  messages: ChatOutMsg[];
  job?: { id: string; kind: string; agentId: string };
}

export async function teamChat(teamId: string, message: string): Promise<TeamChatResult> {
  const s = await getSession();
  const userId = s?.userId;
  if (!userId) return { messages: [{ who: "system", text: "Not signed in." }] };

  const memberIds = await membersOfTeam(userId, teamId);
  const members = (await Promise.all(memberIds.map((id) => agentInfo(userId, id)))).filter(Boolean) as NonNullable<Awaited<ReturnType<typeof agentInfo>>>[];
  const intent = await detectIntent(message, members.map((m) => ({ name: m.name, capabilities: m.capabilities })));

  const res = await resolve(userId, teamId, message, intent);
  if (!res.actor || !res.capability) return { messages: res.messages };

  const icp = intent.capability === "scrape" ? { industry: intent.params.industry, titles: intent.params.titles, geo: intent.params.geo } : undefined;
  const enq = await enqueueJob({
    agent: { id: res.actor.id, name: res.actor.name, role: res.actor.role, goal: res.actor.goal, task: res.actor.task },
    kind: res.capability, capabilities: res.actor.capabilities,
    target: intent.params.target ?? 10, icp,
  });
  if ("error" in enq) {
    return { messages: res.messages.concat([{ who: res.actor.id, text: "…couldn't start that: " + enq.error }]) };
  }
  return { messages: res.messages, job: { id: enq.jobId, kind: res.capability, agentId: res.actor.id } };
}
```

- [ ] **Step 3: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors.

- [ ] **Step 4: Commit.**

```bash
git add agentic-salesforce/lib/chat/orchestrate.ts agentic-salesforce/lib/chat/actions.ts
git commit -m "Team-chat orchestration: mentions → intent → capability routing → enqueue"
```

---

## Task 4: Store — `sendTeamChat`

**Files:** Modify `lib/store.tsx`.

**Interfaces:** Consumes `teamChat` + `getJob`. Produces `sendTeamChat(teamId, text)` on the store; appends user msg → agent messages → polls job → status lines.

- [ ] **Step 1: Imports.** In `lib/store.tsx`, add near the other action imports:

```ts
import { teamChat } from "./chat/actions";
import { getJob } from "./jobs/actions";
```

- [ ] **Step 2: Add `sendTeamChat` to the context type.** Where `sendChat: (text: string) => void;` is declared, add:

```ts
  sendTeamChat: (teamId: string, text: string) => void;
```

- [ ] **Step 3: Implement it.** After the `sendChat` useCallback (line ~299), add:

```ts
  const sendTeamChat = useCallback((teamId: string, text: string) => {
    const t = (text || "").trim();
    if (!t) return;
    set((prev) => ({
      chats: { ...prev.chats, [teamId]: (prev.chats[teamId] || []).concat([{ who: "me", text: t }]) },
      chatInput: "", chatTyping: true,
    }));
    appendMessages(teamId, [{ who: "me", text: t }]).catch((e) => console.error("[sendTeamChat] persist user msg failed:", e));

    const append = (who: string, text: string) => {
      set((prev) => ({ chats: { ...prev.chats, [teamId]: (prev.chats[teamId] || []).concat([{ who, text }]) } }));
      appendMessages(teamId, [{ who, text }]).catch(() => {});
    };

    teamChat(teamId, t).then(async (res) => {
      set({ chatTyping: false });
      for (const m of res.messages) append(m.who, m.text);
      if (!res.job) return;
      // Research/outreach run in the Node runner; scrape is claimed by the worker.
      if (res.job.kind !== "scrape") { try { await fetch("/api/jobs/run", { method: "POST" }); } catch { /* best-effort */ } }
      let waited = 0;
      const poll = async (): Promise<void> => {
        const job = await getJob(res.job!.id);
        if (!job) return;
        const r = (job.result ?? {}) as { leadsFound?: number; briefed?: number; draftsCreated?: number; steps?: number };
        if (job.status === "done") {
          const done = res.job!.kind === "scrape" ? `Found ${r.leadsFound ?? 0} lead${r.leadsFound === 1 ? "" : "s"} — in Leads → Pending to accept.`
            : res.job!.kind === "research" ? `Researched ${r.briefed ?? 0} lead${r.briefed === 1 ? "" : "s"}.`
            : `Drafted ${r.draftsCreated ?? 0} email${r.draftsCreated === 1 ? "" : "s"} — in the Emails tab.`;
          append(res.job!.agentId, done);
          return;
        }
        if (job.status === "failed") { append(res.job!.agentId, "That run failed — check the agent."); return; }
        if (waited >= 40) { append(res.job!.agentId, "Still working in the background — check back shortly."); return; }
        waited++;
        setTimeout(poll, 2500);
      };
      poll();
    }).catch(() => { set({ chatTyping: false }); append("system", "Sorry — I couldn't process that just now."); });
  }, [set]);
```

- [ ] **Step 4: Expose it.** Add `sendTeamChat` to the context value object (the `return { … }` near line 378, alongside `sendChat`).

- [ ] **Step 5: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors. (`appendMessages`/`set`/`useCallback` in scope; `ChatMsg.who` accepts string from Task 1.)

- [ ] **Step 6: Commit.**

```bash
git add agentic-salesforce/lib/store.tsx
git commit -m "Store: sendTeamChat — post user msg, run teamChat, poll job, append status"
```

---

## Task 5: Chats UI — Teams rail + team thread + @-mention autocomplete

**Files:** Modify `app/chats/page.tsx`.

**Interfaces:** Consumes `teams`/`sendTeamChat`/`byId`; renders team threads with speaker attribution + a mention dropdown.

- [ ] **Step 1: Read the current page**, then destructure the new deps:

```ts
  const { s, set, agents, teams, byId, sendChat, sendTeamChat } = useApp();
```

- [ ] **Step 2: Team-aware conversation resolution.** Replace the `convIds`/`activeId`/`conv`/`messages` block (lines 26-34) with team-aware logic:

```ts
  const teamById = (id: string) => teams.find((t) => t.id === id);
  const agentConvIds = Object.keys(s.chats).filter((id) => byId(id));
  const isTeam = (id: string) => !!teamById(id);
  const activeId = byId(s.convId) || teamById(s.convId) ? s.convId : (teams[0]?.id ?? agentConvIds[0] ?? s.convId);
  const activeTeam = teamById(activeId);
  const activeAgent = byId(activeId) || agents[0];
  const teamMembers = activeTeam ? activeTeam.members.map((id) => byId(id)).filter(Boolean) as typeof agents : [];
  const messages = s.chats[activeId] || [];
```

- [ ] **Step 3: Teams section in the rail.** In the conversation-list `<div>` (after the "Conversations" title, before the agent `convIds.map`), add a Teams group:

```tsx
        {teams.length > 0 && (<>
          <div style={css("padding:6px 12px;font-size:10.5px;font-weight:700;color:#A1A1AA;text-transform:uppercase;letter-spacing:.05em")}>Teams</div>
          {teams.map((t) => {
            const msgs = s.chats[t.id]; const last = msgs && msgs[msgs.length - 1];
            return (
              <Box key={t.id} onClick={() => set({ convId: t.id })} style={"display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:12px;cursor:pointer;" + (t.id === activeId ? "background:#F1EDFD" : "")} styleHover="background:#F4F4F5">
                <div style={css("width:32px;height:32px;border-radius:10px;background:" + t.iconBg + ";display:flex;align-items:center;justify-content:center;font-size:16px;flex:none")}>{t.icon}</div>
                <div style={css("min-width:0")}><div style={css("font-size:12.5px;font-weight:600")}>{t.name}</div><div style={css("font-size:11px;color:#A1A1AA;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{last ? last.text : t.members.length + " agents"}</div></div>
              </Box>
            );
          })}
          <div style={css("padding:6px 12px;font-size:10.5px;font-weight:700;color:#A1A1AA;text-transform:uppercase;letter-spacing:.05em;margin-top:6px")}>Agents</div>
        </>)}
```

(Change the existing `convIds` reference in the agent map to `agentConvIds`.)

- [ ] **Step 4: Team-aware header.** Replace the chat-area header (lines 61-68) so it shows the team when active, else the agent:

```tsx
        <div style={css("display:flex;align-items:center;gap:11px;padding:13px 20px;background:#fff;border-bottom:1px solid #ECECF1;flex:none")}>
          {activeTeam ? (<>
            <div style={css("width:34px;height:34px;border-radius:11px;background:" + activeTeam.iconBg + ";display:flex;align-items:center;justify-content:center;font-size:17px;flex:none")}>{activeTeam.icon}</div>
            <div><div style={css("font-size:13.5px;font-weight:700")}>{activeTeam.name}</div><div style={css("font-size:11px;color:#71717A")}>{teamMembers.map((a) => a!.name.split(" ")[0]).join(", ")}</div></div>
            <div style={css("margin-left:auto;display:flex")}>{teamMembers.slice(0, 5).map((a, i) => <div key={a!.id} style={css(av(a!, 26) + ";border:2px solid #fff;margin-left:" + (i ? "-8" : "0") + "px")}>{a!.initials}</div>)}</div>
          </>) : (<>
            <div style={css(av(activeAgent, 34))}>{activeAgent.initials}</div>
            <div><div style={css("font-size:13.5px;font-weight:700")}>{activeAgent.name}</div><div style={css("font-size:11px;color:#2FA45C;display:flex;align-items:center;gap:5px")}><span style={css("width:6px;height:6px;border-radius:50%;background:#2FA45C")} />{activeAgent.role} · online</div></div>
            <Btn onClick={() => router.push("/agents/" + activeAgent.id)} style="margin-left:auto;background:#F1EDFD;color:#5122C1;border:none;border-radius:99px;padding:6px 14px;font-size:11.5px;font-weight:600;cursor:pointer" styleHover="background:#E3DBF9">View profile</Btn>
          </>)}
        </div>
```

- [ ] **Step 5: Speaker-attributed messages.** Replace the `messages.map` (lines 71-75) so team threads show each speaker's avatar/name:

```tsx
          {messages.map((m, i) => {
            const mine = m.who === "me";
            const speaker = !mine && activeTeam ? byId(m.who) : null;
            return (
              <div key={i} style={css("display:flex;gap:8px;justify-content:" + (mine ? "flex-end" : "flex-start"))}>
                {speaker && <div style={css(av(speaker, 26) + ";flex:none;margin-top:2px")}>{speaker.initials}</div>}
                <div style={css("display:flex;flex-direction:column;max-width:62%;gap:2px")}>
                  {speaker && <div style={css("font-size:10.5px;font-weight:600;color:#71717A;padding-left:4px")}>{speaker.name.split(" ")[0]}</div>}
                  <div style={css((mine ? "background:#5122C1;color:#fff;border-radius:16px 16px 4px 16px;" : "background:#fff;color:#3F3F46;border:1px solid #ECECF1;border-radius:16px 16px 16px 4px;") + "padding:11px 15px;font-size:13px;line-height:1.55;animation:fadeUp .25s ease")}>{m.text}</div>
                </div>
              </div>
            );
          })}
```

(A message whose `who` is an agentId no longer on the team, or `"system"`, falls back to a plain left bubble — `speaker` is null.)

- [ ] **Step 6: Input → team-aware + `@`-mention autocomplete.** Replace the input row (the suggestions + input `<div>`, lines 87-104) with a version that routes to `sendTeamChat` for teams and shows a mention dropdown:

```tsx
        <div style={css("padding:14px 20px;background:#FAFAFB;flex:none;position:relative")}>
          {activeTeam && (() => {
            const m = s.chatInput.match(/@([\w'-]*)$/);
            if (!m) return null;
            const q = m[1].toLowerCase();
            const hits = teamMembers.filter((a) => a!.name.toLowerCase().includes(q)).slice(0, 5);
            if (hits.length === 0) return null;
            return (
              <div style={css("position:absolute;bottom:64px;left:20px;background:#fff;border:1px solid #ECECF1;border-radius:12px;box-shadow:0 12px 32px rgba(24,24,27,.14);overflow:hidden;z-index:20;min-width:220px")}>
                {hits.map((a) => (
                  <Box key={a!.id} onClick={() => set({ chatInput: s.chatInput.replace(/@([\w'-]*)$/, "@" + a!.name.split(" ")[0] + " ") })} style="display:flex;align-items:center;gap:9px;padding:9px 12px;cursor:pointer" styleHover="background:#F4F4F5">
                    <div style={css(av(a!, 24))}>{a!.initials}</div>
                    <div style={css("font-size:12.5px;font-weight:600")}>{a!.name}<span style={css("font-size:10.5px;color:#A1A1AA;font-weight:400")}> · {a!.capabilities.join(", ") || "no capabilities"}</span></div>
                  </Box>
                ))}
              </div>
            );
          })()}
          {!activeTeam && (
            <div style={css("display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap")}>
              {SUGGESTIONS.map((q) => <Box key={q} onClick={() => sendChat(q)} style="font-size:11.5px;color:#5122C1;background:#F1EDFD;border-radius:99px;padding:5px 13px;cursor:pointer;font-weight:600" styleHover="background:#E3DBF9">{q}</Box>)}
            </div>
          )}
          <div style={css("display:flex;gap:10px;background:#fff;border:1px solid #ECECF1;border-radius:99px;padding:6px 6px 6px 18px;box-shadow:0 1px 3px rgba(24,24,27,.05)")}>
            <input
              aria-label="Message"
              value={s.chatInput}
              onChange={(e) => set({ chatInput: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") { activeTeam ? sendTeamChat(activeTeam.id, s.chatInput) : sendChat(s.chatInput); } }}
              placeholder={activeTeam ? "Message the team — @mention an agent…" : "Message " + activeAgent.name.split(" ")[0] + "…"}
              style={css("flex:1;border:none;outline:none;font-size:13px;background:transparent;color:#18181B")}
            />
            <Btn onClick={() => { activeTeam ? sendTeamChat(activeTeam.id, s.chatInput) : sendChat(s.chatInput); }} style="background:#5122C1;color:#fff;border:none;border-radius:99px;padding:8px 18px;font-size:12.5px;font-weight:600;cursor:pointer" styleHover="background:#42199E">Send ↑</Btn>
          </div>
        </div>
```

- [ ] **Step 7: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors.

- [ ] **Step 8: Manual check.** With `pnpm dev`: Chats shows a **Teams** section; open a team → header shows the team + member avatars; type `@` → dropdown of the team's agents with capability hints; send "@Sarah find fintech CTOs" → Sarah's acknowledgement appears (with her avatar), a scrape job runs (worker), and a "Found N leads — in Pending" status posts; "@Sarah research the leads" (Sarah scrape-only) → hand-off to a researcher; chit-chat → a plain reply, no job.

- [ ] **Step 9: Commit.**

```bash
git add "agentic-salesforce/app/chats/page.tsx"
git commit -m "Chats: team group threads (speaker-attributed) + @-mention autocomplete + sendTeamChat wiring"
```

---

## Self-Review

**Spec coverage:**
- Part A (team thread keyed by teamId, `ChatMsg.who` speaker) → Task 1 (types) + Task 4/5 (store/UI). Part B (mentions + intent + routing) → Task 1 (`detectIntent`) + Task 3 (`parseMentions`/`resolve`/`teamChat`). Part C (execution: scrape ICP, research/outreach on book, not-ready reply-only, kick+poll) → Task 2 (ICP), Task 3 (enqueue), Task 4 (kick+poll+status). Part D (UI: Teams rail, speaker attribution, @-autocomplete) → Task 5.

**Placeholder scan:** every step has complete code or exact edit targets. The "lines ~N" are read-anchors.

**Type consistency:** `ChatMsg.who: "me" | string` (T1) lets team messages carry a speaker id (T4/T5). `Intent` (T1) is consumed by `resolve`/`teamChat` (T3). `enqueueJob`'s new `icp` (T2) is passed by `teamChat` (T3) and read by the worker (T2). `teamChat(teamId, message): TeamChatResult { messages, job? }` (T3) matches `sendTeamChat`'s consumer (T4). `sendTeamChat(teamId, text)` (T4) matches the UI call sites (T5). `agentInfo`/`membersOfTeam` reused from pod/membership. Capability `engineReady` (from `CAPABILITIES`) gates execution in `actWith` (T3); scrape→worker vs research/outreach→`/api/jobs/run` split honored in the poll (T4).
