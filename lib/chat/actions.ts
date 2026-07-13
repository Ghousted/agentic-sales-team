"use server";
// The team group-chat orchestration entrypoint: mentions → intent → route →
// enqueue the real job. Returns the messages to post + any job to poll.
import { getSession } from "@/lib/auth/session";
import { membersOfTeam } from "@/lib/teams/membership";
import { agentInfo } from "@/lib/pod/orchestrate";
import { detectIntent } from "@/lib/ai/intent";
import { resolve, parseMentions, type ChatOutMsg } from "./orchestrate";
import { enqueueJob } from "@/lib/jobs/actions";
import { listTeamMessages as _listTeamMessages } from "./teamMessages";
import { listTeamLeadsForPicker, setLeadReview } from "@/lib/leads/store";
import { isAllRequest, askWhoText, askWhoAgainText, isAskWhoPrompt } from "./outreachTarget";
import { scrapeHasTarget, askScrapeText, isAskScrapePrompt, askWhenText, askWhatTimeText, pendingMeeting, askMeetingWhoText, isAskMeetingWhoPrompt } from "./clarify";
import { resolveTargetLeads } from "@/lib/ai/resolveLeads";
import { parseMeetingTime } from "@/lib/ai/meetingTime";
import { bookMeeting, meetingSettings } from "@/lib/meetings/store";

export interface TeamChatResult {
  messages: ChatOutMsg[];
  job?: { id: string; kind: string; agentId: string };
}

type Member = NonNullable<Awaited<ReturnType<typeof agentInfo>>>;

// Capabilities whose jobs consume specific leads (so /lead picks apply to them).
const LEAD_CAPS = new Set(["outreach", "research", "qualify", "proposal", "match"]);

const onItText = (_name: string) => `Understood. I'll begin drafting the outreach now.`;

/** Approve any picked leads, then enqueue an outreach job for the target. Shared
 *  by the fresh-request gate and the pending-answer path. */
async function startOutreach(actor: Member, target: { leadIds?: string[]; all?: boolean }): Promise<{ jobId: string } | { error: string }> {
  const agent = { id: actor.id, name: actor.name, role: actor.role, goal: actor.goal, task: actor.task };
  if (target.leadIds && target.leadIds.length) {
    await setLeadReview(target.leadIds, "accepted");
    return enqueueJob({ agent, kind: "outreach", capabilities: actor.capabilities, leadIds: target.leadIds, batchSize: target.leadIds.length });
  }
  return enqueueJob({ agent, kind: "outreach", capabilities: actor.capabilities });
}

/** Resolve `phrase` to a meeting time for `leadIds` and reply with one of three
 *  outcomes, each keeping the flow alive via the ⟦meet:…⟧ marker:
 *   - no usable date        → ask "when?"        (marker carries the lead ids)
 *   - a day but no clock time → ask "what time?" (marker also carries the date)
 *   - a full date + time     → book it.
 *  Shared by the fresh request, the "who?" answer, and the "when/what time?" answers. */
async function resolveTimeAndBook(userId: string, actor: Member, teamId: string, leadIds: string[], phrase: string): Promise<ChatOutMsg[]> {
  await setLeadReview(leadIds, "accepted"); // picking = approving
  const teamLeads = await listTeamLeadsForPicker(teamId);
  const names = leadIds.map((id) => teamLeads.find((l) => l.id === id)?.name ?? "the lead").join(", ");
  const settings = await meetingSettings(userId, actor.id);
  const { iso, label, hasTime } = await parseMeetingTime(phrase, settings);
  if (!iso) return [{ who: actor.id, text: askWhenText(names, leadIds) }];
  if (!hasTime) {
    // Format the day from the parsed date only — never reuse `label`, which carries
    // the defaulted placeholder time (e.g. "9:00–9:30 AM") we're asking to replace.
    const day = new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    return [{ who: actor.id, text: askWhatTimeText(names, day, leadIds, iso.slice(0, 10)) }];
  }
  for (const id of leadIds) await bookMeeting(userId, actor.id, id, iso, label, settings.type);
  return [{ who: actor.id, text: `Booked — a ${settings.type} with ${names} on ${label}. It's on your calendar.` }];
}

export async function teamChat(teamId: string, message: string, leadIds?: string[]): Promise<TeamChatResult> {
  const s = await getSession();
  const userId = s?.userId;
  if (!userId) return { messages: [{ who: "system", text: "Not signed in." }] };

  const memberIds = await membersOfTeam(userId, teamId);
  const members = (await Promise.all(memberIds.map((id) => agentInfo(userId, id)))).filter(Boolean) as Member[];

  // Conversation context from the thread: the last agent to speak (continuity),
  // and whether that last agent message is Outreach's still-open "who?" prompt.
  const history = await _listTeamMessages(userId, teamId);
  const byId = new Map(members.map((m) => [m.id, m] as const));
  let lastSpeaker: Member | undefined;
  let lastAgentText = "";
  for (let i = history.length - 1; i >= 0; i--) {
    const spk = byId.get(history[i].who);
    if (spk) { lastSpeaker = spk; lastAgentText = history[i].text; break; }
  }
  const pendingAgent = lastSpeaker && lastSpeaker.capabilities.includes("outreach") && isAskWhoPrompt(lastAgentText, lastSpeaker.name)
    ? lastSpeaker : undefined;
  const pendingScrapeAgent = lastSpeaker && lastSpeaker.capabilities.includes("scrape") && isAskScrapePrompt(lastAgentText)
    ? lastSpeaker : undefined;
  const meetState = lastSpeaker && lastSpeaker.capabilities.includes("book-meeting") ? pendingMeeting(lastAgentText) : null;
  const pendingMeet = meetState && lastSpeaker ? { agent: lastSpeaker, ...meetState } : null;
  const pendingMeetingWho = lastSpeaker && lastSpeaker.capabilities.includes("book-meeting") && isAskMeetingWhoPrompt(lastAgentText)
    ? lastSpeaker : undefined;

  const intent = await detectIntent(message, members.map((m) => ({ name: m.name, capabilities: m.capabilities })));
  const mentions = parseMentions(message, members);

  // Pending meeting time: the Meeting agent asked "when?" or "what time?" — this
  // unmentioned reply is the answer. When a day is already known (the marker
  // carries it), prepend it so a bare "2pm" lands on that day. resolveTimeAndBook
  // books, or re-asks for whichever detail is still missing.
  if (pendingMeet && mentions.length === 0 && (intent.capability === "chat" || intent.capability === "unknown" || intent.capability === "book-meeting")) {
    const phrase = pendingMeet.date ? `${pendingMeet.date} ${message}` : message;
    return { messages: await resolveTimeAndBook(userId, pendingMeet.agent, teamId, pendingMeet.leadIds, phrase) };
  }

  // Pending meeting "who?": the Meeting agent asked which lead to book with, and
  // this reply names/picks the lead. Resolve it (an explicit /lead pick, else the
  // free-text name) and move on to asking "when?" (or book if a time is already
  // given). Without this, a lead-pick reply falls through to converse() and the
  // booking loses its lead.
  if (pendingMeetingWho && mentions.length === 0 && (intent.capability === "chat" || intent.capability === "unknown" || intent.capability === "book-meeting")) {
    const a = pendingMeetingWho;
    let ids = (leadIds ?? []).filter(Boolean);
    if (!ids.length) {
      const teamLeads = await listTeamLeadsForPicker(teamId);
      const r = await resolveTargetLeads(message, teamLeads);
      if (r.mode === "some" && r.leadIds.length) ids = r.leadIds;
    }
    if (!ids.length) return { messages: [{ who: a.id, text: askMeetingWhoText() }] };
    return { messages: await resolveTimeAndBook(userId, a, teamId, ids, message) };
  }

  // Pending scrape clarification: the agent just asked what to look for, and this
  // is an unmentioned reply that isn't a different command → use it as the target.
  if (pendingScrapeAgent && mentions.length === 0 && (intent.capability === "scrape" || intent.capability === "chat" || intent.capability === "unknown")) {
    const a = pendingScrapeAgent;
    const enq = await enqueueJob({
      agent: { id: a.id, name: a.name, role: a.role, goal: a.goal, task: a.task },
      kind: "scrape", capabilities: a.capabilities, target: intent.params.target ?? 10, instruction: message,
      pod: true, teamId,
    });
    if ("error" in enq) return { messages: [{ who: a.id, text: "I wasn't able to start that: " + enq.error }] };
    return { messages: [{ who: a.id, text: "Understood — searching for that now. I'll post the results here." }], job: { id: enq.jobId, kind: "scrape", agentId: a.id } };
  }

  // Pending-answer path: Outreach just asked "who?", and this is an unmentioned
  // reply that isn't a different command → interpret it as the answer.
  if (pendingAgent && mentions.length === 0 && (intent.capability === "chat" || intent.capability === "unknown" || intent.capability === "outreach")) {
    const picks = (leadIds ?? []).filter(Boolean);
    let target: { leadIds?: string[]; all?: boolean } | null = null;
    if (picks.length) {
      target = { leadIds: picks };
    } else {
      const teamLeads = await listTeamLeadsForPicker(teamId);
      const hasAccepted = teamLeads.some((l) => l.review === "accepted");
      if (isAllRequest(message)) {
        if (hasAccepted) target = { all: true };
      } else {
        const r = await resolveTargetLeads(message, teamLeads);
        if (r.mode === "all") { if (hasAccepted) target = { all: true }; }
        else if (r.mode === "some" && r.leadIds.length) target = { leadIds: r.leadIds };
      }
    }
    if (!target) return { messages: [{ who: pendingAgent.id, text: askWhoAgainText(pendingAgent.name) }] };
    const enq = await startOutreach(pendingAgent, target);
    if ("error" in enq) return { messages: [{ who: pendingAgent.id, text: "I wasn't able to start that: " + enq.error }] };
    return { messages: [{ who: pendingAgent.id, text: onItText(pendingAgent.name) }], job: { id: enq.jobId, kind: "outreach", agentId: pendingAgent.id } };
  }

  const res = await resolve(userId, teamId, message, intent, { lastSpeakerId: lastSpeaker?.id, history });
  // The rerouting agent (e.g. the mentioned Assessor) speaks first; prepend its
  // line to whatever the capable actor replies — including a clarifying question,
  // which used to be returned alone and dropped the hand-off.
  const pre = res.handoff ?? [];
  if (!res.actor || !res.capability) return { messages: [...pre, ...res.messages] };
  const actor = res.actor;
  const cap = res.capability;
  const picks = (leadIds ?? []).filter(Boolean);

  // Fresh outreach request.
  if (cap === "outreach") {
    if (picks.length) {
      const enq = await startOutreach(actor, { leadIds: picks });
      if ("error" in enq) return { messages: [...pre, ...res.messages, { who: actor.id, text: "I wasn't able to start that: " + enq.error }] };
      return { messages: [...pre, ...res.messages], job: { id: enq.jobId, kind: "outreach", agentId: actor.id } };
    }
    // no picks: ask who, unless "all" with at least one accepted lead.
    if (isAllRequest(message)) {
      const teamLeads = await listTeamLeadsForPicker(teamId);
      if (teamLeads.some((l) => l.review === "accepted")) {
        const enq = await startOutreach(actor, { all: true });
        if ("error" in enq) return { messages: [...pre, ...res.messages, { who: actor.id, text: "I wasn't able to start that: " + enq.error }] };
        return { messages: [...pre, ...res.messages], job: { id: enq.jobId, kind: "outreach", agentId: actor.id } };
      }
    }
    return { messages: [...pre, { who: actor.id, text: askWhoText(actor.name) }] };
  }

  // Scrape needs a target — ask before running a bare "find leads".
  if (cap === "scrape" && !scrapeHasTarget(message)) {
    return { messages: [...pre, { who: actor.id, text: askScrapeText() }] };
  }

  // Book-meeting is interactive: needs a lead (/lead pick) + a time. Ask for
  // whichever is missing; book immediately once both are known.
  if (cap === "book-meeting") {
    const bmPicks = (leadIds ?? []).filter(Boolean);
    if (!bmPicks.length) return { messages: [...pre, { who: actor.id, text: askMeetingWhoText() }] };
    return { messages: [...pre, ...(await resolveTimeAndBook(userId, actor, teamId, bmPicks, message))] };
  }

  // Other lead-consuming capabilities: approve picks (if any), pass leadIds.
  if (LEAD_CAPS.has(cap) && picks.length) {
    await setLeadReview(picks, "accepted");
  }
  const enq = await enqueueJob({
    agent: { id: actor.id, name: actor.name, role: actor.role, goal: actor.goal, task: actor.task },
    kind: cap, capabilities: actor.capabilities,
    target: intent.params.target ?? 10,
    instruction: cap === "scrape" ? message : undefined,
    leadIds: LEAD_CAPS.has(cap) && picks.length ? picks : undefined,
    batchSize: LEAD_CAPS.has(cap) && picks.length ? picks.length : undefined,
    // A team-chat scrape kicks off the autonomous chain (scrape → assess → …).
    pod: cap === "scrape" ? true : undefined,
    teamId: cap === "scrape" ? teamId : undefined,
  });
  if ("error" in enq) return { messages: [...pre, ...res.messages, { who: actor.id, text: "I wasn't able to start that: " + enq.error }] };
  return { messages: [...pre, ...res.messages], job: { id: enq.jobId, kind: cap, agentId: actor.id } };
}

export async function listTeamMessages(teamId: string): Promise<{ who: string; text: string }[]> {
  const s = await getSession();
  if (!s?.userId) return [];
  return _listTeamMessages(s.userId, teamId);
}
