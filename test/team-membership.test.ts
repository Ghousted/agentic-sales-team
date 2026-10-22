import { beforeEach, describe, expect, it, vi } from "vitest";

// Scripted Drizzle stand-in: each awaited select returns the next queued result.
const fake = vi.hoisted(() => {
  const state = { selects: [] as unknown[][] };
  const chain = (result: () => unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "where", "limit"]) c[m] = () => c;
    c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve().then(result).then(res, rej);
    return c;
  };
  return { state, db: { select: () => chain(() => state.selects.shift() ?? []) } };
});

vi.mock("@/lib/db", async () => ({ ...(await import("@/lib/db/schema")), getDb: () => fake.db, isDbConfigured: () => true }));

import { membersOfTeam } from "@/lib/teams/membership";

beforeEach(() => { fake.state.selects = []; });

describe("membersOfTeam", () => {
  it("leaves out agents the user removed, keeps paused ones", async () => {
    // The team_members override, then the user's removed agent_states rows.
    fake.state.selects = [[{ members: ["a1", "a2", "a3"] }], [{ agentId: "a2" }]];
    expect(await membersOfTeam("u1", "t1")).toEqual(["a1", "a3"]);
  });
});
