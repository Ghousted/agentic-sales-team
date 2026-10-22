import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiEmbed, aiEmbedBatch, aiGenerate, aiJSON } from "./openrouter";

const vec = (n: number, x = 1) => Array.from({ length: n }, () => x);
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const reply = (content: string) => ok({ choices: [{ message: { content } }] });
const embeddings = (n: number, dims = 768) => ok({ data: Array.from({ length: n }, (_, index) => ({ index, embedding: vec(dims) })) });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test-key";
  delete process.env.OPENROUTER_MODEL;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const call = (i = 0) => {
  const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit];
  return { url, init, body: JSON.parse(init.body as string), headers: init.headers as Record<string, string> };
};

describe("aiGenerate", () => {
  it("calls OpenRouter chat completions with a bearer key and the system prompt first", async () => {
    fetchMock.mockResolvedValue(reply(" hi "));
    const text = await aiGenerate("sys", [{ role: "user", text: "hello" }, { role: "model", text: "yo" }]);
    expect(text).toBe("hi");
    const { url, init, body, headers } = call();
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(headers.Authorization).toBe("Bearer test-key");
    expect(body.model).toBe("google/gemini-2.5-flash");
    expect(body.reasoning).toEqual({ effort: "none" });
    expect(body.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "hello" },
      { role: "assistant", content: "yo" },
    ]);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses OPENROUTER_MODEL when set", async () => {
    process.env.OPENROUTER_MODEL = "anthropic/claude-haiku-4.5";
    fetchMock.mockResolvedValue(reply("hi"));
    await aiGenerate("sys", []);
    expect(call().body.model).toBe("anthropic/claude-haiku-4.5");
  });

  it("throws on an HTTP error, an in-body error and an empty reply", async () => {
    fetchMock.mockResolvedValueOnce(new Response("no credits", { status: 402 }));
    await expect(aiGenerate("s", [])).rejects.toThrow(/402/);
    fetchMock.mockResolvedValueOnce(ok({ error: { message: "upstream down" } }));
    await expect(aiGenerate("s", [])).rejects.toThrow(/returned an error/);
    fetchMock.mockResolvedValueOnce(reply(""));
    await expect(aiGenerate("s", [])).rejects.toThrow(/no text/);
  });

  it("logs the provider's error body but keeps it out of the thrown message", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(new Response("acct sk-or-123 has no credits", { status: 402 }));
    const err = await aiGenerate("s", []).catch((e: Error) => e);
    expect(String(err)).toBe("Error: OpenRouter 402");
    fetchMock.mockResolvedValueOnce(ok({ error: { message: "provider said: secret detail" } }));
    expect(String(await aiGenerate("s", []).catch((e: Error) => e))).not.toMatch(/secret detail/);
    expect(log.mock.calls.flat().join(" ")).toMatch(/sk-or-123[\s\S]*secret detail/);
    log.mockRestore();
  });

  it("throws when the key is missing, without calling out", async () => {
    delete process.env.OPENROUTER_API_KEY;
    await expect(aiGenerate("s", [])).rejects.toThrow(/OPENROUTER_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("aiJSON", () => {
  const schema = { type: "object", properties: { score: { type: "integer" } }, required: ["score"] };

  it("sends the schema as response_format and parses the reply", async () => {
    fetchMock.mockResolvedValue(reply('{"score": 7}'));
    expect(await aiJSON("s", [], schema)).toEqual({ score: 7 });
    const { body } = call();
    expect(body.response_format).toEqual({ type: "json_schema", json_schema: { name: "result", strict: false, schema } });
    expect(body.provider).toEqual({ require_parameters: true });
  });

  it("accepts JSON wrapped in a markdown fence", async () => {
    fetchMock.mockResolvedValue(reply('```json\n{"score": 3}\n```'));
    expect(await aiJSON("s", [], schema)).toEqual({ score: 3 });
  });
});

describe("aiEmbed", () => {
  it("calls the embeddings endpoint for gemini-embedding-001 at 768 dims", async () => {
    fetchMock.mockResolvedValue(embeddings(1));
    await aiEmbed("condo with pool", "search_query");
    const { url, body, headers } = call();
    expect(url).toBe("https://openrouter.ai/api/v1/embeddings");
    expect(headers.Authorization).toBe("Bearer test-key");
    expect(body).toMatchObject({ model: "google/gemini-embedding-001", input: ["condo with pool"], dimensions: 768, input_type: "search_query" });
  });

  it("returns a unit-length vector", async () => {
    fetchMock.mockResolvedValue(ok({ data: [{ index: 0, embedding: vec(768, 3) }] }));
    expect(Math.hypot(...(await aiEmbed("x")))).toBeCloseTo(1, 6);
  });

  it("throws on an API error and on a vector that does not fit the column", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(new Response("model not found", { status: 404 }));
    await expect(aiEmbed("x")).rejects.toThrow(/^OpenRouter embed 404$/);
    log.mockRestore();
    fetchMock.mockResolvedValueOnce(embeddings(1, 3072));
    await expect(aiEmbed("x")).rejects.toThrow(/3072 dims/);
  });
});

describe("aiEmbedBatch", () => {
  it("chunks by 100, keeps input order, and reports a failed chunk", async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ data: Array.from({ length: 100 }, (_, i) => ({ index: 99 - i, embedding: vec(768, i + 1) })) }))
      .mockResolvedValueOnce(new Response("quota", { status: 429 }));
    const res = await aiEmbedBatch(Array.from({ length: 120 }, (_, i) => `p${i}`));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.vectors.slice(0, 100).every(Boolean)).toBe(true);
    expect(res.vectors.slice(100).every((v) => v === null)).toBe(true);
    expect(res.error).toMatch(/429/);
    expect(call().body.input).toHaveLength(100);
    expect(call(1).body.input).toHaveLength(20);
  });
});
