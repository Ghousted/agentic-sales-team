import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Same scripted Drizzle stand-in as cron-jobs.test.ts: the reaper's column
// select reads `running`, every other select returns the next queued result.
// `claims` scripts the claim update's rows (default: the claim succeeds).
const fake = vi.hoisted(() => {
  const state = { running: [] as unknown[], selects: [] as unknown[][], updates: [] as Record<string, unknown>[], claims: [] as unknown[][] };
  const chain = (result: () => unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "where", "orderBy", "limit", "returning", "values"]) c[m] = () => c;
    c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve().then(result).then(res, rej);
    return c;
  };
  const db = {
    select: (fields?: unknown) => chain(() => (fields ? state.running : state.selects.shift() ?? [])),
    update: () => ({ set: (v: Record<string, unknown>) => {
      state.updates.push(v);
      return chain(() => (v.status === "running" ? state.claims.shift() ?? [{ id: "x" }] : [{ id: "x" }]));
    } }),
  };
  return { state, db };
});

vi.mock("@/lib/db", async () => ({ ...(await import("@/lib/db/schema")), getDb: () => fake.db, isDbConfigured: () => true }));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => null }));
vi.mock("@/lib/scrape/firecrawl", () => ({ runFirecrawlScrape: vi.fn(async () => [{ name: "P" }]), isFirecrawlConfigured: () => true }));
vi.mock("@/lib/ai/openrouter", () => ({ isAIConfigured: () => true }));
vi.mock("@/lib/leads/store", () => ({ addScrapedLeads: vi.fn(async () => ["l1", "l2", "l3"]) }));
vi.mock("@/lib/pod/orchestrate", () => ({ chainNext: vi.fn(async () => {}), leadOwnerForTeam: vi.fn(async (_u: string, _t: string, a: string) => a) }));

const scrapeJob = (id: string, userId: string, extra: Record<string, unknown> = {}) => ({
  id, userId, agentId: "a1", kind: "scrape", status: "queued", params: { target: 5, pod: true, teamId: "t1", ...extra },
});
const cronReq = (auth?: string) => new Request("http://x/api/cron/scrape", { headers: auth ? { authorization: auth } : {} });

// Imported lazily so the old code (no cron scrape route) fails each test, not the file.
const cronRoute = () => import("@/app/api/cron/scrape/route");

beforeEach(() => {
  fake.state.running = [];
  fake.state.selects = [];
  fake.state.updates = [];
  fake.state.claims = [];
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "s3cret");
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("GET /api/cron/scrape", () => {
  it("refuses a call with no secret, a wrong secret, or when CRON_SECRET is unset", async () => {
    const { GET } = await cronRoute();
    expect((await GET(cronReq())).status).toBe(401);
    expect((await GET(cronReq("Bearer nope"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(cronReq("Bearer "))).status).toBe(401);
    expect(fake.state.updates).toHaveLength(0);
  });

  it("runs a queued scrape no tab kicked, under its owner, and chains on", async () => {
    const { GET } = await cronRoute();
    const { addScrapedLeads } = await import("@/lib/leads/store");
    const { chainNext } = await import("@/lib/pod/orchestrate");
    fake.state.selects = [[scrapeJob("s1", "u2")]];
    const res = await GET(cronReq("Bearer s3cret"));
    expect(await res.json()).toEqual({ processed: 1, leadsFound: 3 });
    expect(vi.mocked(addScrapedLeads).mock.calls[0][0]).toBe("u2");
    const done = fake.state.updates.find((u) => u.status === "done")?.result as { leadsFound: number; leadIds: string[]; steps: { id: string; status: string; label: string }[] };
    expect(done).toMatchObject({ leadsFound: 3, leadIds: ["l1", "l2", "l3"] });
    expect(done.steps.at(-1)).toMatchObject({ id: "save", status: "done", label: "3 new leads saved" });
    // The live timeline: the save step was written while the job still ran.
    expect(fake.state.updates.some((u) => !u.status && (u.result as { steps?: unknown[] })?.steps?.length)).toBe(true);
    expect(vi.mocked(chainNext)).toHaveBeenCalledWith("u2", "t1", "scrape", 3, "a1", ["l1", "l2", "l3"]);
  });

  it("files a team scrape's leads under the owner the team picks, and still credits the runner", async () => {
    const { GET } = await cronRoute();
    const { addScrapedLeads } = await import("@/lib/leads/store");
    const { chainNext, leadOwnerForTeam } = await import("@/lib/pod/orchestrate");
    vi.mocked(leadOwnerForTeam).mockResolvedValueOnce("as1"); // a1 is from another team
    fake.state.selects = [[scrapeJob("s1", "u2")]];
    await GET(cronReq("Bearer s3cret"));
    expect(vi.mocked(leadOwnerForTeam)).toHaveBeenCalledWith("u2", "t1", "a1");
    expect(vi.mocked(addScrapedLeads).mock.calls[0][1]).toBe("as1");
    expect(vi.mocked(chainNext)).toHaveBeenCalledWith("u2", "t1", "scrape", 3, "a1", ["l1", "l2", "l3"]);
  });

  it("keeps a non-team scrape's leads with the agent that ran it", async () => {
    const { GET } = await cronRoute();
    const { addScrapedLeads } = await import("@/lib/leads/store");
    const { leadOwnerForTeam } = await import("@/lib/pod/orchestrate");
    fake.state.selects = [[scrapeJob("s1", "u2", { pod: false, teamId: null })]];
    await GET(cronReq("Bearer s3cret"));
    expect(vi.mocked(leadOwnerForTeam)).not.toHaveBeenCalled();
    expect(vi.mocked(addScrapedLeads).mock.calls[0][1]).toBe("a1");
  });

  it("marks the job failed with the reason when the scrape throws", async () => {
    const { GET } = await cronRoute();
    const { runFirecrawlScrape } = await import("@/lib/scrape/firecrawl");
    vi.mocked(runFirecrawlScrape).mockRejectedValueOnce(new Error("Lead extraction failed: boom"));
    fake.state.selects = [[scrapeJob("s1", "u1")]];
    const res = await GET(cronReq("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(String(fake.state.updates.find((u) => u.status === "failed")?.error)).toMatch(/boom/);
  });

  it("moves on when a browser kick claimed the job first", async () => {
    const { GET } = await cronRoute();
    fake.state.selects = [[scrapeJob("s1", "u1")], [scrapeJob("s2", "u1")]];
    fake.state.claims = [[]]; // s1's claim loses the race
    const res = await GET(cronReq("Bearer s3cret"));
    expect((await res.json()).processed).toBe(1);
    expect(fake.state.updates.filter((u) => u.status === "done")).toHaveLength(1);
  });
});

describe("middleware", () => {
  it("lets the cron scrape path through without a session cookie", async () => {
    vi.stubEnv("AUTH_SECRET", "x".repeat(32));
    const { middleware } = await import("@/middleware");
    const res = await middleware(new NextRequest("http://x/api/cron/scrape"));
    expect(res.headers.get("location")).toBeNull();
  });
});
