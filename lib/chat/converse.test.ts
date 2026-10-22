import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { converse } from "./converse";

const input = {
  responder: { id: "a1", name: "Scout", role: "SDR", goal: "find dentists", task: "prospecting", capabilities: ["scrape"] },
  roster: [{ id: "a1", name: "Scout", capabilities: ["scrape"] }],
  history: [],
  message: "how do you find prospects?",
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test-key";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("converse", () => {
  it("returns the model's reply", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "We search public posts." } }] }), { status: 200 }));
    expect(await converse(input)).toBe("We search public posts.");
  });

  it("says AI isn't configured instead of passing off a canned answer", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const text = await converse(input);
    expect(text).toMatch(/AI isn't configured/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says the AI call failed when it errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValue(new Response("down", { status: 503 }));
    expect(await converse(input)).toMatch(/AI service didn't respond/);
  });
});
