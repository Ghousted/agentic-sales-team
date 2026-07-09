"use server";
// Client-facing meetings action — a thin wrapper over the server-only store.
import * as store from "./store";
import type { MeetingDTO } from "./store";

export async function listMeetings(): Promise<MeetingDTO[]> {
  return store.listMeetings();
}
