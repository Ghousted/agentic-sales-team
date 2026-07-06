// Per-agent detail model for the agent-detail sub-tabs (Leads, Emails, Reach
// Outs, Tasks, Performance, Memory). No real outreach data exists yet, so this
// derives agent-specific, internally-consistent content deterministically from
// the agent's own attributes (id → seed, role/task → segment, score/status →
// volumes). Same agent → same output across reloads; different agents differ.
import type { Agent } from "./types";
import { fmtMoney } from "./data";

export interface Lead {
  name: string; title: string; company: string; status: string; score: number; last: string; campaign: string;
}
export interface TimelineItem { type: string; subject: string; to: string; time: string; c: [string, string]; }
export interface ReachItem { type: string; title: string; desc: string; time: string; c: [string, string]; }
export interface TaskItem { status: string; title: string; sub: string; time: string; bg: string; fg: string; dot: string; }
export interface MemoryCard { icon: string; title: string; bg: string; items: string[]; }

export interface AgentDetailModel {
  summary: string;
  overviewStats: [string, string][];
  accomplishments: string[];
  nextActions: string[];
  goals: string[];
  leadTitle: string;
  leads: Lead[];
  leadStatusColors: Record<string, [string, string]>;
  emailStats: [string, string][];
  emailTimeline: TimelineItem[];
  reach: ReachItem[];
  tasks: TaskItem[];
  kpis: [string, string, string][];
  weekVals: number[];
  heat: number[];
  memory: MemoryCard[];
}

type Segment = "fintech" | "healthcare" | "enterprise" | "recruiting" | "success" | "management" | "general";

// ---- deterministic PRNG seeded by the agent id ----
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function rotate<T>(arr: T[], by: number): T[] {
  const n = arr.length;
  return arr.map((_, i) => arr[(i + by) % n]);
}

const STATUS_COLORS: Record<string, [string, string]> = {
  // sales pipeline
  New: ["#F4F4F5", "#71717A"], Contacted: ["#FEF6E8", "#B45309"], Engaged: ["#E9F5FE", "#0369A1"],
  Replied: ["#E7F7EC", "#1B7A3D"], Meeting: ["#F1EDFD", "#5122C1"],
  // recruiting
  Sourced: ["#F4F4F5", "#71717A"], Screening: ["#FEF6E8", "#B45309"], Interview: ["#E9F5FE", "#0369A1"], Offer: ["#F1EDFD", "#5122C1"],
  // success
  Onboarding: ["#FEF6E8", "#B45309"], Healthy: ["#E7F7EC", "#1B7A3D"], Renewal: ["#F1EDFD", "#5122C1"], "At risk": ["#FEECEC", "#B91C1C"],
  // management (agent statuses)
  Working: ["#E7F7EC", "#1B7A3D"], Waiting: ["#FEF6E8", "#B45309"], Offline: ["#F4F4F5", "#71717A"], Error: ["#FEECEC", "#B91C1C"],
};

const PROSPECTS: Record<Segment, { name: string; title: string; company: string }[]> = {
  fintech: [
    { name: "Marcus Webb", title: "CTO", company: "Plaid" }, { name: "Dana Liu", title: "VP Data", company: "Ramp" },
    { name: "Tom Okafor", title: "Head of Eng", company: "Brex" }, { name: "Ines Ferreira", title: "CTO", company: "Mercury" },
    { name: "Grace Nakamura", title: "CIO", company: "Chime" }, { name: "Owen Bradley", title: "VP Eng", company: "Marqeta" },
    { name: "Lena Fischer", title: "Head of Data", company: "Stripe" }, { name: "Raj Malhotra", title: "CTO", company: "Dave" },
  ],
  healthcare: [
    { name: "Alan Pierce", title: "CIO", company: "Oscar Health" }, { name: "Nina Alvarez", title: "VP Engineering", company: "Cedar" },
    { name: "Kevin Zhou", title: "Head of Data", company: "Ro" }, { name: "Sophia Martins", title: "CTO", company: "Included Health" },
    { name: "Derek Ellis", title: "VP Product", company: "Hinge Health" }, { name: "Maya Rana", title: "CIO", company: "Komodo Health" },
    { name: "Paul Nguyen", title: "Head of Eng", company: "Cerebral" },
  ],
  enterprise: [
    { name: "Sam Whitfield", title: "VP Eng", company: "Datadog" }, { name: "Carla Mendes", title: "SVP Platform", company: "Snowflake" },
    { name: "Ben Cohen", title: "CTO", company: "Databricks" }, { name: "Aisha Bello", title: "VP Data", company: "Confluent" },
    { name: "Victor Hale", title: "Head of Infra", company: "HashiCorp" }, { name: "Priya Kapoor", title: "VP Eng", company: "MongoDB" },
  ],
  recruiting: [
    { name: "Jordan Ellis", title: "Senior AE · 7 yrs SaaS", company: "from Gong" }, { name: "Mia Santos", title: "SDR Lead", company: "from Outreach" },
    { name: "Caleb Ward", title: "Enterprise AE", company: "from Snowflake" }, { name: "Hana Kim", title: "Sales Engineer", company: "from Datadog" },
    { name: "Diego Reyes", title: "Mid-Market AE", company: "from HubSpot" }, { name: "Fiona Walsh", title: "BDR", company: "from Salesloft" },
  ],
  success: [
    { name: "Acme Robotics", title: "Champion · VP Ops", company: "Enterprise · $84K ARR" }, { name: "Northwind Labs", title: "Admin · Platform Lead", company: "Growth · $31K ARR" },
    { name: "BlueOrbit", title: "Champion · CTO", company: "Enterprise · $120K ARR" }, { name: "Cedar & Co", title: "Admin · Ops Manager", company: "Mid · $22K ARR" },
    { name: "Vertex Media", title: "Champion · Head of RevOps", company: "Growth · $47K ARR" },
  ],
  management: [],
  general: [
    { name: "Marcus Webb", title: "CTO", company: "Plaid" }, { name: "Sam Whitfield", title: "VP Eng", company: "Datadog" },
    { name: "Nina Alvarez", title: "VP Engineering", company: "Cedar" }, { name: "Ben Cohen", title: "CTO", company: "Databricks" },
    { name: "Dana Liu", title: "VP Data", company: "Ramp" }, { name: "Owen Bradley", title: "VP Eng", company: "Marqeta" },
  ],
};

interface SegMeta {
  leadTitle: string; emailNoun: string; meetingNoun: string; campaign: string; vocab: string[];
  segLabel: string;
}
const SEG_META: Record<Segment, SegMeta> = {
  fintech: { leadTitle: "Leads", emailNoun: "emails", meetingNoun: "meeting", campaign: "Fintech CTO · Seq", vocab: ["New", "Contacted", "Engaged", "Replied", "Meeting"], segLabel: "Fintech" },
  healthcare: { leadTitle: "Leads", emailNoun: "emails", meetingNoun: "meeting", campaign: "Healthcare ICP · Seq", vocab: ["New", "Contacted", "Engaged", "Replied", "Meeting"], segLabel: "Healthcare" },
  enterprise: { leadTitle: "Accounts", emailNoun: "emails", meetingNoun: "meeting", campaign: "Enterprise · Named", vocab: ["New", "Contacted", "Engaged", "Replied", "Meeting"], segLabel: "Enterprise" },
  recruiting: { leadTitle: "Candidates", emailNoun: "outreach messages", meetingNoun: "screen", campaign: "Sales talent · Pipeline", vocab: ["Sourced", "Screening", "Interview", "Offer"], segLabel: "Recruiting" },
  success: { leadTitle: "Accounts", emailNoun: "check-ins", meetingNoun: "review", campaign: "Account health", vocab: ["Onboarding", "Healthy", "Renewal", "At risk"], segLabel: "Customer Success" },
  management: { leadTitle: "Team", emailNoun: "updates", meetingNoun: "1:1", campaign: "Team oversight", vocab: ["Working", "Waiting", "Offline", "Error"], segLabel: "Management" },
  general: { leadTitle: "Leads", emailNoun: "emails", meetingNoun: "meeting", campaign: "Outbound · Seq", vocab: ["New", "Contacted", "Engaged", "Replied", "Meeting"], segLabel: "Outbound" },
};

const LASTS = ["2m ago", "1h ago", "3h ago", "5h ago", "1d ago", "2d ago", "—"];

function segmentOf(a: Agent): Segment {
  const role = a.role.toLowerCase();
  const hay = (a.task + " " + a.goal).toLowerCase();
  if (role.includes("recruit")) return "recruiting";
  if (role.includes("customer success") || role.includes("success")) return "success";
  if (role.includes("manager")) return "management";
  if (hay.includes("healthcare")) return "healthcare";
  if (hay.includes("fintech")) return "fintech";
  if (role.includes("account executive")) return "enterprise";
  return "general";
}

function clamp(n: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, n)); }
function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }

export function buildAgentDetail(agent: Agent, opts: { paused: boolean; userName: string; roster: Agent[] }): AgentDetailModel {
  const seg = segmentOf(agent);
  const meta = SEG_META[seg];
  const rnd = mulberry32(hashStr(agent.id));
  const off = hashStr(agent.id) % 7;
  const status = opts.paused ? "waiting" : agent.status;
  const activeMult = status === "working" ? 1 : status === "waiting" ? 0.5 : status === "error" ? 0.3 : 0.15;
  const score = agent.score;
  const firstName = agent.name.split(" ")[0];
  const userFirst = (opts.userName || "You").split(" ")[0];

  // ---- volumes derived from score + status ----
  const emailsToday = Math.max(0, Math.round((6 + (score % 18)) * activeMult));
  const openRate = Math.round(38 + (score / 100) * 24);
  const replyRate = 0.12 + (score / 100) * 0.16;
  const replies = Math.round(emailsToday * replyRate);
  const meetingsToday = status === "working" && score >= 88 ? 1 : 0;

  // ---- leads / candidates / accounts / team ----
  let leads: Lead[];
  if (seg === "management") {
    leads = opts.roster.filter((a) => a.id !== agent.id).slice(0, 6).map((a) => ({
      name: a.name, title: a.role, company: firstName + "’s team", status: cap(a.status), score: a.score,
      last: a.status === "working" ? "live" : LASTS[a.score % LASTS.length], campaign: a.task.slice(0, 28),
    }));
  } else {
    const pool = rotate(PROSPECTS[seg], off).slice(0, 6);
    leads = pool.map((p, i) => ({
      name: p.name, title: p.title, company: p.company,
      status: meta.vocab[(off + i) % meta.vocab.length],
      score: clamp(score - 8 + Math.floor(rnd() * 20), 52, 99),
      last: LASTS[(off + i) % LASTS.length],
      campaign: meta.campaign + " " + (i % 2 ? "A" : "B"),
    }));
  }

  // ---- emails ----
  const sent = Math.round((score * 3 + 40) * Math.max(0.4, activeMult));
  const drafted = 4 + Math.floor(rnd() * 12);
  const opened = Math.round((sent * openRate) / 100);
  const clicked = Math.round(opened * 0.32);
  const repliesTotal = Math.round(sent * replyRate);
  const emailStats: [string, string][] = [
    ["Drafted", String(drafted)], ["Sent", String(sent)], ["Opened", String(opened)], ["Clicked", String(clicked)], ["Replies", String(repliesTotal)],
  ];
  const tlTypes: [string, [string, string]][] = [
    ["Sent", STATUS_COLORS.Engaged], ["Reply", STATUS_COLORS.Replied], ["Opened", STATUS_COLORS.Contacted], ["Draft", STATUS_COLORS.New], ["Sent", STATUS_COLORS.Engaged],
  ];
  const subjectFor = (l: Lead, i: number): string => {
    if (seg === "recruiting") return ["Exciting AE role — quick chat?", "Following up on your background", "Loved your Salesloft numbers", "Next step: 30-min screen", "Intro from a mutual connection"][i % 5];
    if (seg === "success") return ["Your Q3 usage snapshot", "Quick check-in before renewal", "New feature that fits " + l.name, "Health review — 15 min?", "Expanding seats for " + l.name][i % 5];
    if (seg === "management") return ["Weekly pipeline review", "Coaching notes for the team", "Q3 target pacing", "Reassigning Fintech accounts", "1:1 agenda"][i % 5];
    return ["Quick idea for " + l.company + "’s data costs", "Re: cutting warehouse spend 30%", "How teams like " + l.company + " scale", "Following up on last week", "Saw your re:Invent talk"][i % 5];
  };
  const emailTimeline: TimelineItem[] = tlTypes.map(([type, c], i) => {
    const l = leads[i % leads.length];
    return { type, subject: subjectFor(l, i), to: l.name + " · " + l.company, time: ["Today 9:40a", "Today 8:15a", "Yesterday 4:02p", "Yesterday 2:30p", "Mon 10:12a"][i], c };
  });

  // ---- reach outs ----
  const reachTypes: Record<Segment, string[]> = {
    recruiting: ["Screen Booked", "Sourced", "InMail", "Follow-up", "Phone Screen", "Sourced"],
    success: ["QBR Booked", "Check-in Email", "Renewal Call", "Follow-up", "Health Alert", "Check-in Email"],
    management: ["1:1 Booked", "Team Update", "Pipeline Review", "Coaching Note", "Escalation", "Team Update"],
    fintech: ["Meeting Booked", "Cold Email", "LinkedIn", "Follow-up", "Phone Call", "Cold Email"],
    healthcare: ["Meeting Booked", "Cold Email", "LinkedIn", "Follow-up", "Phone Call", "Cold Email"],
    enterprise: ["Meeting Booked", "Cold Email", "LinkedIn", "Follow-up", "Phone Call", "Cold Email"],
    general: ["Meeting Booked", "Cold Email", "LinkedIn", "Follow-up", "Phone Call", "Cold Email"],
  };
  const reachColors: [string, string][] = [STATUS_COLORS.Meeting, STATUS_COLORS.Engaged, STATUS_COLORS.Contacted, ["#FDF0F5", "#DB2777"], STATUS_COLORS.Replied, STATUS_COLORS.Engaged];
  const reachTimes = ["Today 9:12a", "Today 8:40a", "Yesterday 5:20p", "Yesterday 11:05a", "Mon 3:45p", "Mon 9:00a"];
  const reach: ReachItem[] = reachTypes[seg].map((type, i) => {
    const l = leads[i % leads.length];
    return { type, title: l.company + " — " + l.name + " (" + l.title + ")", desc: reachDesc(seg, l, i), time: reachTimes[i], c: reachColors[i % reachColors.length] };
  });

  // ---- tasks (first entry is the agent's real current task, colored by status) ----
  const tasks: TaskItem[] = [firstTask(agent, status)];
  const extra = taskPool(seg, meta);
  for (let i = 0; i < 4; i++) {
    const stg = i === 0 && status === "working" ? "Running" : i === 3 ? "Failed" : i === 2 ? "Completed" : "Pending";
    if (stg === "Running" && status !== "working") continue;
    tasks.push(makeTask(stg, extra[(off + i) % extra.length]));
  }

  // ---- performance KPIs from score ----
  const kpis: [string, string, string][] = [
    [seg === "recruiting" ? "Offer rate" : seg === "success" ? "Retention" : "Lead conversion", (score / (seg === "success" ? 1.02 : 11.5)).toFixed(1) + "%", "▲ " + (0.5 + (score % 5) / 3).toFixed(1) + "%"],
    ["Response rate", Math.round(replyRate * 100) + "%", "▲ " + (1 + (score % 4)) + "%"],
    [seg === "recruiting" ? "Screen rate" : seg === "success" ? "NPS" : "Meeting rate", seg === "success" ? String(40 + (score % 40)) : (score / 22).toFixed(1) + "%", "▲ " + (0.3 + (score % 3) / 5).toFixed(1)],
    ["Pipeline", fmtMoney(30000 + score * 4200 + (hashStr(agent.id) % 60000)), "▲ " + fmtMoney(8000 + (score % 40) * 900)],
  ];

  const weekVals = Array.from({ length: 7 }, (_, i) => clamp(Math.round((20 + rnd() * 75) * (i >= 5 ? 0.35 : 1) * Math.max(0.5, activeMult)), 5, 96));
  const heat = Array.from({ length: 48 }, () => Math.min(5, Math.floor(rnd() * 6 * (status === "offline" ? 0.6 : status === "error" ? 0.8 : 1))));

  // ---- overview text ----
  const paceWord = status === "working" ? (score >= 88 ? "ahead of pace" : "on pace") : status === "error" ? "blocked" : status === "waiting" ? "waiting on you" : "off shift";
  const statusLine = status === "working" ? "Reply rate is trending up 3% week-over-week." : status === "error" ? "Blocked — an integration failed and needs a quick fix." : status === "waiting" ? "Paused pending your approval to continue." : "Offline right now; resumes next shift.";
  const summary = agent.name + " is " + paceWord + " this month. Today: " + emailsToday + " " + meta.emailNoun + " sent with a " + openRate + "% open rate, " + replies + " repl" + (replies === 1 ? "y" : "ies") + ", and " + meetingsToday + " " + meta.meetingNoun + (meetingsToday === 1 ? "" : "s") + " booked. " + statusLine + " Current focus: " + agent.task.toLowerCase() + ".";

  const emailLabel = seg === "recruiting" ? "Messages today" : seg === "success" ? "Check-ins today" : "Emails today";
  const meetLabel = seg === "recruiting" ? "Screens booked" : seg === "success" ? "Reviews booked" : "Meetings booked";
  const overviewStats: [string, string][] = [[emailLabel, String(emailsToday)], ["Replies", String(replies)], [meetLabel, String(meetingsToday)]];

  const accomplishments = accomplishmentsFor(seg, leads, firstName);
  const nextActions = nextActionsFor(seg, leads, agent);
  const goals = goalsFor(agent, meta);
  const memory = memoryFor(seg, meta, leads, userFirst);

  return {
    summary, overviewStats, accomplishments, nextActions, goals,
    leadTitle: meta.leadTitle, leads, leadStatusColors: STATUS_COLORS,
    emailStats, emailTimeline, reach, tasks, kpis, weekVals, heat, memory,
  };
}

function reachDesc(seg: Segment, l: Lead, i: number): string {
  if (seg === "recruiting") return ["30-min screen scheduled · panel briefed", "Sourced from LinkedIn · strong SaaS background", "Connection accepted · sent role one-pager", "3rd touch · referenced their quota attainment", "Left voicemail with hiring manager"][i % 5];
  if (seg === "success") return ["QBR booked · usage deck drafted", "Checked in on adoption of new module", "Renewal 60 days out · flagged healthy", "Followed up on last support ticket", "Usage dipped 20% — outreach queued"][i % 5];
  if (seg === "management") return ["Reviewed pipeline coverage for the quarter", "Shared coaching notes on Sequence A copy", "Rebalanced accounts across the team", "Flagged an at-risk deal for help", "Set weekly target pacing"][i % 5];
  return ["Personalized with their recent infra blog post", "First touch · cost-savings angle", "Connection accepted · sent voice-note intro", "Referenced their reply about latency", "Asked for referral to engineering leadership"][i % 5];
}

function firstTask(agent: Agent, status: string): TaskItem {
  if (status === "error") return makeTaskRaw("Failed", agent.task, "Needs attention — see agent status", "Failed 7:58a");
  if (status === "working") return makeTaskRaw("Running", agent.task, "In progress right now", "Started 9:02a");
  if (status === "waiting") return makeTaskRaw("Pending", agent.task, "Awaiting your approval", "Queued");
  return makeTaskRaw("Pending", agent.task, "Resumes next shift", "Queued");
}
const TASK_COLORS: Record<string, [string, string, string]> = {
  Running: ["#E9F5FE", "#0369A1", "#0EA5E9"], Pending: ["#FEF6E8", "#B45309", "#F59E0B"],
  Completed: ["#E7F7EC", "#1B7A3D", "#2FA45C"], Failed: ["#FEECEC", "#B91C1C", "#EF4444"],
};
function makeTaskRaw(status: string, title: string, sub: string, time: string): TaskItem {
  const c = TASK_COLORS[status];
  return { status, title, sub, time, bg: c[0], fg: c[1], dot: c[2] };
}
function makeTask(status: string, t: [string, string]): TaskItem {
  const times: Record<string, string> = { Running: "Started 8:47a", Pending: "Scheduled 4:30p", Completed: "Done 8:15a", Failed: "Failed 7:58a" };
  return makeTaskRaw(status, t[0], t[1], times[status] || "Queued");
}
function taskPool(seg: Segment, _meta: SegMeta): [string, string][] {
  if (seg === "recruiting") return [["Source 20 AE candidates on LinkedIn", "Filtering by quota attainment"], ["Screen 4 shortlisted candidates", "Panel briefs prepared"], ["Draft weekly hiring summary", "Scheduled for 4:30pm"], ["Sync candidates to ATS", "API rate limit — retrying"]];
  if (seg === "success") return [["Run health checks on 12 accounts", "Usage + support signals"], ["Prep QBR deck for BlueOrbit", "ARR expansion angle"], ["Draft renewal summary", "Scheduled for 4:30pm"], ["Sync account notes to CRM", "API rate limit — retrying"]];
  if (seg === "management") return [["Review team pipeline coverage", "Across all reps"], ["Rebalance accounts", "By capacity + fit"], ["Draft weekly team summary", "Scheduled for 4:30pm"], ["Reconcile forecast to CRM", "API rate limit — retrying"]];
  return [["Personalize outreach for 14 prospects", "Company news + tech-stack signals"], ["Enrich 35 new leads", "Firmographics + AWS usage"], ["Draft weekly pipeline summary", "Scheduled for 4:30pm"], ["Sync contacts to CRM", "API rate limit — retrying"]];
}

function accomplishmentsFor(seg: Segment, leads: Lead[], _first: string): string[] {
  const top = leads[0];
  if (seg === "recruiting") return ["Booked a screen with " + top.name, "Sourced 12 new candidates this week", "2 candidates advanced to final round"];
  if (seg === "success") return ["Renewed " + top.name + " for another year", "Lifted portfolio NPS by 4 points", "Recovered 1 at-risk account"];
  if (seg === "management") return ["Team hit 88% of quarterly target", "Rebalanced 40 accounts by capacity", "Two reps back above 85 score"];
  return ["Booked a meeting with " + top.name + " (" + top.company + ")", "Got a positive reply from " + leads[1].company, "Sequence B reply rate reached 27%"];
}
function nextActionsFor(seg: Segment, leads: Lead[], agent: Agent): string[] {
  if (seg === "recruiting") return ["Screen " + leads[1].name, "Follow up with 3 sourced candidates", "Send offer paperwork to finalist"];
  if (seg === "success") return ["Prep QBR for " + leads[0].name, "Check in on the at-risk account", "Draft expansion proposal"];
  if (seg === "management") return ["1:1s with two lagging reps", "Review Q3 forecast", "Approve pending sequence changes"];
  return ["Follow up with " + leads[0].name + " (" + leads[0].company + ")", "Contact remaining prospects in the sequence", "Prep brief for the next booked meeting"];
}
function goalsFor(agent: Agent, meta: SegMeta): string[] {
  return [agent.goal, "Focus on the " + meta.segLabel + " segment", "Always personalize outreach", "Avoid duplicate contacts"];
}
function memoryFor(seg: Segment, meta: SegMeta, leads: Lead[], userFirst: string): MemoryCard[] {
  const companies = leads.slice(0, 3).map((l) => l.company);
  return [
    { icon: "👤", title: "User preferences", bg: "#F1EDFD", items: [userFirst + " prefers updates in the morning", "Never contact existing customers", "CC " + userFirst.toLowerCase() + "@ on high-value threads"] },
    { icon: "🏢", title: "Company knowledge", bg: "#E9F5FE", items: ["Best case study: 30% cost cut at a mid-market co", "Pricing starts at $24/seat, volume discount at 100+", "Q3 focus: " + meta.segLabel + " vertical"] },
    { icon: "🧭", title: "Segment history", bg: "#FEF6E8", items: [companies[0] + " responded well to a direct angle (reuse)", companies[1] + " prefers a warm intro first", companies[2] + " needs a one-pager before any call"] },
    { icon: "✨", title: "Successful messaging", bg: "#FDF0F5", items: ["Subject lines with a number → +12% opens", "Referencing a recent post → 2.1× replies", "Tuesday 9am sends perform best"] },
  ];
}
