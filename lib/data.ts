// Seed data + pure helpers ported verbatim from the v5 prototype.
import type { Agent, Team, StatusKey, StatusMeta, Chats } from "./types";

// No seed agents — every user builds their own workforce via the creation wizard
// (from the AGENT_TYPES presets in lib/agentTypes.ts). Typed empty array so every
// AGENTS_BASE consumer just iterates nothing.
export const AGENTS_BASE: Agent[] = [];

// No seed team instances — users create their own teams from the team TEMPLATES
// (TEAM_TEMPLATES in lib/agentTypes.ts, offered in the New Team modal). Kept as a
// typed empty array so every TEAMS_BASE consumer just iterates nothing.
export const TEAMS_BASE: Team[] = [];

const STATUS_META: Record<StatusKey, StatusMeta> = {
  working: { label: "Working", bg: "#E7F7EC", color: "#1B7A3D", dot: "#2FA45C" },
  waiting: { label: "Waiting", bg: "#FEF6E8", color: "#B45309", dot: "#F59E0B" },
  offline: { label: "Offline", bg: "#F4F4F5", color: "#71717A", dot: "#A1A1AA" },
  error: { label: "Error", bg: "#FEECEC", color: "#B91C1C", dot: "#EF4444" },
};
export function statusMeta(s: StatusKey): StatusMeta {
  return STATUS_META[s];
}

// No seed conversations — chats begin once the user creates agents/teams.
export function chatsInit(): Chats {
  return {};
}

export function aiReply(q: string, agent: { task: string; goal: string }): string {
  const l = q.toLowerCase();
  if (l.includes("working")) return "Right now: " + agent.task + ". I have 6 tasks queued after this — the next one is a follow-up pass on prospects who opened twice but didn't reply.";
  if (l.includes("summar")) return "Today so far: 23 emails sent (48% open), 4 replies, 1 meeting booked, and 12 new leads qualified. My reply rate is trending up 3% week-over-week. Biggest win: the Datadog meeting.";
  if (l.includes("conversion") || l.includes("dropping")) return "Conversion dipped 4% this week. Root cause looks like send-time: opens after 3pm ET convert 40% worse. I recommend shifting sends to 8–11am recipient-local. Want me to apply that?";
  if (l.includes("contact next") || l.includes("who should")) return "Top 3 to contact next, by fit + intent: 1) Marcus Webb, CTO @ Plaid (opened 3×), 2) Dana Liu, VP Data @ Ramp (visited pricing page), 3) Tom Okafor, Head of Eng @ Brex (replied to earlier thread). Shall I draft outreach for all three?";
  if (l.includes("follow-up") || l.includes("email")) return "Drafted 3 follow-up emails referencing each prospect's last touchpoint. They're in the Emails tab as drafts — approve or edit, and I'll send in the next window.";
  if (l.includes("hot") || l.includes("prospect")) return "Hottest prospects right now: Snowflake (reply, positive), Plaid (3 opens in 24h), and Ramp (pricing page visit). Snowflake is the one I'd move on today.";
  if (l.includes("strategy")) return "Proposed strategy: focus on 51-200 employee SaaS on AWS, lead with a cost-saving case study, 4-touch sequence over 10 days, book directly into your calendar. I can start with a 50-prospect pilot.";
  return 'Got it. I\'ve factored that in — my current goal is "' + agent.goal + '" and I\'m on pace. Anything specific you\'d like me to change about my approach?';
}
