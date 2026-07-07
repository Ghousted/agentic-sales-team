// Pod pipeline shared constants + DTOs (importable by client + server).
export const POD_ORDER = ["research", "outreach"] as const;
export type PodStage = (typeof POD_ORDER)[number];
export const POD_BATCH = 20;

export interface ApprovalDTO {
  id: string;
  agentName: string;
  capability: string;
  leadCount: number;
}
