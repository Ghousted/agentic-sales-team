import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
import * as schema from "@/lib/db/schema";
import { DAILY_JOB_QUOTA, DAILY_SCRAPE_QUOTA, MAX_BATCH_SIZE, MAX_INSTRUCTION_CHARS, MAX_SCRAPE_TARGET } from "./limits";

// Every statement enqueueJob sends (with its params), and the rows the fake database answers with.
const sent: { sql: string; params: unknown[] }[] = [];
let recent = { total: 0, scrapes: 0 };

const db = drizzle(async (sql, params) => {
  sent.push({ sql, params });
  if (/^select count/.test(sql)) return { rows: [[recent.total, recent.scrapes]] };
  if (/^insert into "jobs"/.test(sql)) return { rows: [["job-1"]] };
  return { rows: [] };
}, { schema });

vi.mock("@/lib/db", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/db")>()),
  isDbConfigured: () => true,
  getDb: () => db,
}));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => ({ userId: "00000000-0000-4000-8000-00000000000a" }) }));
vi.mock("@/lib/pod/orchestrate", () => ({
  agentInfo: async (_u: string, id: string) => ({ id, name: "Scout", role: "r", goal: "g", task: "t", capabilities: ["scrape", "outreach"] }),
}));

const { enqueueJob } = await import("./actions");

const agent = { id: "agent-1" };
const inserted = () => sent.filter((s) => /^insert into "jobs"/.test(s.sql));
const storedParams = () => JSON.parse(inserted()[0].params.find((p) => typeof p === "string" && p.startsWith("{")) as string);

beforeEach(() => {
  sent.length = 0;
  recent = { total: 0, scrapes: 0 };
});

describe("enqueueJob size limits", () => {
  it("clamps batchSize and target from the client", async () => {
    const res = await enqueueJob({ agent, kind: "scrape", batchSize: 1_000_000, target: 9_999, instruction: "founders in Manila" });
    expect(res).toEqual({ jobId: "job-1" });
    const p = storedParams();
    expect(p.batchSize).toBe(MAX_BATCH_SIZE);
    expect(p.target).toBe(MAX_SCRAPE_TARGET);
  });

  it("refuses a lead list longer than one batch", async () => {
    const leadIds = Array.from({ length: MAX_BATCH_SIZE + 1 }, (_, i) => "lead-" + i);
    const res = await enqueueJob({ agent, kind: "outreach", leadIds, batchSize: leadIds.length });
    expect(res).toHaveProperty("error");
    expect(inserted()).toHaveLength(0);
  });

  it("refuses an over-long scrape instruction", async () => {
    const res = await enqueueJob({ agent, kind: "scrape", instruction: "x".repeat(MAX_INSTRUCTION_CHARS + 1) });
    expect(res).toHaveProperty("error");
    expect(inserted()).toHaveLength(0);
  });
});

describe("enqueueJob daily quota", () => {
  it("refuses any job once the daily job quota is used", async () => {
    recent = { total: DAILY_JOB_QUOTA, scrapes: 0 };
    const res = await enqueueJob({ agent, kind: "outreach" });
    expect(res).toHaveProperty("error");
    expect(inserted()).toHaveLength(0);
  });

  it("refuses a scrape once the scrape quota is used, but not other jobs", async () => {
    recent = { total: DAILY_SCRAPE_QUOTA, scrapes: DAILY_SCRAPE_QUOTA };
    expect(await enqueueJob({ agent, kind: "scrape", instruction: "founders in Manila" })).toHaveProperty("error");
    expect(inserted()).toHaveLength(0);
    expect(await enqueueJob({ agent, kind: "outreach" })).toEqual({ jobId: "job-1" });
  });

  it("counts only this user's jobs from the last 24 hours", async () => {
    await enqueueJob({ agent, kind: "outreach" });
    const count = sent.find((s) => /^select count/.test(s.sql))!;
    expect(count.sql).toMatch(/"user_id" = \$1 and "jobs"."created_at" >= \$2/);
    const since = new Date(count.params[1] as string).getTime();
    expect(Math.abs(Date.now() - 24 * 60 * 60 * 1000 - since)).toBeLessThan(60_000);
  });
});
