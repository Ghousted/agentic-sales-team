import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ai = vi.hoisted(() => ({ aiJSON: vi.fn() }));
vi.mock("@/lib/ai/openrouter", () => ({ isAIConfigured: () => true, aiJSON: ai.aiJSON }));

import { runFirecrawlScrape } from "@/lib/scrape/firecrawl";

const agent = { id: "a1", name: "Scout", role: "Realtor", goal: "find home buyers", task: "" };
const searchHit = { url: "https://reddit.com/r/x/1", title: "LF a 3BR house", description: "looking to buy" };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.FIRECRAWL_API_KEY = "fc-test";
  ai.aiJSON.mockReset();
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { web: [searchHit] } }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.FIRECRAWL_API_KEY;
});

describe("runFirecrawlScrape", () => {
  it("fails the scrape when lead extraction fails, instead of returning 0 leads", async () => {
    ai.aiJSON.mockRejectedValue(new SyntaxError("Unexpected end of JSON input"));
    await expect(runFirecrawlScrape(agent, 10)).rejects.toThrow(/Lead extraction failed: Unexpected end of JSON input/);
  });

  it("gives the extraction enough tokens not to truncate the JSON", async () => {
    ai.aiJSON.mockResolvedValue({ prospects: [] });
    await runFirecrawlScrape(agent, 10);
    const opts = ai.aiJSON.mock.calls[0][3] as { maxTokens: number };
    expect(opts.maxTokens).toBeGreaterThanOrEqual(4000);
  });

  it("puts a timeout on every Firecrawl request", async () => {
    ai.aiJSON.mockResolvedValue({ prospects: [] });
    await runFirecrawlScrape(agent, 10);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls) expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it("reports a Firecrawl timeout by name", async () => {
    fetchMock.mockRejectedValue(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
    await expect(runFirecrawlScrape(agent, 10)).rejects.toThrow(/Firecrawl search timed out/);
  });

  it("still returns the extracted leads on success", async () => {
    ai.aiJSON.mockResolvedValue({ prospects: [{ name: "u/buyer", title: "wants a house", company: "", profileUrl: searchHit.url, platform: "web", email: "" }] });
    const leads = await runFirecrawlScrape(agent, 10);
    expect(leads).toEqual([{ name: "u/buyer", title: "wants a house", company: "", profileUrl: searchHit.url, platform: "Reddit", email: "" }]);
  });

  it("searches every planned buyer-voice query on each site", async () => {
    ai.aiJSON
      .mockResolvedValueOnce({ queries: ["looking for corporate training", "recommend a trainer for our team", "need leadership training"], platform: "web" })
      .mockResolvedValueOnce({ prospects: [] });
    await runFirecrawlScrape(agent, 10, "find b2b businesses I can train");
    const queries = fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string).query);
    expect(queries).toHaveLength(6);
    expect(queries).toContain("site:facebook.com recommend a trainer for our team");
    expect(queries).toContain("site:reddit.com need leadership training");
  });

  it("keeps the results of the searches that worked when one search fails", async () => {
    ai.aiJSON
      .mockResolvedValueOnce({ queries: ["looking for corporate training"], platform: "web" })
      .mockResolvedValueOnce({ prospects: [{ name: "u/buyer", title: "needs training", company: "", profileUrl: searchHit.url, platform: "web", email: "" }] });
    fetchMock.mockRejectedValueOnce(new Error("Firecrawl 500"));
    const leads = await runFirecrawlScrape(agent, 10, "find b2b businesses I can train");
    expect(leads).toHaveLength(1);
  });
});

