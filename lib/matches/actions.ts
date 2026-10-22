"use server";
// Client-facing server action for the matches domain. A thin wrapper over the
// server-only store so client components never import server-only code.
import * as store from "./store";
import type { MatchDTO } from "./store";

export async function listMatchesForLead(leadId: string): Promise<MatchDTO[]> {
  return store.listMatchesForLead(leadId);
}
