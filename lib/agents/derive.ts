// Display numbers derived from real data. The status, task and score stored on
// an agent row (and the meetings/pipeline/activity on a team row) were seeded
// at create time and never updated, so the UI reads these helpers instead.
import { CAPABILITIES, templateById } from "@/lib/agentTypes";
import type { StatusKey, Team } from "@/lib/types";
import type { LeadDTO, LiveWorkDTO } from "@/lib/leads/types";
import type { ActivityItem } from "@/lib/workspace/stats";

export interface AgentNow { status: StatusKey; task: string }

/** What an agent is doing right now: working (a live job), paused, or idle. */
export function agentNow(agentId: string, live: LiveWorkDTO[], paused = false): AgentNow {
  const w = live.find((x) => x.agentId === agentId);
  if (w) {
    const label = CAPABILITIES.find((c) => c.id === w.capability)?.label ?? w.capability;
    const n = w.leadIds.length;
    return { status: "working", task: label + (n ? " · " + n + " lead" + (n === 1 ? "" : "s") : "") };
  }
  if (paused) return { status: "waiting", task: "Paused" };
  return { status: "idle", task: "Idle" };
}

/** Number of distinct agents with live work, optionally limited to some ids. */
export function liveAgentCount(live: LiveWorkDTO[], ids?: string[]): number {
  const set = new Set(live.map((w) => w.agentId));
  return ids ? ids.filter((id) => set.has(id)).length : set.size;
}

export interface TeamKpis { meetings: string; pipeline: string; leads: string; avgScore: string }

/** Team KPIs from the team's own leads. "-" means there is nothing to count yet. */
export function teamKpis(teamLeads: Pick<LeadDTO, "status" | "score">[]): TeamKpis {
  if (teamLeads.length === 0) return { meetings: "-", pipeline: "-", leads: "0", avgScore: "-" };
  const meetings = teamLeads.filter((l) => l.status === "meeting").length;
  // In play: contacted, engaged or replied. New leads aren't worked yet and
  // meetings are counted on their own.
  const pipeline = teamLeads.filter((l) => l.status !== "new" && l.status !== "meeting").length;
  const scored = teamLeads.filter((l) => l.score > 0);
  const avg = scored.length ? Math.round(scored.reduce((n, l) => n + l.score, 0) / scored.length) : 0;
  return { meetings: String(meetings), pipeline: String(pipeline), leads: String(teamLeads.length), avgScore: avg ? String(avg) : "-" };
}

/** A team's subtitle. The stored desc said "N agents · just created" forever. */
export function teamSubtitle(team: Pick<Team, "template" | "members">): string {
  const n = team.members.length;
  return (templateById(team.template)?.label ?? "Custom") + " team · " + n + " agent" + (n === 1 ? "" : "s");
}

/** The newest activity lines by any of the given agents. */
export function teamActivity(acts: ActivityItem[], memberIds: string[], limit = 6): ActivityItem[] {
  const ids = new Set(memberIds);
  return acts.filter((a) => ids.has(a.agentId)).slice(0, limit);
}
