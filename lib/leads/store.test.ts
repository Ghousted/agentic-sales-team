import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
import * as schema from "@/lib/db/schema";

// pg-proxy hands us each generated statement. A lead with a live draft makes
// the draft insert return no row, the way ON CONFLICT DO NOTHING does against
// outreach_drafts_live_lead_idx.
const USER = "00000000-0000-4000-8000-000000000001";
const LEAD = "00000000-0000-4000-8000-000000000002";
let hasLiveDraft = false;
let statements: string[] = [];

const fakeDb = drizzle(async (sql) => {
  const q = sql.toLowerCase();
  statements.push(q);
  if (q.startsWith(`insert into "outreach_drafts"`)) return { rows: hasLiveDraft ? [] : [["draft-1"]] };
  return { rows: [] };
}, { schema });

vi.mock("@/lib/db", async () => ({
  ...(await import("@/lib/db/schema")),
  isDbConfigured: () => true,
  getDb: () => fakeDb,
}));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => null }));

const { applyOutreachResult } = await import("./store");

const lead = {
  id: LEAD, userId: USER, agentId: "outreach", name: "Jane", title: "", company: "Acme", email: "j@acme.com",
  status: "new", score: 0, source: "manual", review: "accepted", profileUrl: null, platform: null, research: null,
  fitReason: "", qualifiedAt: null, matchedAt: null, createdAt: new Date(), updatedAt: new Date(),
};
const result = { subject: "Hi", body: "Hello", rationale: "", score: 60, stage: "contacted" };

beforeEach(() => { hasLiveDraft = false; statements = []; });

describe("applyOutreachResult", () => {
  it("inserts with ON CONFLICT DO NOTHING, then updates the lead and logs activity", async () => {
    expect(await applyOutreachResult(USER, "outreach", lead, result)).toBe(true);
    expect(statements[0]).toContain("on conflict do nothing");
    expect(statements.some((s) => s.startsWith(`update "leads"`))).toBe(true);
    expect(statements.some((s) => s.startsWith(`insert into "activity"`))).toBe(true);
  });

  it("writes nothing else when another run already drafted the lead", async () => {
    hasLiveDraft = true;
    expect(await applyOutreachResult(USER, "outreach", lead, result)).toBe(false);
    expect(statements).toHaveLength(1);
  });
});
