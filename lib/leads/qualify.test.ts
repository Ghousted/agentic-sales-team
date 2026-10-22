import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
import * as schema from "@/lib/db/schema";

// Every query the store sends, as rendered SQL + params.
const sent: { sql: string; params: unknown[] }[] = [];
const fakeDb = drizzle(async (sql, params) => {
  sent.push({ sql, params });
  return { rows: [] };
}, { schema });

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => fakeDb,
}));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => null }));
vi.mock("@/lib/teams/membership", () => ({
  teammatesOf: async (_u: string, agentId: string) => [agentId],
  membersOfTeam: async () => [],
}));

const { pickLeadsForQualify, applyQualifyResult } = await import("@/lib/leads/store");

beforeEach(() => { sent.length = 0; });

describe("pickLeadsForQualify", () => {
  it("selects leads the qualify stage hasn't run on, not leads with score 0", async () => {
    await pickLeadsForQualify("user-1", "agent-1", undefined, 20);
    expect(sent).toHaveLength(1);
    const { sql, params } = sent[0];
    expect(sql).toMatch(/"leads"\."qualified_at" is null/);
    // assess and outreach already set score >= 1, so filtering on score = 0 picks nothing.
    expect(sql).not.toMatch(/"leads"\."score" = /);
    expect(params).not.toContain(0);
  });
});

describe("applyQualifyResult", () => {
  it("stamps qualifiedAt along with the score", async () => {
    const lead = { id: "lead-1", name: "Ada" } as Parameters<typeof applyQualifyResult>[2];
    await applyQualifyResult("user-1", "agent-1", lead, { score: 80, tier: "hot", reason: "fit" });
    const update = sent.find((q) => q.sql.startsWith('update "leads"'));
    expect(update?.sql).toMatch(/"qualified_at" = \$\d/);
    expect(update?.sql).toMatch(/"score" = \$\d/);
  });
});
