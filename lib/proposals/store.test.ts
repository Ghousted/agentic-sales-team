import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
import { getTableColumns } from "drizzle-orm";
import * as schema from "@/lib/db/schema";

// A tiny in-memory stand-in for Postgres. drizzle's pg-proxy driver hands us
// the generated SQL; we answer the two shapes pickLeadsForProposal can send
// (a leads scan, and a proposals lookup by lead id) with real SQL semantics
// for the parts that matter here: NOT EXISTS, ORDER BY created_at, LIMIT.
const USER = "00000000-0000-4000-8000-000000000001";
let allLeads: { id: string; agentId: string; createdAt: Date }[] = [];
let withProposal = new Set<string>();
let inserts: string[] = [];

const leadCols = Object.values(getTableColumns(schema.leads)).map((c) => c.name);

function leadRow(l: (typeof allLeads)[number]): unknown[] {
  const v: Record<string, unknown> = {
    id: l.id, user_id: USER, agent_id: l.agentId, name: "n", title: "", company: "", email: "e@x",
    status: "new", score: 0, source: "manual", review: "accepted", profile_url: null, platform: null,
    research: null, created_at: l.createdAt.toISOString(), updated_at: l.createdAt.toISOString(),
  };
  return leadCols.map((c) => v[c]);
}

const fakeDb = drizzle(async (sql, params) => {
  const q = sql.toLowerCase();
  if (/from "team/.test(q)) return { rows: [] };
  if (/^select .* from "leads"/.test(q)) {
    const limit = Number(params[params.length - 1]);
    let rows = [...allLeads].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    if (q.includes(`"leads"."id" in`)) rows = rows.filter((l) => params.includes(l.id));
    if (q.includes("not exists")) rows = rows.filter((l) => !withProposal.has(l.id));
    return { rows: rows.slice(0, limit).map(leadRow) };
  }
  if (/^select .* from "proposals"/.test(q)) {
    const ids = params.filter((p) => typeof p === "string" && allLeads.some((l) => l.id === p));
    return { rows: ids.filter((id) => withProposal.has(id as string)).map((id) => [id]) };
  }
  if (/^insert into "proposals"/.test(q)) {
    // Mirrors ON CONFLICT DO NOTHING on proposals_lead_id_idx: no row back if the lead has one.
    inserts.push(q);
    const leadId = params[2] as string; // ($1 user_id, $2 agent_id, $3 lead_id)
    if (withProposal.has(leadId)) return { rows: [] };
    withProposal.add(leadId);
    return { rows: [["p-" + leadId]] };
  }
  throw new Error(`unexpected query: ${sql}`);
}, { schema });

vi.mock("@/lib/db", async () => ({
  ...(await import("@/lib/db/schema")),
  isDbConfigured: () => true,
  getDb: () => fakeDb,
}));

const { pickLeadsForProposal, addProposal } = await import("./store");

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

beforeEach(() => {
  // 100 accepted leads, one per minute; the oldest 70 already have proposals.
  allLeads = Array.from({ length: 100 }, (_, i) => ({ id: id(i + 1), agentId: "proposal", createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)) }));
  withProposal = new Set(allLeads.slice(0, 70).map((l) => l.id));
  inserts = [];
});

describe("pickLeadsForProposal", () => {
  it("still finds newer leads once the oldest batchSize+50 all have a proposal", async () => {
    const picked = await pickLeadsForProposal(USER, "proposal", undefined, 5);
    expect(picked.map((l) => l.id)).toEqual([id(71), id(72), id(73), id(74), id(75)]);
  });

  it("returns nothing when every lead already has a proposal", async () => {
    withProposal = new Set(allLeads.map((l) => l.id));
    expect(await pickLeadsForProposal(USER, "proposal", undefined, 5)).toEqual([]);
  });

  it("skips explicitly requested leads that already have a proposal", async () => {
    const picked = await pickLeadsForProposal(USER, "proposal", [id(1), id(80)], 5);
    expect(picked.map((l) => l.id)).toEqual([id(80)]);
  });
});

describe("addProposal", () => {
  const p = { title: "Plan", body: "Body", productsUsed: [] };

  it("inserts with ON CONFLICT DO NOTHING and reports a new proposal", async () => {
    expect(await addProposal(USER, "proposal", id(80), p)).toBe(true);
    expect(inserts[0]).toContain("on conflict do nothing");
  });

  it("reports false when a concurrent run already wrote one for the lead", async () => {
    expect(await addProposal(USER, "proposal", id(80), p)).toBe(true);
    expect(await addProposal(USER, "proposal", id(80), p)).toBe(false);
  });
});
