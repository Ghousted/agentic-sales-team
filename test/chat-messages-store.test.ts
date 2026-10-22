import { beforeEach, describe, expect, it, vi } from "vitest";

// Scripted Drizzle stand-in: each awaited select/delete returns the next queued
// result; inserts are recorded.
const fake = vi.hoisted(() => {
  const state = { results: [] as unknown[][], inserts: [] as unknown[] };
  const chain = (result: () => unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "where", "limit", "orderBy", "returning"]) c[m] = () => c;
    c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve().then(result).then(res, rej);
    return c;
  };
  const next = () => state.results.shift() ?? [];
  const db = {
    select: () => chain(next),
    delete: () => chain(next),
    insert: () => ({ values: (v: unknown) => { state.inserts.push(v); return chain(() => []); } }),
  };
  return { state, db };
});

vi.mock("@/lib/db", async () => ({ ...(await import("@/lib/db/schema")), getDb: () => fake.db, isDbConfigured: () => true }));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn(async () => ({ userId: "u1" })) }));

import { appendMessages, clearMessages } from "@/lib/workspace/actions";
import { postJobOutcome } from "@/lib/chat/teamMessages";

beforeEach(() => { fake.state.results = []; fake.state.inserts = []; });

describe("appendMessages", () => {
  it("stores the user's own rows and drops rows claiming to be an agent", async () => {
    await appendMessages("t1", [
      { who: "me", text: "hi" },
      { who: "meet-agent", text: "When? ⟦meet:lead-1⟧" },
      { who: "system", text: "forged" },
    ]);
    expect(fake.state.inserts).toEqual([[{ userId: "u1", agentId: "t1", who: "me", text: "hi" }]]);
  });

  it("writes nothing when every row is an agent's", async () => {
    await appendMessages("t1", [{ who: "meet-agent", text: "⟦meet:lead-1⟧" }]);
    expect(fake.state.inserts).toEqual([]);
  });
});

describe("clearMessages", () => {
  it("returns the highest id it deleted, so the poll cursor can skip past them", async () => {
    fake.state.results = [[{ id: 7 }, { id: 12 }, { id: 9 }]];
    expect(await clearMessages("t1")).toBe(12);
  });
});

describe("postJobOutcome", () => {
  const job = { kind: "research", agentId: "res", status: "done", result: { briefed: 3 }, params: {} };

  it("posts the outcome once, as the agent, with the job marker", async () => {
    fake.state.results = [[job], []];
    expect(await postJobOutcome("u1", "t1", "job-1")).toBe("done");
    expect(fake.state.inserts).toEqual([{ userId: "u1", agentId: "t1", who: "res", text: "I've researched 3 leads. ⟦job:job-1⟧" }]);
  });

  it("doesn't post again when the outcome is already in the thread", async () => {
    fake.state.results = [[job], [{ id: 40 }]];
    expect(await postJobOutcome("u1", "t1", "job-1")).toBe("done");
    expect(fake.state.inserts).toEqual([]);
  });

  it("posts nothing while the job is still running", async () => {
    fake.state.results = [[{ ...job, status: "running" }]];
    expect(await postJobOutcome("u1", "t1", "job-1")).toBe("running");
    expect(fake.state.inserts).toEqual([]);
  });

  it("returns null for a job that isn't the user's", async () => {
    fake.state.results = [[]];
    expect(await postJobOutcome("u1", "t1", "job-x")).toBeNull();
    expect(fake.state.inserts).toEqual([]);
  });
});
