"use server";
// The team group-chat orchestration entrypoint: mentions → intent → route →
// enqueue the real job. A job starts as needs_approval: the agent asks, and the
// chat's Proceed button (lib/pod/actions approveJob) or a typed "yes" starts it.
// A capability the agent runs on Auto (agent page) starts at once instead.
import { getSession } from "@/lib/auth/session";
import { membersOfTeam } from "@/lib/teams/membership";
import { agentInfo } from "@/lib/pod/orchestrate";
import { detectIntent } from "@/lib/ai/intent";
import { resolve, parseMentions, type ChatOutMsg } from "./orchestrate";
import { enqueueJob } from "@/lib/jobs/actions";
import { listTeamMessages as _listTeamMessages, insertTeamMessages, postJobOutcome, chatUnread } from "./teamMessages";
import { sinceLastUserMessage, stripMarkers, type StoredMsg } from "./thread";
import { listTeamLeadsForPicker, setLeadReview } from "@/lib/leads/store";
import { isAllRequest, askWhoText, askWhoAgainText, isAskWhoPrompt } from "./outreachTarget";
import { isAskScrapePrompt, pendingScrapeBrief, missingBriefFields, settleBrief, mergeBrief, askScrapeDetailsText, briefInstruction, scrapeAnswerFrom, scrapeAskText, type ScrapeBrief, askWhenText, askWhatTimeText, pendingMeeting, askMeetingWhoText, isAskMeetingWhoPrompt, bookedText } from "./clarify";
import { resolveTargetLeads } from "@/lib/ai/resolveLeads";
import { inAccountWorkspaces } from "@/lib/workspaces/scope";
import { briefFromRequest, readScrapeAnswer, lastScrapeBrief, withLastSearch } from "./scrapeBrief";
import { askText, askBookText, startText } from "@/lib/pod/summary";
import { approveStep, cancelStep, openApproval, createMeetingAsk } from "@/lib/pod/decisions";
import { readDecision } from "./yesNo";
import { parseMeetingTime, safeTimeZone, zonedDate, dayLabel } from "@/lib/ai/meetingTime";
import { bookMeeting, meetingSettings } from "@/lib/meetings/store";
import { and, eq, gte, sql } from "drizzle-orm";
import { getDb, isDbConfigured, messages } from "@/lib/db";
import { MAX_CHAT_MESSAGE_CHARS, DAILY_CHAT_MESSAGE_QUOTA, QUOTA_WINDOW_MS, MAX_SCRAPE_TARGET } from "@/lib/jobs/limits";

/** A job the client should follow now (kick the runner, wait for the outcome):
 *  one that started without an ask (Auto) or that a typed "yes" approved. */
export interface FollowJob { id: string; kind: string; pod: boolean }

export interface TeamChatResult {
  messages: ChatOutMsg[];
  follow?: FollowJob;
}

type Member = NonNullable<Awaited<ReturnType<typeof agentInfo>>>;

/** Whether the agent runs this capability without asking (Auto on its page). */
const runsAuto = (actor: Member, cap: string) => !!actor.auto?.includes(cap);

// The ⟦approve:…⟧ asks agents posted since the user's last message, newest first.
const APPROVE_RE = /⟦approve:([0-9a-f-]{36})⟧/;
const openAsks = (history: StoredMsg[]) =>
  sinceLastUserMessage(history).map((m) => m.text.match(APPROVE_RE)?.[1]).filter((id): id is string => !!id);

// Capabilities whose jobs consume specific leads (so /lead picks apply to them).
const LEAD_CAPS = new Set(["outreach", "research", "qualify", "proposal", "match"]);

/** Ask for whatever the scrape brief still misses (who, where, how many), or ask
 *  to run the scrape once it is complete. Shared by a fresh request and the reply
 *  to a question. A team-chat scrape starts the chain (scrape → assess → …). */
async function scrapeStep(actor: Member, teamId: string, brief: ScrapeBrief): Promise<TeamChatResult> {
  const b = settleBrief(brief);
  const missing = missingBriefFields(b);
  if (missing.length) return { messages: [{ who: actor.id, text: askScrapeDetailsText(b, missing, MAX_SCRAPE_TARGET) }] };
  const count = Math.min(b.count!, MAX_SCRAPE_TARGET);
  const auto = runsAuto(actor, "scrape");
  const enq = await enqueueJob({
    agent: { id: actor.id, name: actor.name, role: actor.role, goal: actor.goal, task: actor.task },
    kind: "scrape", capabilities: actor.capabilities, target: count, instruction: briefInstruction(b),
    pod: true, teamId, ask: !auto,
  });
  if ("error" in enq) return { messages: [{ who: actor.id, text: "I wasn't able to start that: " + enq.error }] };
  if (auto) return { messages: [{ who: actor.id, text: startText("scrape", enq.jobId) }], follow: { id: enq.jobId, kind: "scrape", pod: true } };
  return { messages: [{ who: actor.id, text: scrapeAskText(b, count, MAX_SCRAPE_TARGET, enq.jobId) }] };
}

/** Approve any picked leads, then ask to run an outreach job for the target (or
 *  start it, on Auto). Shared by the fresh-request gate and the pending-answer
 *  path. `pre` is a hand-off line to say first. */
async function askOutreach(actor: Member, teamId: string, target: { leadIds?: string[]; all?: boolean }, pre: ChatOutMsg[] = []): Promise<TeamChatResult> {
  const agent = { id: actor.id, name: actor.name, role: actor.role, goal: actor.goal, task: actor.task };
  const picks = target.leadIds?.length ? target.leadIds : null;
  if (picks) await setLeadReview(picks, "accepted");
  const ask = !runsAuto(actor, "outreach");
  const enq = await enqueueJob(picks
    ? { agent, kind: "outreach", capabilities: actor.capabilities, leadIds: picks, batchSize: picks.length, teamId, ask }
    : { agent, kind: "outreach", capabilities: actor.capabilities, teamId, ask });
  if ("error" in enq) return { messages: [...pre, { who: actor.id, text: "I wasn't able to start that: " + enq.error }] };
  if (!ask) return { messages: [...pre, { who: actor.id, text: startText("outreach", enq.jobId) }], follow: { id: enq.jobId, kind: "outreach", pod: false } };
  return { messages: [...pre, { who: actor.id, text: askText("outreach", picks ? picks.length : null, enq.jobId) }] };
}

/** Resolve `phrase` to a meeting time for `leadIds` and reply with one of three
 *  outcomes, each keeping the flow alive via the ⟦meet:…⟧ marker:
 *   - no usable date        → ask "when?"        (marker carries the lead ids)
 *   - a day but no clock time → ask "what time?" (marker also carries the date)
 *   - a full date + time     → ask Proceed/Cancel, and book on Proceed
 *                              (lib/pod/decisions). On Auto, book it now.
 *  Shared by the fresh request, the "who?" answer, and the "when/what time?" answers.
 *  `tz` is the user's IANA timezone: the phrase is read, and the window checked, in it. */
async function resolveTimeAndBook(userId: string, actor: Member, teamId: string, leadIds: string[], phrase: string, tz: string): Promise<ChatOutMsg[]> {
  await setLeadReview(leadIds, "accepted"); // picking = approving
  const teamLeads = await listTeamLeadsForPicker(teamId);
  const names = leadIds.map((id) => teamLeads.find((l) => l.id === id)?.name ?? "the lead").join(", ");
  const settings = await meetingSettings(userId, actor.id);
  const { iso, label, hasTime } = await parseMeetingTime(phrase, { ...settings, timeZone: tz });
  if (!iso) return [{ who: actor.id, text: askWhenText(names, leadIds) }];
  if (!hasTime) {
    // Format the day from the parsed date only. Never reuse `label`, which has
    // the defaulted placeholder time (e.g. "9:00–9:30 AM") we're asking to replace.
    // Both are taken in the user's timezone: iso is UTC, so its own date can be a day off.
    return [{ who: actor.id, text: askWhatTimeText(names, dayLabel(iso, tz), leadIds, zonedDate(iso, tz)) }];
  }
  const nameOf = (id: string) => teamLeads.find((l) => l.id === id)?.name ?? "the lead";
  if (!runsAuto(actor, "book-meeting")) {
    const jobId = await createMeetingAsk(userId, { id: actor.id, name: actor.name }, {
      teamId, leadIds, names: Object.fromEntries(leadIds.map((id) => [id, nameOf(id)])), iso, label, type: settings.type,
    });
    if (!jobId) return [{ who: actor.id, text: "I wasn't able to set up that meeting. Please try again." }];
    return [{ who: actor.id, text: askBookText(settings.type, names, label, jobId) }];
  }
  // Report only what bookMeeting actually booked. It refuses a lead that is not the user's.
  const booked: string[] = [];
  for (const id of leadIds) if (await bookMeeting(userId, actor.id, id, iso, label, settings.type)) booked.push(id);
  return [{ who: actor.id, text: bookedText(settings.type, label, leadIds.map(nameOf), booked.map(nameOf)) }];
}

/** Handle one user message in a team thread. Both the user's message and the
 *  agents' replies are stored here, on the server, in that order. Thus the thread
 *  in the DB is complete even if the tab closes, and the client only renders it.
 *  Returns the stored replies (with ids) and any job to follow. */
export async function teamChat(teamId: string, message: string, leadIds?: string[], timeZone?: string): Promise<TeamChatResult> {
  const s = await getSession();
  const userId = s?.userId;
  if (!userId) return { messages: [{ who: "system", text: "Not signed in." }] };
  const text = (message || "").trim();
  if (!text) return { messages: [] };
  // Each message goes to the intent model, so an over-long one is refused, and so
  // is any past the daily cap. Neither is stored; the client shows the notice locally.
  if (text.length > MAX_CHAT_MESSAGE_CHARS) {
    return { messages: [{ who: "system", text: `That message is too long. Keep it under ${MAX_CHAT_MESSAGE_CHARS} characters.` }] };
  }
  if ((await sentToday(s.accountId)) >= DAILY_CHAT_MESSAGE_QUOTA) {
    return { messages: [{ who: "system", text: `You've reached today's limit of ${DAILY_CHAT_MESSAGE_QUOTA} messages. Try again tomorrow.` }] };
  }

  // Read the context before storing this message, so "since the user's last
  // message" means since the previous one.
  const history = await _listTeamMessages(userId, teamId);
  // A clear yes/no while an agent's "Proceed?" is open works as the button.
  const decision = readDecision(text);
  const asked = decision ? await openApproval(userId, openAsks(history)) : null;
  const [mine] = await insertTeamMessages(userId, teamId, [{ who: "me", text }]);
  if (decision && asked) {
    // The step posts the agent's reply ("starting now", or the cancel summary).
    const r = decision === "yes" ? await approveStep(userId, asked) : await cancelStep(userId, asked, mine?.id);
    if ("error" in r) return { messages: await insertTeamMessages(userId, teamId, [{ who: "system", text: r.error }]) };
    return { messages: [], follow: decision === "yes" && r.kind ? { id: asked, kind: r.kind, pod: r.pod } : undefined };
  }
  const res = await reply(userId, teamId, text, leadIds, history, safeTimeZone(timeZone));
  if (!res.messages.length) res.messages.push({ who: "system", text: "No one picked that up. Try @mentioning an agent on this team." });
  return { ...res, messages: await insertTeamMessages(userId, teamId, res.messages) };
}

/** Messages the account has sent, in any chat of any of its workspaces, in the quota window. */
async function sentToday(accountId: string): Promise<number> {
  if (!isDbConfigured()) return 0;
  const [r] = await getDb().select({ n: sql<number>`count(*)::int` }).from(messages)
    .where(and(inAccountWorkspaces(messages.userId, accountId), eq(messages.who, "me"), gte(messages.createdAt, new Date(Date.now() - QUOTA_WINDOW_MS))));
  return Number(r?.n ?? 0);
}

async function reply(userId: string, teamId: string, message: string, leadIds: string[] | undefined, history: StoredMsg[], tz: string): Promise<TeamChatResult> {
  const memberIds = await membersOfTeam(userId, teamId);
  const members = (await Promise.all(memberIds.map((id) => agentInfo(userId, id)))).filter(Boolean) as Member[];
  const byId = new Map(members.map((m) => [m.id, m] as const));

  // Conversation context from the stored thread: the last agent to speak
  // (continuity), and the open clarifying question, if any. The question is the
  // newest member prompt since the user's last message, so pod narration posted
  // in between doesn't close it. Only member rows count. The user cannot write
  // an agent row (appendMessages takes "me" only), so markers can't be forged.
  let lastSpeaker: Member | undefined;
  for (let i = history.length - 1; i >= 0 && !lastSpeaker; i--) lastSpeaker = byId.get(history[i].who);
  let pendingAgent: Member | undefined;
  let pendingScrape: { agent: Member; brief: ScrapeBrief } | null = null;
  let pendingMeet: { agent: Member; leadIds: string[]; date?: string } | null = null;
  let pendingMeetingWho: Member | undefined;
  // An open question can come from an agent on another team: the chat sends a
  // request across teams when no member can do it. Look those agents up too.
  const speakers = new Map(byId);
  for (const m of sinceLastUserMessage(history)) {
    if (m.who === "me" || m.who === "system" || speakers.has(m.who)) continue;
    const info = await agentInfo(userId, m.who);
    if (info) speakers.set(m.who, info);
  }
  for (const m of sinceLastUserMessage(history)) {
    const spk = speakers.get(m.who);
    if (!spk) continue;
    const meet = spk.capabilities.includes("book-meeting") ? pendingMeeting(m.text) : null;
    if (spk.capabilities.includes("outreach") && isAskWhoPrompt(m.text, spk.name)) pendingAgent = spk;
    else if (spk.capabilities.includes("scrape") && (pendingScrapeBrief(m.text) || isAskScrapePrompt(m.text))) pendingScrape = { agent: spk, brief: pendingScrapeBrief(m.text) ?? { asked: 1 } };
    else if (meet) pendingMeet = { agent: spk, ...meet };
    else if (spk.capabilities.includes("book-meeting") && isAskMeetingWhoPrompt(m.text)) pendingMeetingWho = spk;
    else continue;
    break;
  }

  // The agent's last line lets a short reply ("yes") be read as an answer to it.
  const lastAgent = [...history].reverse().find((m) => m.who !== "me" && m.who !== "system");
  const intent = await detectIntent(message, members.map((m) => ({ name: m.name, capabilities: m.capabilities })), lastAgent ? stripMarkers(lastAgent.text) : undefined);
  const mentions = parseMentions(message, members);

  // Pending meeting time: the Meeting agent asked "when?" or "what time?". This
  // unmentioned reply is the answer. When a day is already known (the marker
  // carries it), prepend it so a bare "2pm" lands on that day. resolveTimeAndBook
  // books, or re-asks for whichever detail is still missing.
  if (pendingMeet && mentions.length === 0 && (intent.capability === "chat" || intent.capability === "unknown" || intent.capability === "book-meeting")) {
    const phrase = pendingMeet.date ? `${pendingMeet.date} ${message}` : message;
    return { messages: await resolveTimeAndBook(userId, pendingMeet.agent, teamId, pendingMeet.leadIds, phrase, tz) };
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
    return { messages: await resolveTimeAndBook(userId, a, teamId, ids, message, tz) };
  }

  // Pending scrape details: the agent asked who, where or how many, and this is an
  // unmentioned reply that isn't a different command → read it as the answer. It
  // starts the scrape, or asks for what is still missing.
  if (pendingScrape && mentions.length === 0 && (intent.capability === "scrape" || intent.capability === "chat" || intent.capability === "unknown")) {
    const { agent, brief } = pendingScrape;
    // The question card sends exact values. A typed reply is parsed.
    const answer = scrapeAnswerFrom(message) ?? await readScrapeAnswer(message, brief, missingBriefFields(brief));
    return scrapeStep(agent, teamId, mergeBrief(brief, answer));
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
    return askOutreach(pendingAgent, teamId, target);
  }

  const res = await resolve(userId, teamId, message, intent, { lastSpeakerId: lastSpeaker?.id, history });
  // The rerouting agent (e.g. the mentioned Assessor) speaks first; prepend its
  // line to whatever the capable actor replies, including a clarifying question,
  // which used to be returned alone and dropped the hand-off.
  const pre = res.handoff ?? [];
  if (!res.actor || !res.capability) return { messages: [...pre, ...res.messages] };
  const actor = res.actor;
  const cap = res.capability;
  const picks = (leadIds ?? []).filter(Boolean);

  // Fresh outreach request. The ask replaces actWith's "I'm drafting outreach now".
  if (cap === "outreach") {
    if (picks.length) return askOutreach(actor, teamId, { leadIds: picks }, pre);
    // no picks: ask who, unless "all" with at least one accepted lead.
    if (isAllRequest(message)) {
      const teamLeads = await listTeamLeadsForPicker(teamId);
      if (teamLeads.some((l) => l.review === "accepted")) return askOutreach(actor, teamId, { all: true }, pre);
    }
    return { messages: [...pre, { who: actor.id, text: askWhoText(actor.name) }] };
  }

  // A scrape needs who, where and how many. Ask for what is missing before it runs.
  if (cap === "scrape") {
    // A card answer with no open question (a stale card) still gives the place and count.
    const asked = mergeBrief(briefFromRequest(message, intent.params), scrapeAnswerFrom(message) ?? {});
    const step = await scrapeStep(actor, teamId, withLastSearch(asked, message, await lastScrapeBrief(userId, teamId)));
    return { ...step, messages: [...pre, ...step.messages] };
  }

  // Book-meeting is interactive: needs a lead (/lead pick) + a time. Ask for
  // whichever is missing; book immediately once both are known.
  if (cap === "book-meeting") {
    const bmPicks = (leadIds ?? []).filter(Boolean);
    if (!bmPicks.length) return { messages: [...pre, { who: actor.id, text: askMeetingWhoText() }] };
    return { messages: [...pre, ...(await resolveTimeAndBook(userId, actor, teamId, bmPicks, message, tz))] };
  }

  // Other lead-consuming capabilities: approve picks (if any), pass leadIds.
  if (LEAD_CAPS.has(cap) && picks.length) {
    await setLeadReview(picks, "accepted");
  }
  const auto = runsAuto(actor, cap);
  const enq = await enqueueJob({
    agent: { id: actor.id, name: actor.name, role: actor.role, goal: actor.goal, task: actor.task },
    kind: cap, capabilities: actor.capabilities,
    target: intent.params.target ?? 10,
    leadIds: LEAD_CAPS.has(cap) && picks.length ? picks : undefined,
    batchSize: LEAD_CAPS.has(cap) && picks.length ? picks.length : undefined,
    teamId, ask: !auto,
  });
  if ("error" in enq) return { messages: [...pre, { who: actor.id, text: "I wasn't able to start that: " + enq.error }] };
  if (auto) return { messages: [...pre, { who: actor.id, text: startText(cap, enq.jobId) }], follow: { id: enq.jobId, kind: cap, pod: false } };
  return { messages: [...pre, { who: actor.id, text: askText(cap, LEAD_CAPS.has(cap) && picks.length ? picks.length : null, enq.jobId) }] };
}

/** The thread rows after `afterId` (all of them for 0), oldest first. */
export async function listTeamMessages(teamId: string, afterId = 0): Promise<StoredMsg[]> {
  const s = await getSession();
  if (!s?.userId) return [];
  return _listTeamMessages(s.userId, teamId, afterId);
}

/** Unread agent messages per conversation for the sidebar. `seen` is the last
 *  message id the user saw in each conversation. It comes from the client, so
 *  keep only plain conversation ids and valid row ids. */
export async function listChatUnread(seen: Record<string, number>): Promise<Record<string, { lastId: number; unread: number }>> {
  const s = await getSession();
  if (!s?.userId) return {};
  const clean: Record<string, number> = {};
  for (const [id, n] of Object.entries(seen ?? {}).slice(0, 500)) {
    if (/^[\w-]{1,64}$/.test(id) && Number.isSafeInteger(n) && n >= 0 && n <= 2147483647) clean[id] = n;
  }
  return chatUnread(s.userId, clean);
}

/** Post a job's outcome into the thread once it has ended (idempotent), and
 *  return the job's status so the caller knows whether to keep waiting. */
export async function reportTeamJob(teamId: string, jobId: string): Promise<string | null> {
  const s = await getSession();
  if (!s?.userId) return null;
  return postJobOutcome(s.userId, teamId, jobId);
}
