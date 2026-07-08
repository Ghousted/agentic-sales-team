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
