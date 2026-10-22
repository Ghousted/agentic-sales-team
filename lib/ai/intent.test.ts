import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectIntent } from "./intent";

const reply = (content: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] }), { status: 200 });
const agents = [
  { name: "Scout", capabilities: ["scrape", "research"] },
  { name: "Idle", capabilities: [] },
];

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test-key";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const body = () => JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);

describe("detectIntent", () => {
  it("routes by keywords without calling out when no key is set", async () => {
    delete process.env.OPENROUTER_API_KEY;
    expect(await detectIntent("find 20 dentists in Texas", agents)).toEqual({ capability: "scrape", params: { target: 20 }, summary: "find 20 dentists in Texas" });
    expect((await detectIntent("x".repeat(100), agents))).toEqual({ capability: "chat", params: {}, summary: "x".repeat(60) });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the model's capability, params and trimmed summary", async () => {
    fetchMock.mockResolvedValue(reply({ capability: "scrape", params: { industry: "dental", geo: "Texas", target: 20 }, summary: "  find dentists  " }));
    expect(await detectIntent("find 20 dentists in Texas", agents)).toEqual({
      capability: "scrape",
      params: { industry: "dental", geo: "Texas", target: 20 },
      summary: "find dentists",
    });
  });

  it("sends the roster, the message and a JSON schema at low temperature", async () => {
    fetchMock.mockResolvedValue(reply({ capability: "chat", params: {}, summary: "hi" }));
    await detectIntent("hello team", agents);
    const b = body();
    expect(b.messages[0].role).toBe("system");
    expect(b.messages[0].content).toContain("- Scout: scrape, research");
    expect(b.messages[0].content).toContain("- Idle: (no capabilities)");
    expect(b.messages[1]).toEqual({ role: "user", content: "hello team" });
    expect(b.temperature).toBe(0.2);
    expect(b.max_tokens).toBe(400);
    expect(b.response_format.json_schema.schema.required).toEqual(["capability", "params", "summary"]);
  });

  it("parses JSON wrapped in a markdown fence", async () => {
    fetchMock.mockResolvedValue(reply('```json\n{"capability":"status","params":{},"summary":"update"}\n```'));
    expect((await detectIntent("any updates?", agents)).capability).toBe("status");
  });

  it("fills missing fields: unknown capability, empty params, message as summary", async () => {
    fetchMock.mockResolvedValue(reply({}));
    const msg = "y".repeat(80);
    expect(await detectIntent(msg, agents)).toEqual({ capability: "unknown", params: {}, summary: "y".repeat(60) });
  });

  it("falls back to keywords on an HTTP error or unparseable JSON", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(new Response("down", { status: 500 }));
    expect(await detectIntent("find leads", agents)).toEqual({ capability: "scrape", params: {}, summary: "find leads" });
    fetchMock.mockResolvedValueOnce(reply("not json"));
    expect(await detectIntent("hi there", agents)).toEqual({ capability: "chat", params: {}, summary: "hi there" });
  });

  it.each([
    ["@Scout find 50 plumbers in Ohio", "scrape"],
    ["book a meeting with Maria", "book-meeting"],
    ["find a time to meet Maria", "book-meeting"],
    ["schedule a demo for Friday", "book-meeting"],
    ["follow up with the cold leads", "follow-up"],
    ["draft a proposal for Acme", "proposal"],
    ["qualify my leads", "qualify"],
    ["enrich these leads", "enrich"],
    ["match leads to our listings", "match"],
    ["assess the new leads", "assess"],
    ["review the pending leads", "assess"],
    ["research Acme's buyers", "research"],
    ["write emails to my leads", "outreach"],
    ["any updates?", "status"],
    ["how's it going @Scout", "status"],
    ["how do you assess leads?", "chat"],
    ["what can you do?", "chat"],
    ["thanks!", "chat"],
    ["tomorrow 2pm", "chat"],
  ])("without a key, reads %j as %s", async (msg, cap) => {
    delete process.env.OPENROUTER_API_KEY;
    expect((await detectIntent(msg, agents)).capability).toBe(cap);
  });

  // The schema enum is only a hint (strict: false), and detectIntent passes the
  // value through unchecked, so an out-of-enum capability reaches the caller.
  it.todo("maps a capability outside the enum to unknown");
});
