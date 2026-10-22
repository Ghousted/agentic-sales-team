import { describe, expect, it, vi } from "vitest";

const ai = vi.hoisted(() => ({ aiJSON: vi.fn(), configured: false }));
vi.mock("@/lib/ai/openrouter", () => ({ isAIConfigured: () => ai.configured, aiJSON: ai.aiJSON }));

import { briefFromRequest, readScrapeAnswer, ruleAnswer, withLastSearch } from "./scrapeBrief";

describe("briefFromRequest", () => {
  it("takes the place and count from intent detection", () => {
    expect(briefFromRequest("find 20 dentists in Texas", { geo: "Texas", target: 20 })).toEqual({ what: "find 20 dentists in Texas", where: "Texas", count: 20 });
  });

  it("leaves place and count empty when the request does not say", () => {
    expect(briefFromRequest("Look for business in linkedin looking for an ai training provider", {})).toEqual({ what: "Look for business in linkedin looking for an ai training provider", where: undefined, count: undefined });
  });

  it("reads 'anywhere' words as no location limit", () => {
    expect(briefFromRequest("find AI training buyers worldwide", {}).where).toBe("anywhere");
    expect(briefFromRequest("find AI training buyers", { geo: "global" }).where).toBe("anywhere");
  });

  it.each(["linkedin", "LinkedIn", "on reddit", "online"])("does not take the platform %j as the place", (geo) => {
    expect(briefFromRequest("Look for business in linkedin looking for an ai training provider", { geo }).where).toBeUndefined();
  });

  it("does not read 'remote' in a request as a place", () => {
    expect(briefFromRequest("find remote-first SaaS companies", {}).where).toBeUndefined();
  });

  it("has no target for a bare command", () => {
    expect(briefFromRequest("find me 50 leads", { target: 50 })).toEqual({ what: undefined, where: undefined, count: 50 });
  });
});

describe("ruleAnswer", () => {
  it("reads a place and a count", () => {
    expect(ruleAnswer("Texas, 25", ["where", "count"])).toEqual({ count: 25, where: "Texas" });
  });

  it("reads anywhere", () => {
    expect(ruleAnswer("anywhere, 10 please", ["where", "count"])).toMatchObject({ where: "anywhere", count: 10 });
  });

  it("takes the defaults when the user leaves it to the agent", () => {
    expect(ruleAnswer("not sure", ["where", "count"])).toEqual({ where: "anywhere", count: 10 });
    expect(ruleAnswer("you pick", ["count"])).toEqual({ count: 10 });
  });

  it("fills who-to-find before the place", () => {
    expect(ruleAnswer("dentists", ["what", "where", "count"])).toEqual({ count: undefined, what: "dentists" });
  });
});

describe("readScrapeAnswer", () => {
  it("uses the model when configured", async () => {
    ai.configured = true;
    ai.aiJSON.mockResolvedValueOnce({ what: "", where: "Austin, Texas", count: 15 });
    expect(await readScrapeAnswer("austin tx, 15", { what: "dentists" }, ["where", "count"])).toEqual({ what: undefined, where: "Austin, Texas", count: 15 });
  });

  it("falls back to rules when the model fails", async () => {
    ai.configured = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    ai.aiJSON.mockRejectedValueOnce(new Error("OpenRouter 500"));
    expect(await readScrapeAnswer("Ohio, 12", { what: "dentists" }, ["where", "count"])).toEqual({ where: "Ohio", count: 12 });
  });
});

describe("withLastSearch", () => {
  const last = { what: "find AI training buyers", where: "Metro Manila Philippines" };

  it("does not take 'look for more' as who to find", () => {
    expect(briefFromRequest("Lets look for more @Nina", {}).what).toBeUndefined();
  });

  it("repeats the last who and where for 'look for more'", () => {
    expect(withLastSearch(briefFromRequest("Lets look for more @Nina", {}), "Lets look for more @Nina", last))
      .toEqual({ what: last.what, where: last.where, count: undefined, again: true });
  });

  it("keeps a new place given with 'more'", () => {
    expect(withLastSearch({ where: "Cebu" }, "find more in Cebu", last)).toMatchObject({ what: last.what, where: "Cebu", again: true });
  });

  it("offers the last values when the request names no target", () => {
    expect(withLastSearch({}, "yes", last)).toEqual({ suggest: last });
  });

  it("leaves a request with its own target alone", () => {
    expect(withLastSearch({ what: "dentists" }, "find dentists", last)).toEqual({ what: "dentists" });
    expect(withLastSearch({}, "yes", null)).toEqual({});
  });
});
