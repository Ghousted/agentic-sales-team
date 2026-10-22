import { describe, it, expect } from "vitest";
import { agentNow, liveAgentCount, teamKpis, teamSubtitle, teamActivity } from "./derive";
import type { LiveWorkDTO } from "@/lib/leads/types";

const live: LiveWorkDTO[] = [
  { agentId: "a1", agentName: "Ann", capability: "research", leadIds: ["l1", "l2"] },
  { agentId: "a2", agentName: "Bo", capability: "scrape", leadIds: [] },
  { agentId: "a1", agentName: "Ann", capability: "outreach", leadIds: ["l3"] },
];

describe("agentNow", () => {
  it("is working with the live capability when the agent has live work", () => {
    expect(agentNow("a1", live)).toEqual({ status: "working", task: "Lead research · 2 leads" });
    expect(agentNow("a2", live)).toEqual({ status: "working", task: "Lead scraping" });
  });
  it("is idle with no live work, and waiting when paused", () => {
    expect(agentNow("a3", live)).toEqual({ status: "idle", task: "Idle" });
    expect(agentNow("a3", live, true)).toEqual({ status: "waiting", task: "Paused" });
  });
});

describe("liveAgentCount", () => {
  it("counts distinct agents, optionally within a set of ids", () => {
    expect(liveAgentCount(live)).toBe(2);
    expect(liveAgentCount(live, ["a2", "a9"])).toBe(1);
    expect(liveAgentCount([])).toBe(0);
  });
});

describe("teamKpis", () => {
  it("shows dashes when the team has no leads", () => {
    expect(teamKpis([])).toEqual({ meetings: "-", pipeline: "-", leads: "0", avgScore: "-" });
  });
  it("counts meetings, leads in play and the average of scored leads", () => {
    const k = teamKpis([
      { status: "new", score: 0 }, { status: "contacted", score: 80 },
      { status: "replied", score: 60 }, { status: "meeting", score: 0 },
    ]);
    expect(k).toEqual({ meetings: "1", pipeline: "2", leads: "4", avgScore: "70" });
  });
});

describe("teamSubtitle", () => {
  it("names the template and the real member count", () => {
    expect(teamSubtitle({ template: "outbound", members: ["a", "b"] })).toBe("Outbound team · 2 agents");
    expect(teamSubtitle({ template: "nope", members: ["a"] })).toBe("Custom team · 1 agent");
  });
});

describe("teamActivity", () => {
  it("keeps only members' lines, newest first, up to the limit", () => {
    const acts = ["a1", "x", "a2", "a1"].map((agentId, i) => ({ agentId, type: "lead_added", text: "t" + i, createdAt: "" }));
    expect(teamActivity(acts, ["a1", "a2"], 2).map((a) => a.text)).toEqual(["t0", "t2"]);
  });
});
