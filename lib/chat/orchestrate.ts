import "server-only";
// Team-chat orchestration: mentions → intent → capability routing → templated
// replies. Server-only. Pairs with lib/chat/actions.ts (which enqueues jobs).
import { and, desc, eq } from "drizzle-orm";
import { getDb, isDbConfigured, agents, jobs, teams as teamsTable } from "@/lib/db";
import { AGENTS_BASE, TEAMS_BASE } from "@/lib/data";
import { membersOfTeam } from "@/lib/teams/membership";
import { agentInfo } from "@/lib/pod/orchestrate";
import { CAPABILITIES } from "@/lib/agentTypes";
import { converse } from "./converse";
import type { Intent } from "@/lib/ai/intent";

export interface ChatOutMsg { who: string; text: string } // who = speaker agentId
export interface Resolution {
  messages: ChatOutMsg[];
  // Routing line(s) the mentioned/coordinating agent says BEFORE the actor replies.
  // For example, the Assessor assessing "@Assessor setup a meeting" and rerouting to the
  // Meeting agent. Kept separate from `messages` (the actor's own reply) so a
  // clarifying question still gets the hand-off prefixed instead of dropping it.
  handoff?: ChatOutMsg[];
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

// Heuristic backstop so status queries work even if the model mis-labels them.
const looksLikeStatus = (m: string): boolean =>
  /\b(update|updates|status|progress|how('?s| is| are| goes| going)|going|working on|doing|done yet|finished|any news|where.*(at|up to)|what'?s happening)\b/i.test(m);

/** A one-line, in-character report of an agent's current or most-recent job. */
async function describeWork(userId: string, agentId: string): Promise<string> {
  if (!isDbConfigured()) return `There is nothing running at the moment.`;
  const [job] = await getDb().select().from(jobs)
    .where(and(eq(jobs.userId, userId), eq(jobs.agentId, agentId)))
    .orderBy(desc(jobs.createdAt)).limit(1);
  if (!job) return `I'm not working on anything at the moment. I can find leads, run research, or draft outreach whenever you'd like.`;
  const r = (job.result ?? {}) as { leadsFound?: number; briefed?: number; draftsCreated?: number; matched?: number };
  const doing = job.kind === "scrape" ? "finding leads" : job.kind === "research" ? "researching the team's leads" : job.kind === "outreach" ? "drafting outreach" : job.kind === "qualify" ? "qualifying the leads" : job.kind === "proposal" ? "drafting a proposal" : job.kind === "match" ? "matching leads to listings" : job.kind;
  if (job.status === "running" || job.status === "queued") {
    const prog = job.kind === "scrape" && typeof r.leadsFound === "number" ? `. ${r.leadsFound} found so far` : "";
    return `I'm currently ${doing}${prog}. I'll post the results here once it's complete.`;
  }
  if (job.status === "needs_approval") return `A ${doing} run is queued and awaiting your approval.`;
  if (job.status === "failed") return `My last ${doing} run encountered an error. Would you like me to try it again?`;
  if (job.status === "done") {
    const summary = job.kind === "scrape" ? `found ${r.leadsFound ?? 0} lead${r.leadsFound === 1 ? "" : "s"}, waiting for your review`
      : job.kind === "research" ? `researched ${r.briefed ?? 0} lead${r.briefed === 1 ? "" : "s"}`
      : job.kind === "outreach" ? `drafted ${r.draftsCreated ?? 0} email${r.draftsCreated === 1 ? "" : "s"}, ready for you to review and send`
      : job.kind === "match" ? `matched ${r.matched ?? 0} lead${r.matched === 1 ? "" : "s"} to your catalog`
      : "completed my last task";
    return `I've just finished ${doing}: ${summary}.`;
  }
  return `My last ${doing} task is ${job.status}.`;
}

/** Decide who acts + the reply messages, given the detected intent. */
export async function resolve(userId: string, teamId: string, message: string, intent: Intent, opts?: { lastSpeakerId?: string; history?: { who: string; text: string }[] }): Promise<Resolution> {
  const memberIds = await membersOfTeam(userId, teamId);
  const members = (await Promise.all(memberIds.map((id) => agentInfo(userId, id)))).filter(Boolean) as NonNullable<Awaited<ReturnType<typeof agentInfo>>>[];
  const cap = intent.capability;
  const mentions = parseMentions(message, members);
  const mentioned = mentions.length ? members.find((m) => m.id === mentions[0]) : undefined;

  // Status inquiry ("@Emily any updates?"): report the agent's real current/last job.
  if (cap === "status" || ((cap === "chat" || cap === "unknown") && looksLikeStatus(message))) {
    const target = mentioned ?? members.find((m) => m.id === opts?.lastSpeakerId) ?? members[0];
    if (!target) return { messages: [{ who: "system", text: "No agents on this team yet." }] };
    return { messages: [{ who: target.id, text: await describeWork(userId, target.id) }] };
  }

  if (cap === "chat" || cap === "unknown") {
    const responder = mentioned ?? members.find((m) => m.id === opts?.lastSpeakerId) ?? members[0];
    if (!responder) return { messages: [{ who: "system", text: "No agents on this team yet." }] };
    const text = await converse({
      responder,
      roster: members.map((m) => ({ id: m.id, name: m.name, capabilities: m.capabilities })),
      history: opts?.history ?? [],
      message,
    });
    return { messages: [{ who: responder.id, text }] };
  }

  const capLabel = CAPABILITIES.find((c) => c.id === cap)?.label ?? cap;
  const first = (n: string) => n.split(" ")[0];

  // A capable actor: mentioned-if-able, else a teammate, else cross-team.
  if (mentioned && mentioned.capabilities.includes(cap)) {
    return actWith(mentioned, cap, intent);
  }
  const teammate = members.find((m) => m.capabilities.includes(cap));
  if (mentioned && teammate) {
    // The mentioned agent can't do this, but a teammate can. The mentioned agent
    // assesses the request and reroutes. It speaks first (res.handoff), then the
    // capable teammate replies (res.messages).
    const res = actWith(teammate, cap, intent);
    res.handoff = [{ who: mentioned.id, text: `This needs ${capLabel.toLowerCase()}. That is the area of @${first(teammate.name)}, not mine. I am sending this to them.` }];
    return res;
  }
  if (teammate) {
    return actWith(teammate, cap, intent);
  }
  // nobody on this team. Look at the user's other teams.
  const roster = await allAgents(userId);
  const outsider = roster.find((a) => a.capabilities.includes(cap) && !members.some((m) => m.id === a.id));
  if (outsider) {
    const info = await agentInfo(userId, outsider.id);
    if (info) {
      const res = actWith(info, cap, intent);
      const speaker = mentioned ?? members[0];
      res.handoff = [{ who: speaker?.id ?? outsider.id, text: `No one on this team does ${capLabel.toLowerCase()}. @${first(info.name)} does. I am sending this to them.` }];
      return res;
    }
  }
  const speaker = mentioned ?? members[0];
  return { messages: [{ who: speaker?.id ?? "system", text: `No agent can ${capLabel.toLowerCase()} yet. Create an agent with that capability, and I will send requests to it.` }] };
}

function actWith(actor: { id: string; name: string; role: string; goal: string; task: string; capabilities: string[] }, cap: string, intent: Intent): Resolution {
  if (!engineReady(cap)) {
    return { messages: [{ who: actor.id, text: `${CAPABILITIES.find((c) => c.id === cap)?.label ?? cap} isn't available yet, so I'm unable to run it at the moment.` }] };
  }
  const VERBS: Record<string, string> = {
    scrape: "finding leads",
    research: "researching the team's leads",
    qualify: "qualifying the leads",
    proposal: "drafting a proposal",
    match: "matching leads to listings",
    outreach: "drafting outreach",
    "book-meeting": "booking the meeting",
    assess: "reviewing the new leads",
    "follow-up": "re-engaging the cold leads",
    enrich: "enriching the leads",
  };
  const verb = VERBS[cap] ?? "working on it";
  return { messages: [{ who: actor.id, text: `Understood. I'm ${verb} now${intent.summary ? " (" + intent.summary + ")" : ""}.` }], actor, capability: cap };
}
