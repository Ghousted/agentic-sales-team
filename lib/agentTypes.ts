// Static catalog for the typed-agent harness: capabilities (engine-backed atoms,
// one per jobs.kind), agent-type presets (bundles of capabilities), and team
// templates (required capabilities). Developer-curated, like AGENTS_BASE.

export type Capability = "scrape" | "outreach" | "follow-up" | "book-meeting";

export const CAPABILITIES: { id: Capability; label: string; desc: string; jobKind: string; engineReady: boolean }[] = [
  { id: "scrape", label: "Lead scraping", desc: "Find & import prospects matching an ICP", jobKind: "scrape", engineReady: false },
  { id: "outreach", label: "Email drafting", desc: "Qualify leads and draft personalized emails", jobKind: "outreach", engineReady: true },
  { id: "follow-up", label: "Follow-ups", desc: "Re-engage non-repliers and cold leads", jobKind: "follow-up", engineReady: false },
  { id: "book-meeting", label: "Meeting booking", desc: "Propose times and book on positive replies", jobKind: "book-meeting", engineReady: false },
];

export interface AgentType { id: string; label: string; desc: string; capabilities: Capability[]; custom?: boolean }

export const AGENT_TYPES: AgentType[] = [
  { id: "sdr", label: "SDR", desc: "Full-funnel prospector — finds, writes, and follows up.", capabilities: ["scrape", "outreach", "follow-up"] },
  { id: "bdr", label: "BDR", desc: "High-volume outbound on a given list.", capabilities: ["outreach", "follow-up"] },
  { id: "ae", label: "Account Executive", desc: "Works warm leads to booked meetings.", capabilities: ["outreach", "book-meeting"] },
  { id: "csm", label: "Customer Success", desc: "Check-ins and re-engagement for accounts.", capabilities: ["follow-up"] },
  { id: "recruiter", label: "Recruiter", desc: "Sources and contacts candidates.", capabilities: ["scrape", "outreach"] },
  { id: "manager", label: "Sales Manager", desc: "Coordinates the team and reports — no direct outreach.", capabilities: [] },
  { id: "scout", label: "Lead Scout", desc: "Pure lead-gen — finds and imports prospects.", capabilities: ["scrape"] },
  { id: "writer", label: "Outreach Writer", desc: "Pure email drafter.", capabilities: ["outreach"] },
  { id: "followup", label: "Follow-up Agent", desc: "Pure re-engagement for cold leads.", capabilities: ["follow-up"] },
  { id: "custom", label: "Custom", desc: "Build your own — pick the capabilities you want.", capabilities: [], custom: true },
];

export function typeById(id: string): AgentType | undefined {
  return AGENT_TYPES.find((t) => t.id === id);
}
export function capabilitiesForType(id: string): Capability[] {
  return typeById(id)?.capabilities ?? [];
}

export interface TeamTemplate { id: string; label: string; desc: string; requiredCapabilities: Capability[] }

export const TEAM_TEMPLATES: TeamTemplate[] = [
  { id: "outbound", label: "Outbound", desc: "Cold prospecting engine.", requiredCapabilities: ["scrape", "outreach", "follow-up"] },
  { id: "leadgen", label: "Lead-Gen / Research", desc: "Top-of-funnel list building.", requiredCapabilities: ["scrape"] },
  { id: "enterprise", label: "Enterprise / Named Accounts", desc: "Multi-thread warm accounts to meetings.", requiredCapabilities: ["outreach", "book-meeting"] },
  { id: "fullcycle", label: "Full-Cycle Pod", desc: "Self-contained squad, end to end.", requiredCapabilities: ["scrape", "outreach", "follow-up", "book-meeting"] },
  { id: "nurture", label: "Nurture / Re-engagement", desc: "Revive cold & stalled leads.", requiredCapabilities: ["follow-up", "outreach"] },
  { id: "meetings", label: "Meeting-Booking / SDR→AE", desc: "Book demos, hand off to closers.", requiredCapabilities: ["outreach", "book-meeting"] },
  { id: "recruitment", label: "Recruitment", desc: "Source & contact candidates.", requiredCapabilities: ["scrape", "outreach"] },
  { id: "success", label: "Customer Success", desc: "Retention, check-ins, renewals.", requiredCapabilities: ["follow-up"] },
  { id: "custom", label: "Custom", desc: "Freeform — pick any agents.", requiredCapabilities: [] },
];

export function templateById(id: string): TeamTemplate | undefined {
  return TEAM_TEMPLATES.find((t) => t.id === id);
}
