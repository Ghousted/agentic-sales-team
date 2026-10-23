// T27: an unknown or deleted team/agent id must show a not-found state, not
// silently fall back to the first record (whose Edit/Delete would then act on
// the wrong team or agent).
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The pages use the automatic JSX runtime under Next; vitest compiles to
// React.createElement, so expose React globally for them.
(globalThis as { React?: typeof React }).React = React;

const params = { id: "" };
vi.mock("next/navigation", () => ({
  useParams: () => params,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => children }));

const AGENT = {
  id: "a-real", name: "Real Agent", initials: "RA", role: "Assessor", color: "#006AFF",
  status: "idle", goal: "", capabilities: [],
};
const TEAM = {
  id: "t-real", name: "Real Team", icon: "🚀", iconBg: "#EAF2FF", goal: "", members: ["a-real"],
};
const store = {
  s: { paused: {}, agentConfig: {} },
  agents: [AGENT],
  teams: [TEAM],
  byId: (id: string) => (id === AGENT.id ? AGENT : undefined),
  togglePause: vi.fn(), deleteAgent: vi.fn(), saveConfig: vi.fn(), showToast: vi.fn(),
  addTeamMembers: vi.fn(), updateTeam: vi.fn(), removeTeamMember: vi.fn(), deleteTeam: vi.fn(),
};
vi.mock("@/lib/store", () => ({ useApp: () => store }));
vi.mock("@/lib/useLiveWork", () => ({ useLiveWork: () => ({ live: [], byLead: {} }) }));

// Server actions are only called from effects, which don't run during SSR.
const none = () => Promise.resolve([]);
vi.mock("@/lib/leads/actions", () => ({ listWorkbook: none, listDraftsForAgent: none, markDraftSent: none, listLeadsForAgents: none }));
vi.mock("@/lib/jobs/actions", () => ({ enqueueOutreachJob: none, enqueueJob: none }));
vi.mock("@/lib/agents/actions", () => ({ getAgentStats: none }));
vi.mock("@/lib/meetings/actions", () => ({ listMeetings: none }));
vi.mock("@/lib/proposals/actions", () => ({ listProposalsForAgent: none, markProposalSent: none }));
vi.mock("@/lib/pod/actions", () => ({ listPendingApprovals: none, approveJob: none, rejectJob: none }));
vi.mock("@/lib/workspace/statsActions", () => ({ listActivity: none }));

beforeEach(() => { params.id = ""; });

describe("team detail", () => {
  it("shows not-found for an unknown id instead of another team", async () => {
    const { default: TeamDetail } = await import("@/app/teams/[id]/page");
    params.id = "t-deleted";
    const html = renderToStaticMarkup(<TeamDetail />);
    expect(html).not.toContain("Real Team");
    expect(html).toContain("Team not found");
    expect(html).not.toContain("Confirm delete");
  });

  it("still shows a known team", async () => {
    const { default: TeamDetail } = await import("@/app/teams/[id]/page");
    params.id = "t-real";
    const html = renderToStaticMarkup(<TeamDetail />);
    expect(html).toContain("Real Team");
    expect(html).not.toContain("Team not found");
  });
});

describe("agent detail", () => {
  it("shows not-found for an unknown id instead of another agent", async () => {
    const { default: AgentDetail } = await import("@/app/agents/[id]/page");
    params.id = "a-deleted";
    const html = renderToStaticMarkup(<AgentDetail />);
    expect(html).not.toContain("Real Agent");
    expect(html).toContain("Agent not found");
  });

  it("still shows a known agent", async () => {
    const { default: AgentDetail } = await import("@/app/agents/[id]/page");
    params.id = "a-real";
    const html = renderToStaticMarkup(<AgentDetail />);
    expect(html).toContain("Real Agent");
    expect(html).not.toContain("Agent not found");
  });
});
