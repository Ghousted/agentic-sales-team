// Serializable DTOs and shared constants for the leads/outreach domain.
// Dates are ISO strings so these cross the server→client boundary cleanly.

export const LEAD_STAGES = ["new", "contacted", "engaged", "replied", "meeting"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export interface ResearchBrief {
  summary: string;
  priorities: string[];
  hooks: string[];
  angle: string;
}

export interface LeadDTO {
  id: string;
  agentId: string;
  name: string;
  title: string;
  company: string;
  email: string;
  status: string;
  score: number;
  source: string;
  review: string;
  profileUrl: string | null;
  platform: string | null;
  research: ResearchBrief | null;
  workedBy: string[];
  createdAt: string;
  updatedAt: string;
}

export interface LiveWorkDTO {
  agentId: string;
  agentName: string;
  capability: string;
  leadIds: string[];
}

export interface DraftDTO {
  id: string;
  agentId: string;
  leadId: string;
  subject: string;
  body: string;
  rationale: string;
  status: string;
  createdAt: string;
  sentAt: string | null;
  leadName: string;
  leadCompany: string;
  leadEmail: string;
  leadProfileUrl: string | null;
  leadPlatform: string | null;
}

// A snapshot of the agent captured at enqueue time and stored in the job params,
// so the runner never has to re-resolve agent state server-side.
export interface AgentSnapshot {
  id: string;
  name: string;
  role: string;
  goal: string;
  task: string;
}

export interface OutreachResult {
  score: number;
  stage: string;
  subject: string;
  body: string;
  rationale: string;
}

export interface QualifyResult {
  score: number; // 1-100
  tier: "hot" | "warm" | "cold";
  reason: string;
}

export interface ProposalResult {
  title: string;
  body: string;
  productsUsed: string[];
}

// A slim lead shape for the team-chat /lead picker (pending + accepted only).
export interface TeamLeadPick {
  id: string;
  name: string;
  title: string;
  company: string;
  platform: string | null;
  review: string; // "pending" | "accepted"
}
