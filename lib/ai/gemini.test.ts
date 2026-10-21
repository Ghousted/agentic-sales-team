import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { geminiEmbed, geminiEmbedBatch, geminiGenerate } from "./gemini";

const vec = (n: number, x = 1) => Array.from({ length: n }, () => x);
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  process.env.GEMINI_API_KEY = "test-key";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const call = (i = 0) => {
  const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit];
  return { url, init, body: JSON.parse(init.body as string), headers: init.headers as Record<string, string> };
};

describe("geminiEmbed", () => {
  it("calls gemini-embedding-001 at 768 dims with the key in a header, not the URL", async () => {
    fetchMock.mockResolvedValue(ok({ embedding: { values: vec(768) } }));
    await geminiEmbed("condo with pool", "RETRIEVAL_QUERY");
    const { url, init, body, headers } = call();
    expect(url).toContain("/models/gemini-embedding-001:embedContent");
    expect(url).not.toContain("key=");
    expect(headers["x-goog-api-key"]).toBe("test-key");
    expect(body.outputDimensionality).toBe(768);
    expect(body.taskType).toBe("RETRIEVAL_QUERY");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns a unit-length vector", async () => {
    fetchMock.mockResolvedValue(ok({ embedding: { values: vec(768, 3) } }));
    const v = await geminiEmbed("x");
    expect(Math.hypot(...v)).toBeCloseTo(1, 6);
  });

  it("throws on an API error instead of returning null", async () => {
    fetchMock.mockResolvedValue(new Response("model not found", { status: 404 }));
    await expect(geminiEmbed("x")).rejects.toThrow(/404/);
  });

  it("throws when the vector does not fit the 768-dim column", async () => {
    fetchMock.mockResolvedValue(ok({ embedding: { values: vec(3072) } }));
    await expect(geminiEmbed("x")).rejects.toThrow(/3072 dims/);
  });

  it("throws when the key is missing", async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(geminiEmbed("x")).rejects.toThrow(/GEMINI_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("geminiEmbedBatch", () => {
  it("chunks by 100 and reports the error of a failed chunk", async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ embeddings: Array.from({ length: 100 }, () => ({ values: vec(768) })) }))
      .mockResolvedValueOnce(new Response("quota", { status: 429 }));
    const res = await geminiEmbedBatch(Array.from({ length: 120 }, (_, i) => `p${i}`));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.vectors.slice(0, 100).every(Boolean)).toBe(true);
    expect(res.vectors.slice(100).every((v) => v === null)).toBe(true);
    expect(res.error).toMatch(/429/);
    const { url, body, headers } = call();
    expect(url).toContain("/models/gemini-embedding-001:batchEmbedContents");
    expect(url).not.toContain("key=");
    expect(headers["x-goog-api-key"]).toBe("test-key");
    expect(body.requests[0]).toMatchObject({ model: "models/gemini-embedding-001", taskType: "RETRIEVAL_DOCUMENT", outputDimensionality: 768 });
  });
});

describe("geminiGenerate", () => {
  it("sends the key in a header, not the URL", async () => {
    fetchMock.mockResolvedValue(ok({ candidates: [{ content: { parts: [{ text: "hi" }] } }] }));
    await geminiGenerate("sys", [{ role: "user", text: "hello" }]);
    const { url, headers } = call();
    expect(url).not.toContain("key=");
    expect(headers["x-goog-api-key"]).toBe("test-key");
  });
});
