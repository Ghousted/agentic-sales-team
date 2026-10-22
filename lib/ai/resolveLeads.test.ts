import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveTargetLeads } from "./resolveLeads";
import type { TeamLeadPick } from "@/lib/leads/types";

const lead = (id: string, name: string, company = ""): TeamLeadPick => ({ id, name, title: "", company } as TeamLeadPick);
const leads = [lead("l1", "Maria Santos", "Acme Dental"), lead("l2", "John Reyes", "Bright Smiles"), lead("l3", "Ana Cruz")];

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test-key";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("resolveTargetLeads without AI", () => {
  beforeEach(() => { delete process.env.OPENROUTER_API_KEY; });
  afterEach(() => expect(fetchMock).not.toHaveBeenCalled());

  it("matches a first name, a last name or a whole company name", async () => {
    expect(await resolveTargetLeads("Maria", leads)).toEqual({ mode: "some", leadIds: ["l1"] });
    expect(await resolveTargetLeads("the Reyes guy", leads)).toEqual({ mode: "some", leadIds: ["l2"] });
    expect(await resolveTargetLeads("Bright Smiles and ana", leads)).toEqual({ mode: "some", leadIds: ["l2", "l3"] });
  });

  it("reads 'everyone' as all and a vague pointer as none", async () => {
    expect(await resolveTargetLeads("everyone", leads)).toEqual({ mode: "all", leadIds: [] });
    expect(await resolveTargetLeads("that one", leads)).toEqual({ mode: "none", leadIds: [] });
    expect(await resolveTargetLeads("the dental one", leads)).toEqual({ mode: "none", leadIds: [] });
  });
});

describe("resolveTargetLeads with AI", () => {
  it("falls back to name matching when the call fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValue(new Response("down", { status: 500 }));
    expect(await resolveTargetLeads("Maria", leads)).toEqual({ mode: "some", leadIds: ["l1"] });
  });

  it("keeps only ids from the list", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ mode: "some", leadIds: ["l3", "bogus"] }) } }] }), { status: 200 }));
    expect(await resolveTargetLeads("Ana", leads)).toEqual({ mode: "some", leadIds: ["l3"] });
  });
});
