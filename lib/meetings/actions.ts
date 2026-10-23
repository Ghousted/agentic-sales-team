"use server";
// Client-facing meetings action. A thin wrapper over the server-only store.
import * as store from "./store";
import type { MeetingDTO } from "./store";

export async function listMeetings(agentId?: string): Promise<MeetingDTO[]> {
  return store.listMeetings(agentId);
}
export async function bookMeetingForLead(leadId: string, whenText: string, timeZone?: string): Promise<{ ok: boolean; label?: string; error?: string }> {
  return store.bookMeetingForLead(leadId, whenText, timeZone);
}
