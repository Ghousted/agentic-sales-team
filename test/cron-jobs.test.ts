import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Same scripted Drizzle stand-in as jobs-runner.test.ts: the reaper's column
// select reads `running`, every other select returns the next queued result.
const fake = vi.hoisted(() => {
  const state = { running: [] as unknown[], selects: [] as unknown[][], updates: [] as Record<string, unknown>[] };
  const chain = (result: () => unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "where", "orderBy", "limit", "returning", "values"]) c[m] = () => c;
    c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve().then(result).then(res, rej);
    return c;
  };
  const db = {
    select: (fields?: unknown) => chain(() => (fields ? state.running : state.selects.shift() ?? [])),
    update: () => ({ set: (v: Record<string, unknown>) => { state.updates.push(v); return chain(() => [{ id: "x" }]); } }),
  };
  return { state, db };
});

vi.mock("@/lib/db", async () => ({ ...(await import("@/lib/db/schema")), getDb: () => fake.db, isDbConfigured: () => true }));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => null }));
vi.mock("@/lib/leads/store", () => ({
  pickLeadsForRun: vi.fn(async () => []), applyOutreachResult: vi.fn(),
  pickLeadsForResearch: vi.fn(async () => []), applyResearchResult: vi.fn(async () => {}),
  pickLeadsForQualify: vi.fn(async () => []), applyQualifyResult: vi.fn(),
  pickLeadsForAssess: vi.fn(async () => []), applyAssessResult: vi.fn(),
}));
vi.mock("@/lib/ai/research", () => ({ draftResearch: vi.fn(async () => ({ summary: "s" })) }));
vi.mock("@/lib/ai/assess", () => ({ assessLead: vi.fn() }));
vi.mock("@/lib/ai/outreach", () => ({ draftOutreach: vi.fn() }));
vi.mock("@/lib/ai/qualify", () => ({ qualifyLead: vi.fn() }));
vi.mock("@/lib/ai/proposal", () => ({ draftProposal: vi.fn() }));
vi.mock("@/lib/ai/match", () => ({ matchLead: vi.fn() }));
vi.mock("@/lib/proposals/store", () => ({ pickLeadsForProposal: vi.fn(async () => []), addProposal: vi.fn() }));
vi.mock("@/lib/matches/store", () => ({ pickLeadsForMatch: vi.fn(async () => []), addMatches: vi.fn() }));
vi.mock("@/lib/products/store", () => ({ searchProducts: vi.fn(async () => []) }));
vi.mock("@/lib/pod/orchestrate", () => ({ chainNext: vi.fn(async () => {}) }));

const agent = { id: "a1", name: "Ann", role: "", goal: "", task: "" };
const researchJob = (id: string, userId: string) => ({
  id, userId, agentId: "a1", kind: "research", status: "queued", params: { agent, leadIds: null, batchSize: 5 },
});
const cronReq = (auth?: string) => new Request("http://x/api/cron/jobs", { headers: auth ? { authorization: auth } : {} });

// Imported lazily so the old code (no cron route) fails each test, not the file.
const cronRoute = () => import("@/app/api/cron/jobs/route");

beforeEach(() => {
  fake.state.running = [];
  fake.state.selects = [];
  fake.state.updates = [];
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "s3cret");
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("GET /api/cron/jobs", () => {
  it("refuses a call with no secret, a wrong secret, or when CRON_SECRET is unset", async () => {
    const { GET } = await cronRoute();
    expect((await GET(cronReq())).status).toBe(401);
    expect((await GET(cronReq("Bearer nope"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(cronReq("Bearer "))).status).toBe(401);
    expect(fake.state.updates).toHaveLength(0);
  });

  it("runs queued jobs for every user in one tick, each under its own user", async () => {
    const { GET } = await cronRoute();
    const { pickLeadsForResearch } = await import("@/lib/leads/store");
    fake.state.selects = [[researchJob("j1", "u1")], [researchJob("j2", "u2")]];
    const res = await GET(cronReq("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect((await res.json()).processed).toBe(2);
    expect(vi.mocked(pickLeadsForResearch).mock.calls.map((c) => c[0])).toEqual(["u1", "u2"]);
    expect(fake.state.updates.filter((u) => u.status === "done")).toHaveLength(2);
  });

  it("fails stale 'running' jobs even with no user session", async () => {
    const { GET } = await cronRoute();
    fake.state.running = [{ id: "dead", kind: "qualify", status: "running", startedAt: new Date(Date.now() - 20 * 60_000) }];
    await GET(cronReq("Bearer s3cret"));
    expect(String(fake.state.updates.find((u) => u.status === "failed")?.error)).toMatch(/timed out/i);
  });
});

describe("middleware", () => {
  it("lets the cron path through without a session cookie (the route checks the secret)", async () => {
    vi.stubEnv("AUTH_SECRET", "x".repeat(32));
    const { middleware } = await import("@/middleware");
    const res = await middleware(new NextRequest("http://x/api/cron/jobs"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("still redirects other API routes without a session", async () => {
    vi.stubEnv("AUTH_SECRET", "x".repeat(32));
    const { middleware } = await import("@/middleware");
    const res = await middleware(new NextRequest("http://x/api/jobs/run"));
    expect(res.headers.get("location")).toMatch(/\/$/);
  });
});
