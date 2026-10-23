import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { draftOutreach } from "./outreach";
import type { AgentSnapshot } from "@/lib/leads/types";

const reply = (content: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 });
const agent: AgentSnapshot = { id: "a1", name: "Ava", role: "SDR", goal: "book demos", task: "outreach" };
const lead = { name: "Maria Lopez", title: "Head of Support", company: "Acme", email: "maria@acme.com" };

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test-key";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const body = () => JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);

describe("draftOutreach", () => {
  it("asks the model for score and draft only, not a pipeline stage", async () => {
    fetchMock.mockResolvedValue(reply({ score: 72, subject: "Hi", body: "Dear Maria,", rationale: "fit" }));
    const r = await draftOutreach(agent, lead);
    const b = body();
    const schema = b.response_format.json_schema.schema;
    expect(schema.required).toEqual(["score", "subject", "body", "rationale"]);
    expect(schema.properties).not.toHaveProperty("stage");
    expect(b.messages[0].content).not.toMatch(/stage/i);
    expect(r).toEqual({ score: 72, subject: "Hi", body: "Dear Maria,", rationale: "fit" });
  });

  it("returns fallback drafts without a stage when AI is not configured", async () => {
    delete process.env.OPENROUTER_API_KEY;
    expect(await draftOutreach(agent, lead)).not.toHaveProperty("stage");
    expect(await draftOutreach(agent, { ...lead, email: "" })).not.toHaveProperty("stage");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
