import "server-only";
// Team-chat orchestration: mentions → intent → capability routing → templated
// replies. Server-only. Pairs with lib/chat/actions.ts (which enqueues jobs).
import { and, desc, eq } from "drizzle-orm";
import { getDb, isDbConfigured, agents, jobs, teams as teamsTable } from "@/lib/db";
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

// Heuristic backstop so status queries work even if Gemini mis-labels them.
const looksLikeStatus = (m: string): boolean =>
  /\b(update|updates|status|progress|how('?s| is| are| goes| going)|going|working on|doing|done yet|finished|any news|where.*(at|up to)|what'?s happening)\b/i.test(m);

/** A one-line, in-character report of an agent's current or most-recent job. */
async function describeWork(userId: string, agentId: string, first: string): Promise<string> {
  if (!isDbConfigured()) return `${first} here — nothing running right now.`;
  const [job] = await getDb().select().from(jobs)
    .where(and(eq(jobs.userId, userId), eq(jobs.agentId, agentId)))
    .orderBy(desc(jobs.createdAt)).limit(1);
  if (!job) return `${first} here — I'm not running anything right now. Want me to find leads, research, or draft outreach?`;
  const r = (job.result ?? {}) as { leadsFound?: number; briefed?: number; draftsCreated?: number };
  const doing = job.kind === "scrape" ? "finding leads" : job.kind === "research" ? "researching the team's leads" : job.kind === "outreach" ? "drafting outreach" : job.kind;
  if (job.status === "running" || job.status === "queued") {
    const prog = job.kind === "scrape" && typeof r.leadsFound === "number" ? ` — ${r.leadsFound} found so far` : "";
    return `${first} here — I'm ${doing} right now${prog}. I'll post the results here when it's done.`;
  }
  if (job.status === "needs_approval") return `${first} here — a ${doing} run is queued up, waiting on your approval.`;
  if (job.status === "failed") return `${first} here — my last ${doing} run hit a snag. Want me to try again?`;
  if (job.status === "done") {
    const summary = job.kind === "scrape" ? `found ${r.leadsFound ?? 0} lead${r.leadsFound === 1 ? "" : "s"} — they're in Leads → Pending to review`
      : job.kind === "research" ? `researched ${r.briefed ?? 0} lead${r.briefed === 1 ? "" : "s"}`
      : job.kind === "outreach" ? `drafted ${r.draftsCreated ?? 0} email${r.draftsCreated === 1 ? "" : "s"} — in the Emails tab`
      : "wrapped up my last task";
    return `${first} here — just finished ${doing}: ${summary}.`;
  }
  return `${first} here — my last ${doing} task is ${job.status}.`;
}

/** Decide who acts + the reply messages, given the detected intent. */
export async function resolve(userId: string, teamId: string, message: string, intent: Intent): Promise<Resolution> {
  const memberIds = await membersOfTeam(userId, teamId);
  const members = (await Promise.all(memberIds.map((id) => agentInfo(userId, id)))).filter(Boolean) as NonNullable<Awaited<ReturnType<typeof agentInfo>>>[];
  const cap = intent.capability;
  const mentions = parseMentions(message, members);
  const mentioned = mentions.length ? members.find((m) => m.id === mentions[0]) : undefined;

  // Status inquiry ("@Emily any updates?"): report the agent's real current/last job.
  if (cap === "status" || ((cap === "chat" || cap === "unknown") && looksLikeStatus(message))) {
    const target = mentioned ?? members[0];
    if (!target) return { messages: [{ who: "system", text: "No agents on this team yet." }] };
    return { messages: [{ who: target.id, text: await describeWork(userId, target.id, target.name.split(" ")[0]) }] };
  }

  if (cap === "chat" || cap === "unknown") {
    const responder = members[0];
    return { messages: [{ who: responder?.id ?? "system", text: responder ? `${responder.name.split(" ")[0]} here — I can help the team scrape, research, or draft. What do you need?` : "No agents on this team yet." }] };
  }

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
