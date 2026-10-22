import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
import * as schema from "@/lib/db/schema";
import { withBatch } from "../../test/fake-batch";

// pg-proxy hands us each generated statement. A lead with a live draft makes
// the draft insert return no row, the way ON CONFLICT DO NOTHING does against
// outreach_drafts_live_lead_idx.
const USER = "00000000-0000-4000-8000-000000000001";
const LEAD = "00000000-0000-4000-8000-000000000002";
const DRAFT = "00000000-0000-4000-8000-000000000003";
let hasLiveDraft = false;
let draftStatus = "draft";
let sessionUser: string | null = null;
let statements: { sql: string; params: unknown[] }[] = [];
let batches: number[] = [];

const fakeDb = withBatch(drizzle(async (sql, params) => {
  const q = sql.toLowerCase();
  statements.push({ sql: q, params });
  if (q.startsWith(`insert into "outreach_drafts"`)) return { rows: hasLiveDraft ? [] : [["draft-1"]] };
  if (q.startsWith(`select`) && q.includes(`from "outreach_drafts"`)) {
    // id, user_id, agent_id, lead_id, subject, body, rationale, status, dismissed, created_at, sent_at
    return { rows: [[DRAFT, USER, "outreach", LEAD, "Hi", "Hello", "", draftStatus, false, new Date().toISOString(), null]] };
  }
  return { rows: [] };
}, { schema }), batches);

vi.mock("@/lib/db", async () => ({
  ...(await import("@/lib/db/schema")),
  isDbConfigured: () => true,
  getDb: () => fakeDb,
}));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => (sessionUser ? { userId: sessionUser } : null) }));

const { applyOutreachResult, markDraftSent, addScrapedLeads } = await import("./store");

const lead = {
  id: LEAD, userId: USER, agentId: "outreach", name: "Jane", title: "", company: "Acme", email: "j@acme.com",
  status: "new", score: 0, source: "manual", review: "accepted", profileUrl: null, platform: null, research: null,
  fitReason: "", qualifiedAt: null, matchedAt: null, createdAt: new Date(), updatedAt: new Date(),
};
const result = { subject: "Hi", body: "Hello", rationale: "", score: 60, stage: "contacted" };

beforeEach(() => {
  hasLiveDraft = false; draftStatus = "draft"; sessionUser = null;
  statements = []; batches.length = 0;
});

describe("applyOutreachResult", () => {
  it("sends the draft, lead update and activity as one batch", async () => {
    expect(await applyOutreachResult(USER, "outreach", lead, result)).toBe(true);
    expect(batches).toEqual([3]);
    expect(statements[0].sql).toContain("on conflict do nothing");
    expect(statements[1].sql).toMatch(/^update "leads"/);
    expect(statements[2].sql).toMatch(/^insert into "activity"/);
  });

  it("makes the lead update and activity depend on the new draft existing", async () => {
    await applyOutreachResult(USER, "outreach", lead, result);
    const draftId = statements[0].params[0];
    expect(draftId).toMatch(/^[0-9a-f-]{36}$/);
    // Update: only when a draft with this id exists.
    expect(statements[1].sql).toMatch(/exists \(select .* from "outreach_drafts" where "outreach_drafts"\."id" = \$\d+\)/);
    expect(statements[1].params).toContain(draftId);
    // Activity: INSERT ... SELECT from that draft row, so no row means no insert.
    expect(statements[2].sql).toMatch(/^insert into "activity" \(.*\) select .* from "outreach_drafts" where "outreach_drafts"\."id" = \$\d+/);
    expect(statements[2].params).toContain(draftId);
  });

  it("returns false when another run already drafted the lead", async () => {
    hasLiveDraft = true;
    expect(await applyOutreachResult(USER, "outreach", lead, result)).toBe(false);
  });
});

describe("markDraftSent", () => {
  it("marks sent, advances the lead and logs activity in one batch", async () => {
    sessionUser = USER;
    await markDraftSent(DRAFT);
    expect(batches).toEqual([3]);
    const [draftUpdate, leadUpdate, act] = statements.slice(1);
    expect(draftUpdate.sql).toMatch(/^update "outreach_drafts" .* "outreach_drafts"\."status" <> \$\d+/);
    // The lead and activity writes key on the exact sentAt this call stamped.
    const sentAt = draftUpdate.params.find((p) => typeof p === "string" && /^\d{4}-/.test(p));
    expect(sentAt).toBeTruthy();
    expect(leadUpdate.sql).toMatch(/exists \(select .*"outreach_drafts"\."sent_at" = \$\d+/);
    expect(leadUpdate.params).toContain(sentAt);
    expect(act.sql).toMatch(/^insert into "activity" .* select .*"outreach_drafts"\."sent_at" = \$\d+/);
    expect(act.params).toContain(sentAt);
  });

  it("writes nothing for a draft that is already sent", async () => {
    sessionUser = USER;
    draftStatus = "sent";
    await markDraftSent(DRAFT);
    expect(batches).toEqual([]);
    expect(statements).toHaveLength(1);
  });
});

describe("addScrapedLeads", () => {
  it("inserts every new lead and its activity in one batch, with matching ids", async () => {
    const ids = await addScrapedLeads(USER, "scout", [
      { name: "A", company: "X", profileUrl: "https://example.com/a" },
      { name: "B", company: "Y", profileUrl: "https://example.com/b" },
    ] as Parameters<typeof addScrapedLeads>[2]);
    expect(ids).toHaveLength(2);
    expect(batches).toEqual([2]);
    const [leadsInsert, actInsert] = statements.slice(1);
    expect(leadsInsert.sql).toMatch(/^insert into "leads"/);
    expect(actInsert.sql).toMatch(/^insert into "activity"/);
    for (const id of ids) {
      expect(leadsInsert.params).toContain(id);
      expect(actInsert.params).toContain(id);
    }
  });

  it("sends nothing when every prospect is already in the book", async () => {
    expect(await addScrapedLeads(USER, "scout", [])).toEqual([]);
    expect(batches).toEqual([]);
  });
});
