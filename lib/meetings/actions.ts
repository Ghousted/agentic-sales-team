"use server";
// Client-facing meetings action — a thin wrapper over the server-only store.
import * as store from "./store";
import type { MeetingDTO } from "./store";

export async function listMeetings(): Promise<MeetingDTO[]> {
  return store.listMeetings();
}
export async function bookMeetingForLead(leadId: string, whenText: string): Promise<{ ok: boolean; label?: string; error?: string }> {
  return store.bookMeetingForLead(leadId, whenText);
}
