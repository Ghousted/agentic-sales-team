"use client";
import { useEffect, useState } from "react";
import { liveWork } from "@/lib/leads/actions";
import type { LiveWorkDTO } from "@/lib/leads/types";

/** Poll the live "who's working now" set every ~3.5s while mounted. Returns the
 *  raw list (for a team strip) and a leadId → {agentName, capability} map. */
export function useLiveWork(): { live: LiveWorkDTO[]; byLead: Record<string, { agentName: string; capability: string }> } {
  const [live, setLive] = useState<LiveWorkDTO[]>([]);
  useEffect(() => {
    let active = true;
    const tick = async () => { const w = await liveWork(); if (active) setLive(w); };
    tick();
    const id = setInterval(tick, 3500);
    return () => { active = false; clearInterval(id); };
  }, []);
  const byLead: Record<string, { agentName: string; capability: string }> = {};
  for (const w of live) for (const id of w.leadIds) byLead[id] = { agentName: w.agentName, capability: w.capability };
  return { live, byLead };
}
