"use server";
// The team group-chat orchestration entrypoint: mentions → intent → route →
// enqueue the real job. Returns the messages to post + any job to poll.
import { getSession } from "@/lib/auth/session";
import { membersOfTeam } from "@/lib/teams/membership";
import { agentInfo } from "@/lib/pod/orchestrate";
import { detectIntent } from "@/lib/ai/intent";
import { resolve, type ChatOutMsg } from "./orchestrate";
import { enqueueJob } from "@/lib/jobs/actions";
import { listTeamMessages as _listTeamMessages } from "./teamMessages";

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

  const enq = await enqueueJob({
    agent: { id: res.actor.id, name: res.actor.name, role: res.actor.role, goal: res.actor.goal, task: res.actor.task },
    kind: res.capability, capabilities: res.actor.capabilities,
    target: intent.params.target ?? 10,
    // The user's raw message is the sole targeting for a scrape (no ICP).
    instruction: res.capability === "scrape" ? message : undefined,
  });
  if ("error" in enq) {
    return { messages: res.messages.concat([{ who: res.actor.id, text: "…couldn't start that: " + enq.error }]) };
  }
  return { messages: res.messages, job: { id: enq.jobId, kind: res.capability, agentId: res.actor.id } };
}

export async function listTeamMessages(teamId: string): Promise<{ who: string; text: string }[]> {
  const s = await getSession();
  if (!s?.userId) return [];
  return _listTeamMessages(s.userId, teamId);
}
