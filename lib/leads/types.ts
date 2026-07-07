// Serializable DTOs and shared constants for the leads/outreach domain.
// Dates are ISO strings so these cross the server→client boundary cleanly.

export const LEAD_STAGES = ["new", "contacted", "engaged", "replied", "meeting"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

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
  profileUrl: string | null;
  platform: string | null;
  createdAt: string;
  updatedAt: string;
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
