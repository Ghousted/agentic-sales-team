import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const aiJSON = vi.fn();
vi.mock("@/lib/ai/openrouter", () => ({
  isAIConfigured: () => true,
  aiJSON: (...args: unknown[]) => aiJSON(...args),
}));
vi.mock("./jev", () => ({ gateResults: async (r: unknown[]) => r }));

import { runFirecrawlScrape } from "./firecrawl";

const agent = { id: "a1", name: "Ava", role: "Realtor", goal: "home buyers", task: "" };
const POST = "https://www.reddit.com/r/RealEstate/comments/abc/looking_to_buy/";

function prospect(profileUrl: string, name = "u/buyer") {
  return { name, title: "wants a house", company: "", profileUrl, platform: "web", email: "" };
}

beforeEach(() => {
  process.env.FIRECRAWL_API_KEY = "fc-test";
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { web: [{ url: POST, title: "Looking to buy" }] } }))));
});

afterEach(() => {
  vi.unstubAllGlobals();
  aiJSON.mockReset();
  delete process.env.FIRECRAWL_API_KEY;
});

describe("runFirecrawlScrape profileUrl", () => {
  it("keeps a profileUrl that Firecrawl returned", async () => {
    aiJSON.mockResolvedValueOnce({ query: "looking to buy a house", platform: "web" });
    aiJSON.mockResolvedValueOnce({ prospects: [prospect(POST)] });
    const [p] = await runFirecrawlScrape(agent, 5, "house buyers");
    expect(p.profileUrl).toBe(POST);
    expect(p.platform).toBe("Reddit");
  });

  it.each([
    "javascript:alert(document.cookie)",
    "data:text/html,<script>alert(1)</script>",
    "https://evil.example/login", // http(s), but not a URL Firecrawl returned
  ])("drops an injected profileUrl %j but keeps the lead", async (bad) => {
    aiJSON.mockResolvedValueOnce({ query: "looking to buy a house", platform: "web" });
    aiJSON.mockResolvedValueOnce({ prospects: [prospect(bad)] });
    const [p] = await runFirecrawlScrape(agent, 5, "house buyers");
    expect(p.name).toBe("u/buyer");
    expect(p.profileUrl).toBe("");
  });
});

describe("runFirecrawlScrape names", () => {
  it("replaces a handle made from the subreddit with the source label", async () => {
    aiJSON.mockResolvedValue({ prospects: [prospect(POST, "u/RealEstate")] });
    const [lead] = await runFirecrawlScrape(agent, 10);
    expect(lead.name).toBe("Reddit user · r/RealEstate");
  });

  it("keeps a real Reddit username", async () => {
    aiJSON.mockResolvedValue({ prospects: [prospect(POST, "u/house_hunter_22")] });
    const [lead] = await runFirecrawlScrape(agent, 10);
    expect(lead.name).toBe("u/house_hunter_22");
  });
});

