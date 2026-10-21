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

import { enqueuePodStage } from "@/lib/pod/orchestrate";

const agentRow = { id: "a1", userId: "u1", name: "Ann", role: "", goal: "", task: "", capabilities: ["research"] };

beforeEach(() => { fake.state.selects = []; fake.state.inserts = []; });

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
