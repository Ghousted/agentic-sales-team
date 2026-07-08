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
import { listTeamLeadsForPicker, setLeadReview } from "@/lib/leads/store";
import { isAllRequest, askWhoText } from "./outreachTarget";

export interface TeamChatResult {
  messages: ChatOutMsg[];
  job?: { id: string; kind: string; agentId: string };
}

// Capabilities whose jobs consume specific leads (so /lead picks apply to them).
const LEAD_CAPS = new Set(["outreach", "research", "qualify", "proposal"]);

export async function teamChat(teamId: string, message: string, leadIds?: string[]): Promise<TeamChatResult> {
  const s = await getSession();
  const userId = s?.userId;
  if (!userId) return { messages: [{ who: "system", text: "Not signed in." }] };

  const memberIds = await membersOfTeam(userId, teamId);
  const members = (await Promise.all(memberIds.map((id) => agentInfo(userId, id)))).filter(Boolean) as NonNullable<Awaited<ReturnType<typeof agentInfo>>>[];
  const intent = await detectIntent(message, members.map((m) => ({ name: m.name, capabilities: m.capabilities })));

  const res = await resolve(userId, teamId, message, intent);
  if (!res.actor || !res.capability) return { messages: res.messages };
  const actor = res.actor;
  const cap = res.capability;
  const picks = (leadIds ?? []).filter(Boolean);

  // Outreach "ask who" gate: with no pick and no explicit "all", ask instead of
  // drafting. "all" only proceeds when there is at least one accepted lead.
  if (cap === "outreach" && picks.length === 0) {
    if (isAllRequest(message)) {
      const teamLeads = await listTeamLeadsForPicker(teamId);
      const hasAccepted = teamLeads.some((l) => l.review === "accepted");
      if (!hasAccepted) return { messages: [{ who: actor.id, text: askWhoText(actor.name) }] };
      // fall through → enqueue outreach with no leadIds (all accepted, undrafted)
    } else {
      return { messages: [{ who: actor.id, text: askWhoText(actor.name) }] };
    }
  }

  // Picking = approving: flip any picked leads to accepted so the runner (which
  // only drafts review='accepted') will pick them up.
  if (LEAD_CAPS.has(cap) && picks.length) {
    await setLeadReview(picks, "accepted");
  }

  const enq = await enqueueJob({
    agent: { id: actor.id, name: actor.name, role: actor.role, goal: actor.goal, task: actor.task },
    kind: cap, capabilities: actor.capabilities,
    target: intent.params.target ?? 10,
    // The user's raw message is the sole targeting for a scrape (no ICP).
    instruction: cap === "scrape" ? message : undefined,
    // /lead picks target specific leads for lead-consuming capabilities.
    leadIds: LEAD_CAPS.has(cap) && picks.length ? picks : undefined,
    batchSize: LEAD_CAPS.has(cap) && picks.length ? picks.length : undefined,
  });
  if ("error" in enq) {
    return { messages: res.messages.concat([{ who: actor.id, text: "…couldn't start that: " + enq.error }]) };
  }
  return { messages: res.messages, job: { id: enq.jobId, kind: cap, agentId: actor.id } };
}

export async function listTeamMessages(teamId: string): Promise<{ who: string; text: string }[]> {
  const s = await getSession();
  if (!s?.userId) return [];
  return _listTeamMessages(s.userId, teamId);
}
