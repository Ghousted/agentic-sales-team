import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  session: null as { userId: string } | null,
  inserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
}));

vi.mock("drizzle-orm", () => ({ and: vi.fn(), eq: vi.fn(), asc: vi.fn() }));
vi.mock("@/lib/db", () => ({
  isDbConfigured: () => true,
  getDb: () => ({
    insert: (table: { _: string }) => ({
      values: async (values: Record<string, unknown>) => { h.inserts.push({ table: table._, values }); },
    }),
  }),
  agents: { _: "agents" },
  teams: { _: "teams" },
  agentStates: { _: "agent_states" },
  messages: { _: "messages" },
  agentConfig: { _: "agent_config" },
  teamMembers: { _: "team_members" },
}));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => h.session }));

import { saveAgent, saveTeam } from "./actions";
import type { Agent, Team } from "@/lib/types";

const agent: Agent = {
  id: "xabc", name: "Ava", initials: "AV", role: "SDR", color: "#006AFF", status: "working",
  task: "Onboarding", score: 75, goal: "Ramp up", type: "sdr", capabilities: [],
};
const team: Team = {
  id: "txabc", name: "EMEA", icon: "🚀", iconBg: "#EAF2FF", desc: "", members: ["xabc"],
  meetings: 0, pipeline: "-", leads: 0, goal: "", activity: [], template: "custom",
};

beforeEach(() => {
  h.session = null;
  h.inserts = [];
});

describe("saveAgent / saveTeam", () => {
  it("saveAgent rejects when signed out instead of pretending it saved", async () => {
    await expect(saveAgent(agent)).rejects.toThrow("Not signed in.");
    expect(h.inserts).toEqual([]);
  });

  it("saveTeam rejects when signed out instead of pretending it saved", async () => {
    await expect(saveTeam(team)).rejects.toThrow("Not signed in.");
    expect(h.inserts).toEqual([]);
  });

  it("saveAgent stores the agent under the signed-in user", async () => {
    h.session = { userId: "u1" };
    await saveAgent(agent);
    expect(h.inserts).toEqual([{ table: "agents", values: expect.objectContaining({ userId: "u1", id: "xabc", name: "Ava" }) }]);
  });

  it("saveTeam stores the team under the signed-in user", async () => {
    h.session = { userId: "u1" };
    await saveTeam(team);
    expect(h.inserts).toEqual([{ table: "teams", values: expect.objectContaining({ userId: "u1", id: "txabc", members: ["xabc"] }) }]);
  });
});
