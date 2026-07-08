// Seed data + pure helpers ported verbatim from the v5 prototype.
import type { Agent, Team, StatusKey, StatusMeta, Chats } from "./types";

export const AGENTS_BASE: Agent[] = [
  { id: "sk", name: "Sarah Kim", initials: "SK", role: "SDR", color: "#5122C1", status: "working", task: "Booking meetings with Fintech CTOs", score: 94, goal: "Book 30 meetings / month", type: "sdr", capabilities: ["scrape", "outreach", "follow-up"] },
  { id: "mt", name: "Michael Torres", initials: "MT", role: "BDR", color: "#0EA5E9", status: "working", task: "Sending personalized outreach — Fintech segment", score: 88, goal: "120 personalized emails / week", type: "bdr", capabilities: ["outreach", "follow-up"] },
  { id: "ew", name: "Emily Watson", initials: "EW", role: "SDR", color: "#2FA45C", status: "working", task: "Discovering Healthcare ICP leads", score: 91, goal: "200 qualified leads / month", type: "sdr", capabilities: ["scrape", "outreach", "follow-up"] },
  { id: "rp", name: "Ryan Patel", initials: "RP", role: "Account Executive", color: "#F43F7E", status: "waiting", task: "Awaiting approval on Snowflake proposal", score: 86, goal: "$500K pipeline / quarter", type: "ae", capabilities: ["outreach", "book-meeting"] },
  { id: "al", name: "Ava Lindqvist", initials: "AL", role: "SDR", color: "#F59E0B", status: "working", task: "Following up with Snowflake reply", score: 90, goal: "25% reply rate", type: "sdr", capabilities: ["scrape", "outreach", "follow-up"] },
  { id: "nc", name: "Noah Chen", initials: "NC", role: "Sales Manager", color: "#8B5CF6", status: "working", task: "Reviewing team pipeline for Q3", score: 83, goal: "Keep team above 85 score", type: "manager", capabilities: [] },
  { id: "ps", name: "Priya Sharma", initials: "PS", role: "Customer Success", color: "#14B8A6", status: "offline", task: "Idle — next shift at 6:00pm", score: 79, goal: "NPS 60+ across accounts", type: "csm", capabilities: ["follow-up"] },
  { id: "lm", name: "Leo Martins", initials: "LM", role: "Recruiter", color: "#EF4444", status: "error", task: "LinkedIn connection failed — needs reauth", score: 72, goal: "15 qualified candidates / month", type: "recruiter", capabilities: ["scrape", "outreach"] },
];

export const TEAMS_BASE: Team[] = [
  { id: "t1", name: "North America SDR", icon: "🌎", iconBg: "#F1EDFD", desc: "Outbound prospecting · US & Canada", members: ["sk", "ew", "al"], meetings: 28, pipeline: "$1.1M", leads: 412, goal: "Book 90 meetings this quarter across the NA territory, prioritizing companies on AWS.", activity: ["Sarah booked Datadog — VP Eng", "Ava flagged Snowflake as hot", "Emily added 35 Healthcare leads"], template: "outbound" },
  { id: "t2", name: "Enterprise Team", icon: "🏛", iconBg: "#FDF0F5", desc: "Named accounts · $100K+ deals", members: ["rp", "nc"], meetings: 9, pipeline: "$860K", leads: 64, goal: "Land 3 enterprise logos this quarter with multi-threaded outreach.", activity: ["Ryan drafted Snowflake proposal", "Noah reviewed Q3 pipeline"], template: "enterprise" },
  { id: "t3", name: "Outbound Team", icon: "📣", iconBg: "#FEF6E8", desc: "High-volume sequences", members: ["mt", "sk", "al"], meetings: 19, pipeline: "$390K", leads: 1230, goal: "Maintain 25%+ reply rate while scaling to 600 emails/week.", activity: ["Michael sent 12 emails to Fintech CTOs", "Sequence B reply rate hit 27%"], template: "outbound" },
  { id: "t4", name: "Recruitment Team", icon: "🎯", iconBg: "#E9F5FE", desc: "Sourcing sales talent", members: ["lm"], meetings: 6, pipeline: "—", leads: 88, goal: "15 qualified AE candidates per month.", activity: ["Leo needs LinkedIn reauth", "4 candidate screens scheduled"], template: "recruitment" },
];

const STATUS_META: Record<StatusKey, StatusMeta> = {
  working: { label: "Working", bg: "#E7F7EC", color: "#1B7A3D", dot: "#2FA45C" },
  waiting: { label: "Waiting", bg: "#FEF6E8", color: "#B45309", dot: "#F59E0B" },
  offline: { label: "Offline", bg: "#F4F4F5", color: "#71717A", dot: "#A1A1AA" },
  error: { label: "Error", bg: "#FEECEC", color: "#B91C1C", dot: "#EF4444" },
};
export function statusMeta(s: StatusKey): StatusMeta {
  return STATUS_META[s];
}

export function chatsInit(): Chats {
  return {
    sk: [{ who: "ai", text: "Morning! I booked a meeting with Datadog's VP Eng for Thursday 2pm. I'm now working through the Fintech CTO list — 14 left to contact today." }],
    rp: [{ who: "ai", text: "The Snowflake proposal draft is ready for your review. I estimated $180K ARR based on their seat count. Want me to walk you through it?" }],
    ew: [{ who: "ai", text: "Found 35 new Healthcare leads matching the ICP this morning. 9 of them use AWS — should I prioritize those for Sarah's sequence?" }],
    mt: [{ who: "ai", text: "Sequence B is outperforming: 27% reply rate vs 19% for Sequence A. I suggest shifting the remaining Fintech contacts to B." }],
  };
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
