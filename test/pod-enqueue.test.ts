import { beforeEach, describe, expect, it, vi } from "vitest";

// Scripted Drizzle stand-in: each awaited select returns the next queued result.
const fake = vi.hoisted(() => {
  const state = { selects: [] as unknown[][], inserts: [] as unknown[] };
  const chain = (result: () => unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "where", "limit", "returning"]) c[m] = () => c;
    c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve().then(result).then(res, rej);
    return c;
  };
  const db = {
    select: () => chain(() => state.selects.shift() ?? []),
    insert: () => ({ values: (v: unknown) => { state.inserts.push(v); return chain(() => [{ id: "new-job" }]); } }),
  };
  return { state, db };
});

vi.mock("@/lib/db", async () => ({ ...(await import("@/lib/db/schema")), getDb: () => fake.db, isDbConfigured: () => true }));
vi.mock("@/lib/teams/membership", () => ({ membersOfTeam: vi.fn(async () => []) }));
vi.mock("@/lib/leads/store", () => ({
  pickLeadsForResearch: vi.fn(async () => []), pickLeadsForRun: vi.fn(async () => []),
  pickLeadsForQualify: vi.fn(async () => []), pickLeadsForAssess: vi.fn(async () => []),
}));
vi.mock("@/lib/matches/store", () => ({ pickLeadsForMatch: vi.fn(async () => []) }));
vi.mock("@/lib/proposals/store", () => ({ pickLeadsForProposal: vi.fn(async () => []) }));
vi.mock("@/lib/chat/teamMessages", () => ({ postTeamMessage: vi.fn(async () => {}), userFirstName: vi.fn(async () => "Sam") }));

import { chainNext, enqueuePodStage } from "@/lib/pod/orchestrate";
import { membersOfTeam } from "@/lib/teams/membership";
import { postTeamMessage } from "@/lib/chat/teamMessages";

const agentRow = { id: "a1", userId: "u1", name: "Ann", role: "", goal: "", task: "", capabilities: ["research"] };

beforeEach(() => { fake.state.selects = []; fake.state.inserts = []; vi.mocked(postTeamMessage).mockClear(); });

describe("enqueuePodStage", () => {
  it("still skips when the team has a live running job for the stage", async () => {
    const live = { id: "j", kind: "research", status: "running", startedAt: new Date(), params: { teamId: "t1" } };
    fake.state.selects = [[live]];
    await enqueuePodStage("u1", "t1", "research", "a1");
    expect(fake.state.inserts).toHaveLength(0);
  });

  it("enqueues past a job stuck 'running' from a killed invocation", async () => {
    const dead = { id: "j", kind: "research", status: "running", startedAt: new Date(Date.now() - 30 * 60_000), params: { teamId: "t1" } };
    fake.state.selects = [[dead], [agentRow], []];
    await enqueuePodStage("u1", "t1", "research", "a1");
    expect(fake.state.inserts).toHaveLength(1);
  });
});

describe("chainNext", () => {
  const scout = { ...agentRow, id: "s1", name: "Leo Scout", capabilities: ["scrape"] };
  const assessor = { ...agentRow, id: "as1", name: "Ava", capabilities: ["assess"] };

  it("stops the chain when the stage moved 0 leads forward", async () => {
    vi.mocked(membersOfTeam).mockResolvedValue(["s1", "as1"]);
    // agentInfo(s1) for memberWithCapability, then again for the finisher.
    fake.state.selects = [[scout], [], [], [scout], [], []];
    await chainNext("u1", "t1", "scrape", 0);
    expect(fake.state.inserts).toHaveLength(0);
    expect(postTeamMessage).toHaveBeenCalledOnce();
    expect(vi.mocked(postTeamMessage).mock.calls[0][3]).toMatch(/^@Sam, I found no new leads.*I stopped the chain here\.$/);
  });

  it("hands a scrape with leads to the assessor", async () => {
    vi.mocked(membersOfTeam).mockResolvedValue(["s1", "as1"]);
    fake.state.selects = [
      [scout], [], [],            // memberWithCapability(scrape)
      [scout], [], [],            // finisher
      [scout], [], [], [assessor], [], [], // memberWithCapability(assess)
      [assessor], [], [],         // assessor info for the hand-off line
      [],                         // enqueuePodStage: no active jobs
      [assessor], [], [],         // enqueuePodStage: agentInfo
      [],                         // approvalMode
    ];
    await chainNext("u1", "t1", "scrape", 3);
    expect(fake.state.inserts).toHaveLength(1);
  });

  it("hands on a scrape run by an agent from another team", async () => {
    // Leo is not on team t1. The chat sent the scrape to him across teams.
    vi.mocked(membersOfTeam).mockResolvedValue(["as1"]);
    fake.state.selects = [
      [scout], [], [],            // finisher (the agent that ran the job)
      [assessor], [], [],         // memberWithCapability(assess)
      [assessor], [], [],         // assessor info for the hand-off line
      [],                         // enqueuePodStage: no active jobs
      [assessor], [], [],         // enqueuePodStage: agentInfo
      [],                         // approvalMode
    ];
    await chainNext("u1", "t1", "scrape", 7, "s1");
    expect(vi.mocked(postTeamMessage).mock.calls[0]).toEqual(["u1", "t1", "s1", "I found the new leads. @Ava, please review them."]);
    expect(fake.state.inserts).toHaveLength(1);
  });
});
