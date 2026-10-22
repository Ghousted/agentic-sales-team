import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
import * as schema from "@/lib/db/schema";

// Every query the store sends, as rendered SQL + params.
const sent: { sql: string; params: unknown[] }[] = [];
const fakeDb = Object.assign(drizzle(async (sql, params) => {
  sent.push({ sql, params });
  return { rows: [] };
}, { schema }), {
  // neon-http's batch runs the queries in one transaction; here they just run in order.
  batch: async (queries: PromiseLike<unknown>[]) => { for (const q of queries) await q; },
});

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => fakeDb,
  isDbConfigured: () => true,
}));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => null }));
vi.mock("@/lib/teams/membership", () => ({ teammatesOf: async (_u: string, agentId: string) => [agentId] }));

const { pickLeadsForMatch, addMatches } = await import("@/lib/matches/store");

beforeEach(() => { sent.length = 0; });

describe("pickLeadsForMatch", () => {
  it("skips leads the matchmaker already ran on, in SQL before the limit", async () => {
    await pickLeadsForMatch("user-1", "agent-1", undefined, 5);
    expect(sent).toHaveLength(1);
    const { sql, params } = sent[0];
    expect(sql).toMatch(/"leads"\."matched_at" is null/);
    expect(sql).toMatch(/limit \$\d/);
    expect(params).toContain(5);
  });
});

describe("addMatches", () => {
  it("stamps matchedAt when nothing fit, so the lead leaves the queue", async () => {
    await addMatches("user-1", "agent-1", "lead-1", []);
    expect(sent).toHaveLength(1);
    expect(sent[0].sql).toMatch(/^update "leads" set "matched_at" = \$\d/);
    expect(sent[0].params).toContain("lead-1");
  });

  it("writes the matches and stamps matchedAt", async () => {
    await addMatches("user-1", "agent-1", "lead-1", [{ productId: "p1", score: 90, reason: "budget" }]);
    expect(sent.map((q) => q.sql.split(" ").slice(0, 3).join(" "))).toEqual(['insert into "matches"', 'update "leads" set']);
    expect(sent[1].sql).toMatch(/"matched_at" = \$\d/);
  });
});
