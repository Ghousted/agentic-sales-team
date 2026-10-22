import { beforeEach, describe, expect, it, vi } from "vitest";

const LEAD_ID = "11111111-1111-4111-8111-111111111111";
const fake = vi.hoisted(() => ({ row: null as Record<string, unknown> | null, updates: [] as unknown[] }));
const ai = vi.hoisted(() => ({ aiJSON: vi.fn() }));

vi.mock("@/lib/db", async (importActual) => {
  const chain = () => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "where", "limit"]) c[m] = () => c;
    c.then = (res: (v: unknown) => unknown) => Promise.resolve(fake.row ? [fake.row] : []).then(res);
    return c;
  };
  return {
    ...(await importActual<typeof import("@/lib/db")>()),
    isDbConfigured: () => true,
    getDb: () => ({
      select: () => chain(),
      update: () => ({ set: (v: unknown) => ({ where: async () => { fake.updates.push(v); } }) }),
    }),
  };
});
vi.mock("@/lib/auth/session", () => ({ getSession: async () => ({ userId: "u1" }) }));
vi.mock("@/lib/ai/openrouter", () => ({ isAIConfigured: () => true, aiJSON: ai.aiJSON }));
vi.mock("@/lib/pod/orchestrate", () => ({ agentInfo: async () => ({ role: "AI training provider", goal: "sell corporate AI training" }) }));

import { ensureFitReason } from "./fit";

const lead = { id: LEAD_ID, userId: "u1", agentId: "a1", name: "Canon Business Service Centre Philippines", title: "IT operations company in Metro Manila", company: "Canon BSC", platform: "LinkedIn", research: null };

beforeEach(() => {
  fake.updates = [];
  ai.aiJSON.mockReset();
});

describe("ensureFitReason", () => {
  it("returns a reason the lead already has, without calling the model", async () => {
    fake.row = { ...lead, fitReason: "Large IT team in Manila." };
    expect(await ensureFitReason(LEAD_ID)).toBe("Large IT team in Manila.");
    expect(ai.aiJSON).not.toHaveBeenCalled();
  });

  it("writes and saves a reason for a lead with none", async () => {
    fake.row = { ...lead, fitReason: "" };
    ai.aiJSON.mockResolvedValueOnce({ fit: " 1,000-person IT operations firm in Manila; staff need AI upskilling. " });
    expect(await ensureFitReason(LEAD_ID)).toBe("1,000-person IT operations firm in Manila; staff need AI upskilling.");
    expect(fake.updates).toEqual([{ fitReason: "1,000-person IT operations firm in Manila; staff need AI upskilling." }]);
    expect(ai.aiJSON.mock.calls[0][0]).toContain("AI training provider. sell corporate AI training");
  });

  it("returns '' for a lead that is not the user's, or a bad id", async () => {
    fake.row = null;
    expect(await ensureFitReason(LEAD_ID)).toBe("");
    expect(await ensureFitReason("not-an-id")).toBe("");
    expect(ai.aiJSON).not.toHaveBeenCalled();
  });

  it("returns '' and saves nothing when the model fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fake.row = { ...lead, fitReason: "" };
    ai.aiJSON.mockRejectedValueOnce(new Error("OpenRouter 500"));
    expect(await ensureFitReason(LEAD_ID)).toBe("");
    expect(fake.updates).toEqual([]);
  });
});
