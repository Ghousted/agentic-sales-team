// Static catalog for the typed-agent harness: capabilities (engine-backed atoms,
// one per jobs.kind), agent-type presets (bundles of capabilities), and team
// templates (required capabilities). Developer-curated, like AGENTS_BASE.

export type Capability = "scrape" | "outreach" | "follow-up" | "book-meeting" | "research" | "qualify" | "proposal" | "enrich" | "match" | "assess";

export const CAPABILITIES: { id: Capability; label: string; desc: string; jobKind: string; engineReady: boolean }[] = [
  { id: "scrape", label: "Lead scraping", desc: "Find & import prospects matching an ICP", jobKind: "scrape", engineReady: true },
  { id: "research", label: "Lead research", desc: "Enrich prospects with a research brief", jobKind: "research", engineReady: true },
  { id: "outreach", label: "Email drafting", desc: "Qualify leads and draft personalized emails", jobKind: "outreach", engineReady: true },
  { id: "follow-up", label: "Follow-ups", desc: "Re-engage non-repliers and cold leads", jobKind: "follow-up", engineReady: false },
  { id: "book-meeting", label: "Meeting booking", desc: "Book meetings with leads onto the calendar", jobKind: "book-meeting", engineReady: true },
  { id: "qualify", label: "Lead qualification", desc: "Score & prioritize the book (hot/warm/cold)", jobKind: "qualify", engineReady: true },
  { id: "proposal", label: "Proposal drafting", desc: "Draft a scoped, priced proposal from your catalog", jobKind: "proposal", engineReady: true },
  { id: "enrich", label: "Contact enrichment", desc: "Fill in missing contact info & firmographics", jobKind: "enrich", engineReady: false },
  { id: "match", label: "Matchmaking", desc: "Match leads to the catalog listings that fit them", jobKind: "match", engineReady: true },
  { id: "assess", label: "Lead assessment", desc: "Review new leads and auto-accept the ones that fit", jobKind: "assess", engineReady: true },
];

export interface AgentType { id: string; label: string; desc: string; capabilities: Capability[]; custom?: boolean }

export const AGENT_TYPES: AgentType[] = [
  { id: "sdr", label: "SDR", desc: "Full-funnel prospector. Finds leads, writes to them, and follows up.", capabilities: ["research", "scrape", "outreach", "follow-up", "qualify"] },
  { id: "bdr", label: "BDR", desc: "High-volume outbound on a given list.", capabilities: ["outreach", "follow-up"] },
  { id: "ae", label: "Account Executive", desc: "Works warm leads to booked meetings.", capabilities: ["outreach", "book-meeting", "proposal"] },
  { id: "csm", label: "Customer Success", desc: "Check-ins and re-engagement for accounts.", capabilities: ["follow-up"] },
  { id: "recruiter", label: "Recruiter", desc: "Sources and contacts candidates.", capabilities: ["scrape", "outreach"] },
  { id: "manager", label: "Sales Manager", desc: "Coordinates the team and reports. Does no direct outreach.", capabilities: [] },
  { id: "scout", label: "Lead Scout", desc: "Lead generation only. Finds and imports prospects.", capabilities: ["scrape"] },
  { id: "researcher", label: "Research Agent", desc: "Enriches prospects with research briefs.", capabilities: ["research"] },
  { id: "writer", label: "Outreach Writer", desc: "Pure email drafter.", capabilities: ["outreach"] },
  { id: "followup", label: "Follow-up Agent", desc: "Pure re-engagement for cold leads.", capabilities: ["follow-up"] },
  { id: "qualifier", label: "Lead Qualifier", desc: "Scores & triages the book so the team works the best leads first.", capabilities: ["qualify"] },
  { id: "closer", label: "Closer", desc: "Researches, qualifies, and sends proposals grounded in your catalog.", capabilities: ["research", "qualify", "proposal", "match"] },
  { id: "matchmaker", label: "Matchmaker", desc: "Matches leads to the catalog listings that fit them.", capabilities: ["match"] },
  { id: "assessor", label: "Assessor", desc: "The quality gate. Reviews new leads and accepts the good fits automatically.", capabilities: ["assess"] },
  { id: "meeting", label: "Meeting Booker", desc: "Books meetings with your leads onto the calendar.", capabilities: ["book-meeting"] },
  { id: "custom", label: "Custom", desc: "Build your own agent. Pick the capabilities you want.", capabilities: [], custom: true },
];

export function typeById(id: string): AgentType | undefined {
  return AGENT_TYPES.find((t) => t.id === id);
}
export interface TeamTemplate { id: string; label: string; desc: string; requiredCapabilities: Capability[]; comingSoon: Capability[] }

/** True when the job engine can actually run this capability today. */
export function isEngineReady(cap: Capability): boolean {
  return CAPABILITIES.find((c) => c.id === cap)?.engineReady ?? false;
}

// A template lists every capability it wants. Only engine-ready ones become
// requirements; the rest are shown as "coming soon" so a team isn't blocked on
// (or nudged to hire an agent for) work nothing can run yet.
function template(id: string, label: string, desc: string, caps: Capability[]): TeamTemplate {
  return { id, label, desc, requiredCapabilities: caps.filter(isEngineReady), comingSoon: caps.filter((c) => !isEngineReady(c)) };
}

export const TEAM_TEMPLATES: TeamTemplate[] = [
  template("outbound", "Outbound", "Cold prospecting engine.", ["scrape", "outreach", "follow-up"]),
  template("leadgen", "Lead-Gen / Research", "Top-of-funnel list building.", ["scrape"]),
  template("enterprise", "Enterprise / Named Accounts", "Multi-thread warm accounts to meetings.", ["outreach", "book-meeting"]),
  template("fullcycle", "Full-Cycle Pod", "Self-contained squad, end to end.", ["scrape", "outreach", "follow-up", "book-meeting"]),
  template("nurture", "Nurture / Re-engagement", "Revive cold & stalled leads.", ["follow-up", "outreach"]),
  template("meetings", "Meeting-Booking / SDR→AE", "Book demos, hand off to closers.", ["outreach", "book-meeting"]),
  template("recruitment", "Recruitment", "Source & contact candidates.", ["scrape", "outreach"]),
  template("success", "Customer Success", "Retention, check-ins, renewals.", ["follow-up"]),
  template("revenue", "Qualify → Propose", "Prioritize the book and send proposals.", ["qualify", "proposal"]),
  template("custom", "Custom", "Freeform. Pick any agents.", []),
];

/** Parse the wizard's free-text meeting length ("30", "30 min", "1 hour", "1.5h")
 *  into the whole minutes lib/meetings/store.ts reads as book-meeting.duration.
 *  Returns undefined for anything unparseable or outside 5 min – 8 h. */
export function parseMeetingMinutes(text: string): number | undefined {
  const m = text.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(m|mins?|minutes?|h|hrs?|hours?)?$/);
  if (!m) return undefined;
  const n = parseFloat(m[1]) * (m[2]?.startsWith("h") ? 60 : 1);
  const minutes = Math.round(n);
  return minutes >= 5 && minutes <= 480 ? minutes : undefined;
}

export function templateById(id: string): TeamTemplate | undefined {
  return TEAM_TEMPLATES.find((t) => t.id === id);
}
