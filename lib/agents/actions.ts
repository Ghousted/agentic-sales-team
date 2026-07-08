"use server";
// Client-facing wrapper for the server-only agent stats read.
import { getAgentStats as _getAgentStats, type AgentStats } from "./stats";

export async function getAgentStats(agentId: string): Promise<AgentStats> {
  return _getAgentStats(agentId);
}
