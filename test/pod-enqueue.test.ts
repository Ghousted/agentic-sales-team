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

import { chainNext, enqueuePodStage, leadOwnerForTeam } from "@/lib/pod/orchestrate";
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

  it("always asks first, whatever the agent's approval setting", async () => {
    fake.state.selects = [[], [agentRow], [], [{ settings: { research: { mode: "auto" } } }]];
    await enqueuePodStage("u1", "t1", "research", "a1");
    expect(fake.state.inserts[0]).toMatchObject({ status: "needs_approval", params: { teamId: "t1", pod: true } });
    expect(vi.mocked(postTeamMessage).mock.calls[0]).toEqual(["u1", "t1", "a1", "@Sam, I'm ready to research 0 leads. Proceed? ⟦approve:new-job⟧"]);
  });
});

describe("chainNext after a cancel", () => {
  const since = new Date("2026-10-23T01:00:00Z");

  it("doesn't hand on when the user cancelled the run while the step ran", async () => {
    vi.mocked(membersOfTeam).mockResolvedValue(["a1"]);
    fake.state.selects = [
      [{ params: { teamId: "t1" } }], // a job of this team dismissed after `since`
      [agentRow], [], [],            // finisher
    ];
    await chainNext("u1", "t1", "research", 5, "a1", undefined, since);
    expect(fake.state.inserts).toHaveLength(0);
    expect(vi.mocked(postTeamMessage).mock.calls).toEqual([["u1", "t1", "a1", "I researched 5 leads, but you stopped the run, so I didn't pass it on."]]);
  });

  it("still hands on when only another team's run was cancelled", async () => {
    const qualifier = { ...agentRow, id: "q1", name: "Quinn", capabilities: ["qualify"] };
    vi.mocked(membersOfTeam).mockResolvedValue(["a1", "q1"]);
    fake.state.selects = [
      [{ params: { teamId: "t2" } }], // dismissed, but on team t2
      [agentRow], [], [],             // finisher
      [agentRow], [], [], [qualifier], [], [], // nextCoverableStage: qualify
      [qualifier], [], [],            // hand-off line
      [],                             // enqueuePodStage: no active jobs
      [qualifier], [], [],            // enqueuePodStage: agentInfo
    ];
    await chainNext("u1", "t1", "research", 5, "a1", undefined, since);
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

  it("doesn't @mention itself when the same agent does the next stage", async () => {
    const ae = { ...agentRow, id: "ae1", name: "Ivan Torres", capabilities: ["outreach", "proposal"] };
    vi.mocked(membersOfTeam).mockResolvedValue(["ae1"]);
    fake.state.selects = [
      [ae], [], [],               // finisher
      [ae], [], [],               // nextCoverableStage: proposal
      [ae], [], [],               // hand-off line
      [],                         // enqueuePodStage: no active jobs
      [ae], [], [],               // enqueuePodStage: agentInfo
    ];
    await chainNext("u1", "t1", "outreach", 5, "ae1");
    expect(vi.mocked(postTeamMessage).mock.calls[0]).toEqual(["u1", "t1", "ae1", "I've drafted 5 emails. Next, I'll do the proposals."]);
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
    const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
    await chainNext("u1", "t1", "scrape", 2, "s1", ids);
    expect(vi.mocked(postTeamMessage).mock.calls[0]).toEqual(["u1", "t1", "s1", `I found 2 new leads. @Ava, please review them. ⟦leads:${ids.join(",")}⟧`]);
    expect(fake.state.inserts).toHaveLength(1);
  });
});

describe("leadOwnerForTeam", () => {
  const assessor = { ...agentRow, id: "as1", name: "Ava", capabilities: ["assess"] };

  it("keeps the leads with a runner who is on the team", async () => {
    vi.mocked(membersOfTeam).mockResolvedValue(["s1", "as1"]);
    expect(await leadOwnerForTeam("u1", "t1", "s1")).toBe("s1");
  });

  it("gives an outsider's leads to the team's assessor, so the assess stage can see them", async () => {
    vi.mocked(membersOfTeam).mockResolvedValue(["a1", "as1"]);
    fake.state.selects = [[agentRow], [], [], [assessor], [], []]; // memberWithCapability(assess)
    expect(await leadOwnerForTeam("u1", "t1", "s1")).toBe("as1");
  });

  it("falls back to the first member when the team has no assessor", async () => {
    vi.mocked(membersOfTeam).mockResolvedValue(["a1"]);
    fake.state.selects = [[agentRow], [], []];
    expect(await leadOwnerForTeam("u1", "t1", "s1")).toBe("a1");
  });

  it("keeps the leads with the runner when the team has no members", async () => {
    vi.mocked(membersOfTeam).mockResolvedValue([]);
    expect(await leadOwnerForTeam("u1", "t1", "s1")).toBe("s1");
  });
});
