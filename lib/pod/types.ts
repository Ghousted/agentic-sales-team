// Pod pipeline shared constants + DTOs (importable by client + server).
// Full-funnel chain order. scrape is the entry (user-initiated with a target);
// assess is the auto-approval gate right after scrape; the rest work the book.
export const POD_ORDER = ["scrape", "assess", "research", "qualify", "match", "outreach", "proposal"] as const;
export type PodStage = (typeof POD_ORDER)[number];
export const POD_BATCH = 20;

export interface ApprovalDTO {
  id: string;
  agentName: string;
  capability: string;
  leadCount: number;
}
