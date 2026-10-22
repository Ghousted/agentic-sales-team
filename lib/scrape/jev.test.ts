import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ai = vi.hoisted(() => ({ aiJSON: vi.fn(), configured: true }));
vi.mock("@/lib/ai/openrouter", () => ({ isAIConfigured: () => ai.configured, aiJSON: ai.aiJSON }));

import { GATE_MODEL, gateResults, keepByAnswer } from "./jev";

const seller = {
  url: "https://www.facebook.com/groups/ailearnercommunity/posts/1451162710248274/",
  title: "Upskilling Teams for AI Adoption: Challenges and Solutions",
  description: "Building an AI-ready team takes work. At ZaranTech, we build corporate AI training around your team's roles, current skills and business ...",
};
const buyer = { url: "https://www.reddit.com/r/humanresources/1", title: "Recommend an AI training provider for our staff?", description: "We have 80 employees and need AI training." };
const ctx = { mode: "intent" as const, sells: "AI training for businesses", wants: "businesses that need AI training" };

beforeEach(() => {
  ai.configured = true;
  ai.aiJSON.mockReset();
  ai.aiJSON.mockImplementation(async (_s: string, turns: { text: string }[]) => ({ side: turns[0].text.includes("ZaranTech") ? "seller" : "buyer" }));
});

describe("gateResults", () => {
  it("drops a seller post and keeps a buyer post", async () => {
    expect(await gateResults([seller, buyer], ctx)).toEqual([buyer]);
  });

  it("asks Jev Router about one result at a time, with the salesperson's offer as context", async () => {
    await gateResults([seller, buyer], ctx);
    expect(ai.aiJSON).toHaveBeenCalledTimes(2);
    const [system, turns, schema, opts] = ai.aiJSON.mock.calls[0];
    expect(system).toContain("The salesperson sells: AI training for businesses.");
    expect(turns).toHaveLength(1);
    expect(turns[0].text).toContain(seller.url);
    expect(turns[0].text).not.toContain(buyer.url);
    expect(schema.properties.side.enum).toEqual(["buyer", "seller", "other"]);
    expect(opts).toMatchObject({ model: GATE_MODEL, temperature: 0 });
    expect(opts.timeoutMs).toBeGreaterThan(0);
  });

  it("asks a competitor question in fit mode", async () => {
    ai.aiJSON.mockResolvedValue({ competitor: true });
    expect(await gateResults([buyer], { ...ctx, mode: "fit" })).toEqual([]);
    expect(ai.aiJSON.mock.calls[0][2].properties.competitor.type).toBe("boolean");
  });

  it("keeps every result when OpenRouter is not configured, without calling it", async () => {
    ai.configured = false;
    expect(await gateResults([seller, buyer], ctx)).toEqual([seller, buyer]);
    expect(ai.aiJSON).not.toHaveBeenCalled();
  });

  it("keeps a result when its check fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    ai.aiJSON.mockRejectedValue(new Error("OpenRouter 429"));
    expect(await gateResults([seller, buyer], ctx)).toEqual([seller, buyer]);
  });
});

describe("gateResults time budget", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("keeps the results it had no time to check", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers();
    // Each call takes 6s, so after the first round of 16 the 10s budget is gone.
    ai.aiJSON.mockImplementation(() => new Promise((res) => setTimeout(() => res({ side: "seller" }), 6_000)));
    const many = Array.from({ length: 40 }, (_, i) => ({ ...seller, url: seller.url + i }));
    const done = gateResults(many, ctx);
    await vi.advanceTimersByTimeAsync(20_000);
    const kept = await done;
    const checked = ai.aiJSON.mock.calls.length;
    expect(checked).toBeLessThan(40);
    expect(kept).toHaveLength(40 - checked);
  });
});

describe("keepByAnswer", () => {
  it("drops only a seller in intent mode", () => {
    expect(keepByAnswer("intent", { side: "seller" })).toBe(false);
    expect(keepByAnswer("intent", { side: "buyer" })).toBe(true);
    expect(keepByAnswer("intent", { side: "other" })).toBe(true);
  });

  it("drops only a competitor in fit mode", () => {
    expect(keepByAnswer("fit", { competitor: true })).toBe(false);
    expect(keepByAnswer("fit", { competitor: false })).toBe(true);
  });

  it("keeps a result when the answer is missing", () => {
    expect(keepByAnswer("intent", {})).toBe(true);
    expect(keepByAnswer("fit", {})).toBe(true);
  });
});
