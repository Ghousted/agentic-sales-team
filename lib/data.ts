// Seed data + pure helpers ported verbatim from the v5 prototype.
import type { Agent, Team, StatusKey, StatusMeta, Chats } from "./types";

// No seed agents — every user builds their own workforce via the creation wizard
// (from the AGENT_TYPES presets in lib/agentTypes.ts). Typed empty array so every
// AGENTS_BASE consumer just iterates nothing.
export const AGENTS_BASE: Agent[] = [];

// No seed team instances — users create their own teams from the team TEMPLATES
// (TEAM_TEMPLATES in lib/agentTypes.ts, offered in the New Team modal). Kept as a
// typed empty array so every TEAMS_BASE consumer just iterates nothing.
export const TEAMS_BASE: Team[] = [];

const STATUS_META: Record<StatusKey, StatusMeta> = {
  working: { label: "Working", bg: "#E7F7EC", color: "#1B7A3D", dot: "#2FA45C" },
  waiting: { label: "Waiting", bg: "#FEF6E8", color: "#B45309", dot: "#F59E0B" },
  offline: { label: "Offline", bg: "#F4F4F5", color: "#71717A", dot: "#A1A1AA" },
  error: { label: "Error", bg: "#FEECEC", color: "#B91C1C", dot: "#EF4444" },
};
export function statusMeta(s: StatusKey): StatusMeta {
  return STATUS_META[s];
}

// No seed conversations — chats begin once the user creates agents/teams.
export function chatsInit(): Chats {
  return {};
}
