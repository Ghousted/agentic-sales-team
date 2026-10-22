import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A scripted stand-in for the Drizzle client: the reaper's column select reads
// `running`, every other select returns the next queued result, and every
// update's .set() payload is recorded.
const fake = vi.hoisted(() => {
  const state = { running: [] as unknown[], selects: [] as unknown[][], updates: [] as Record<string, unknown>[], inserts: [] as unknown[], claimOk: true };
  const chain = (result: () => unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "where", "orderBy", "limit", "returning", "values"]) c[m] = () => c;
    c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve().then(result).then(res, rej);
    return c;
  };
  const db = {
    select: (fields?: unknown) => chain(() => (fields ? state.running : state.selects.shift() ?? [])),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        state.updates.push(v);
        return chain(() => (v.status === "running" && !state.claimOk ? [] : [{ id: "x" }]));
      },
    }),
    insert: () => ({ values: (v: unknown) => { state.inserts.push(v); return chain(() => [{ id: "new-job" }]); } }),
  };
  return { state, db };
});

vi.mock("@/lib/db", async () => ({ ...(await import("@/lib/db/schema")), getDb: () => fake.db, isDbConfigured: () => true }));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => ({ userId: "u1" }) }));
vi.mock("@/lib/leads/store", () => ({
  pickLeadsForRun: vi.fn(async () => []), applyOutreachResult: vi.fn(),
  pickLeadsForResearch: vi.fn(async () => []), applyResearchResult: vi.fn(async () => {}),
  pickLeadsForQualify: vi.fn(async () => []), applyQualifyResult: vi.fn(),
  pickLeadsForAssess: vi.fn(async () => []), applyAssessResult: vi.fn(),
  addScrapedLeads: vi.fn(async () => []),
}));
vi.mock("@/lib/ai/research", () => ({ draftResearch: vi.fn() }));
vi.mock("@/lib/ai/assess", () => ({ assessLead: vi.fn() }));
vi.mock("@/lib/ai/outreach", () => ({ draftOutreach: vi.fn() }));
vi.mock("@/lib/ai/qualify", () => ({ qualifyLead: vi.fn() }));
vi.mock("@/lib/ai/proposal", () => ({ draftProposal: vi.fn() }));
vi.mock("@/lib/ai/match", () => ({ matchLead: vi.fn() }));
vi.mock("@/lib/ai/openrouter", () => ({ isAIConfigured: () => true }));
vi.mock("@/lib/proposals/store", () => ({ pickLeadsForProposal: vi.fn(async () => []), addProposal: vi.fn() }));
vi.mock("@/lib/matches/store", () => ({ pickLeadsForMatch: vi.fn(async () => []), addMatches: vi.fn() }));
vi.mock("@/lib/products/store", () => ({ searchProducts: vi.fn(async () => []) }));
vi.mock("@/lib/scrape/firecrawl", () => ({ runFirecrawlScrape: vi.fn(), isFirecrawlConfigured: () => true }));
vi.mock("@/lib/pod/orchestrate", () => ({ chainNext: vi.fn(async () => {}), leadOwnerForTeam: vi.fn(async (_u: string, _t: string, a: string) => a) }));

import { POST as runJobs } from "@/app/api/jobs/run/route";
import { POST as runScrape } from "@/app/api/scrape/route";
import { pickLeadsForResearch } from "@/lib/leads/store";
import { draftResearch } from "@/lib/ai/research";
import { runFirecrawlScrape } from "@/lib/scrape/firecrawl";
import { chainNext } from "@/lib/pod/orchestrate";
import { pickLeadsForMatch, addMatches } from "@/lib/matches/store";
import { matchLead } from "@/lib/ai/match";
import { isStale, staleAfterMs } from "@/lib/jobs/runtime";

const agent = { id: "a1", name: "Ann", role: "", goal: "", task: "" };
const researchJob = (pod = false) => ({
  id: "j1", userId: "u1", agentId: "a1", kind: "research", status: "queued",
  params: { agent, leadIds: null, batchSize: 5, ...(pod ? { pod: true, teamId: "t1" } : {}) },
});
const lead = (id: string) => ({ id, name: id, title: "", company: "", platform: "web" });
const doneUpdate = () => fake.state.updates.find((u) => u.status === "done");

beforeEach(() => {
  fake.state.running = [];
  fake.state.selects = [];
  fake.state.updates = [];
  fake.state.inserts = [];
  fake.state.claimOk = true;
  vi.clearAllMocks();
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("isStale", () => {
  const now = new Date("2026-10-21T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);
  it("counts a running job past maxDuration plus grace as stale", () => {
    expect(isStale({ kind: "research", status: "running", startedAt: ago(staleAfterMs("research") + 1) }, now)).toBe(true);
    expect(isStale({ kind: "scrape", status: "running", startedAt: ago(staleAfterMs("scrape") + 1) }, now)).toBe(true);
  });
  it("leaves young, queued and finished jobs alone", () => {
    expect(isStale({ kind: "research", status: "running", startedAt: ago(staleAfterMs("research") - 1) }, now)).toBe(false);
    expect(isStale({ kind: "research", status: "queued", startedAt: null }, now)).toBe(false);
    expect(isStale({ kind: "scrape", status: "done", startedAt: ago(3_600_000) }, now)).toBe(false);
  });
  it("gives scrape (60s route) a shorter limit than the 300s runner", () => {
    expect(staleAfterMs("scrape")).toBeLessThan(staleAfterMs("research"));
    expect(staleAfterMs("scrape")).toBeGreaterThan(60_000);
    expect(staleAfterMs("research")).toBeGreaterThan(300_000);
  });
});

describe("POST /api/jobs/run", () => {
  it("fails a job left 'running' by a killed invocation", async () => {
    const stale = { id: "dead", kind: "qualify", status: "running", startedAt: new Date(Date.now() - 20 * 60_000) };
    fake.state.running = [stale];
    await runJobs();
    const reaped = fake.state.updates.find((u) => u.status === "failed");
    expect(reaped).toBeDefined();
    expect(String(reaped!.error)).toMatch(/timed out/i);
  });

  it("keeps a finished stage 'done' when the hand-off to the next stage throws", async () => {
    fake.state.selects = [[researchJob(true)]];
    vi.mocked(pickLeadsForResearch).mockResolvedValueOnce([lead("l1")] as never);
    vi.mocked(draftResearch).mockResolvedValueOnce({ summary: "s" } as never);
    vi.mocked(chainNext).mockRejectedValueOnce(new Error("postTeamMessage blew up"));
    const res = await runJobs();
    expect(res.status).toBe(200);
    expect(chainNext).toHaveBeenCalledOnce();
    expect(doneUpdate()?.result).toEqual({ briefed: 1, failed: 0 });
    expect(fake.state.updates.some((u) => u.status === "failed")).toBe(false);
  });

  it("stops starting leads when the time budget runs out and records the rest as skipped", async () => {
    let clock = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    fake.state.selects = [[researchJob()]];
    vi.mocked(pickLeadsForResearch).mockResolvedValueOnce([lead("l1"), lead("l2"), lead("l3")] as never);
    vi.mocked(draftResearch).mockImplementation(async () => { clock += 100_000; return { summary: "s" } as never; });
    await runJobs();
    expect(draftResearch).toHaveBeenCalledTimes(2);
    expect(doneUpdate()?.result).toEqual({ briefed: 2, failed: 0, skipped: 1 });
  });

  it("gives up on a lead whose AI call hangs and moves on", async () => {
    vi.useFakeTimers();
    fake.state.selects = [[researchJob()]];
    vi.mocked(pickLeadsForResearch).mockResolvedValueOnce([lead("l1"), lead("l2")] as never);
    vi.mocked(draftResearch)
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce({ summary: "s" } as never);
    const pending = runJobs();
    await vi.advanceTimersByTimeAsync(80_000);
    await pending;
    expect(doneUpdate()?.result).toEqual({ briefed: 1, failed: 1 });
  });
});

describe("POST /api/scrape", () => {
  const scrapeReq = () => new Request("http://x/api/scrape", { method: "POST", body: JSON.stringify({ jobId: "s1" }) });
  const scrapeJob = (status = "queued") => ({ id: "s1", userId: "u1", agentId: "a1", kind: "scrape", status, params: { agent } });

  it("marks a hung search failed before the function is killed", async () => {
    vi.useFakeTimers();
    fake.state.selects = [[scrapeJob()]];
    vi.mocked(runFirecrawlScrape).mockImplementationOnce(() => new Promise(() => {}));
    const pending = runScrape(scrapeReq());
    await vi.advanceTimersByTimeAsync(50_000);
    const res = await pending;
    expect(res.status).toBe(500);
    const failed = fake.state.updates.find((u) => u.status === "failed");
    expect(String(failed?.error)).toMatch(/timed out/i);
  });

  it("doesn't call a reaped search 'already running'", async () => {
    const stale = { id: "s1", kind: "scrape", status: "running", startedAt: new Date(Date.now() - 10 * 60_000) };
    fake.state.running = [stale];
    fake.state.selects = [[scrapeJob("failed")]];
    fake.state.claimOk = false;
    const res = await runScrape(scrapeReq());
    const body = await res.json();
    expect(body.note).toBeUndefined();
    expect(res.status).toBe(409);
  });
});

describe("match job", () => {
  const matchJob = { ...researchJob(), kind: "match" };

  it("stamps leads nothing fit, counts only leads that got a match, and leaves failed or unrunnable leads for later", async () => {
    fake.state.selects = [[matchJob]];
    vi.mocked(pickLeadsForMatch).mockResolvedValueOnce([lead("fit"), lead("nofit"), lead("nocatalog"), lead("error")] as never);
    vi.mocked(matchLead)
      .mockResolvedValueOnce([{ productId: "p1", score: 90, reason: "budget" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("LLM down"));
    await runJobs();
    expect(vi.mocked(addMatches).mock.calls.map((c) => c[2])).toEqual(["fit", "nofit"]);
    expect(doneUpdate()?.result).toEqual({ matched: 1, failed: 1 });
  });
});
