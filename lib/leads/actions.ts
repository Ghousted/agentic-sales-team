"use server";
// Client-facing server actions for the leads domain. Thin wrappers over the
// server-only store so client components never import server-only code.
import * as store from "./store";
import type { LeadDTO, DraftDTO, LiveWorkDTO, TeamLeadPick } from "./types";

export async function addLead(input: { agentId: string; name: string; title?: string; company?: string; email: string }): Promise<LeadDTO | null> {
  return store.addLead(input);
}
export async function importLeadsCsv(csvText: string, agentId: string): Promise<{ added: number; error?: string }> {
  return store.importLeadsCsv(csvText, agentId);
}
export async function listLeads(filter?: { agentId?: string; status?: string; source?: string; review?: string }): Promise<LeadDTO[]> {
  return store.listLeads(filter);
}
export async function listWorkbook(agentId: string): Promise<LeadDTO[]> {
  return store.listWorkbook(agentId);
}
export async function listLeadsForAgents(agentIds: string[]): Promise<LeadDTO[]> {
  return store.listLeadsForAgents(agentIds);
}
export async function listCandidates(filter?: { agentId?: string }): Promise<LeadDTO[]> {
  return store.listCandidates(filter);
}
export async function listTeamLeads(teamId: string): Promise<TeamLeadPick[]> {
  return store.listTeamLeadsForPicker(teamId);
}
export async function acceptLeads(ids: string[]): Promise<void> {
  return store.setLeadReview(ids, "accepted");
}
export async function dismissLeads(ids: string[]): Promise<void> {
  return store.setLeadReview(ids, "dismissed");
}
export async function deleteLeads(ids: string[]): Promise<void> {
  return store.deleteLeads(ids);
}
export async function getLead(id: string): Promise<LeadDTO | null> {
  return store.getLead(id);
}
export async function setStage(id: string, status: string): Promise<void> {
  return store.setStage(id, status);
}
export async function listDraftsForAgent(agentId: string): Promise<DraftDTO[]> {
  return store.listDraftsForAgent(agentId);
}
export async function listDraftsForLead(leadId: string): Promise<DraftDTO[]> {
  return store.listDraftsForLead(leadId);
}
export async function listAllDrafts(): Promise<DraftDTO[]> {
  return store.listAllDrafts();
}
export async function markDraftSent(draftId: string): Promise<void> {
  return store.markDraftSent(draftId);
}
export async function discardDraft(draftId: string): Promise<void> {
  return store.discardDraft(draftId);
}
export async function clearSentDrafts(): Promise<number> {
  return store.clearSentDrafts();
}
export async function clearAllDrafts(): Promise<number> {
  return store.clearAllDrafts();
}
export async function clearDraftsForLead(leadId: string): Promise<number> {
  return store.clearDraftsForLead(leadId);
}
export async function liveWork(): Promise<LiveWorkDTO[]> {
  return store.getLiveWork();
}
