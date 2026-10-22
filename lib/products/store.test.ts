import { beforeEach, describe, expect, it, vi } from "vitest";

// A chainable stand-in for the Drizzle query builder. Each awaited query is
// answered by `respond`, which sees the builder methods that were called.
type Chain = { op: string; calls: { name: string; args: unknown[] }[] };
const db = vi.hoisted(() => ({
  respond: (_c: Chain): unknown => [],
  queries: [] as Chain[],
}));

vi.mock("@/lib/db", async () => {
  const schema = await vi.importActual<typeof import("@/lib/db/schema")>("@/lib/db/schema");
  const builder = (op: string) => {
    const chain: Chain = { op, calls: [] };
    db.queries.push(chain);
    const proxy: object = new Proxy({}, {
      get(_t, prop) {
        if (prop === "then") return (res: (v: unknown) => void, rej: (e: unknown) => void) => Promise.resolve().then(() => db.respond(chain)).then(res, rej);
        return (...args: unknown[]) => { chain.calls.push({ name: String(prop), args }); return proxy; };
      },
    });
    return proxy;
  };
  return {
    ...schema,
    isDbConfigured: () => true,
    getDb: () => ({ select: () => builder("select"), insert: () => builder("insert"), update: () => builder("update") }),
  };
});

const gemini = vi.hoisted(() => ({ geminiEmbed: vi.fn(), geminiEmbedBatch: vi.fn() }));
vi.mock("@/lib/ai/gemini", () => gemini);

import { addProduct, importProductsCsv, reembedProducts, searchProducts } from "./store";

const row = (id: string, name: string) => ({ id, name, description: "", price: "", category: "", folderId: null, attributes: {} });
const has = (c: Chain, name: string, arg?: unknown) => c.calls.some((x) => x.name === name && (arg === undefined || x.args[0] === arg));

beforeEach(() => {
  db.queries = [];
  db.respond = () => [];
  gemini.geminiEmbed.mockReset();
  gemini.geminiEmbedBatch.mockReset();
});

describe("searchProducts", () => {
  it("falls back to keyword search when the query can't be embedded", async () => {
    gemini.geminiEmbed.mockRejectedValue(new Error("Gemini embed 404"));
    db.respond = (c) => (has(c, "limit", 1) ? [{ id: "p1" }] : has(c, "limit", 50) ? [row("p2", "Pool condo")] : [row("recent", "Recent")]);
    const res = await searchProducts("u1", "condo with pool");
    expect(res.map((p) => p.id)).toEqual(["p2"]);
  });

  it("includes keyword matches for rows that have no embedding", async () => {
    gemini.geminiEmbed.mockResolvedValue([1, 0]);
    db.respond = (c) =>
      has(c, "limit", 1) ? [{ id: "p1" }]
      : has(c, "orderBy") ? [row("v1", "Vector hit")]
      : has(c, "limit", 50) ? [row("k1", "Pool condo, not embedded")]
      : [];
    const res = await searchProducts("u1", "pool condo");
    expect(res.map((p) => p.id)).toEqual(["v1", "k1"]);
    expect(gemini.geminiEmbed).toHaveBeenCalledWith("pool condo", "RETRIEVAL_QUERY");
  });
});

describe("addProduct", () => {
  it("saves the product and returns a warning when embedding fails", async () => {
    gemini.geminiEmbed.mockRejectedValue(new Error("Gemini embed 429: quota"));
    db.respond = () => [row("p1", "Widget")];
    const res = await addProduct("u1", { name: "Widget" });
    expect(res?.id).toBe("p1");
    expect(res?.warning).toMatch(/could not be indexed.*429/);
  });
});

describe("importProductsCsv", () => {
  it("reports rows saved without an embedding", async () => {
    gemini.geminiEmbedBatch.mockResolvedValue({ vectors: [[1], null], error: "Gemini embed 500" });
    const res = await importProductsCsv("u1", "name\nA\nB\n");
    expect(res.added).toBe(2);
    expect(res.warning).toMatch(/^1 product could not be indexed.*500/);
    const insert = db.queries.find((q) => q.op === "insert")!;
    const values = insert.calls.find((c) => c.name === "values")!.args[0] as { embedding: unknown }[];
    expect(values.map((v) => v.embedding)).toEqual([[1], null]);
  });
});

describe("reembedProducts", () => {
  it("re-embeds every row and counts failures", async () => {
    gemini.geminiEmbedBatch.mockResolvedValue({ vectors: [[1], null, [2]], error: "Gemini embed 500" });
    db.respond = (c) => (c.op === "select" ? [row("a", "A"), row("b", "B"), row("c", "C")] : []);
    const res = await reembedProducts("u1");
    expect(res).toEqual({ embedded: 2, failed: 1, error: "Gemini embed 500" });
    const updates = db.queries.filter((q) => q.op === "update");
    expect(updates.map((u) => (u.calls.find((c) => c.name === "set")!.args[0] as { embedding: number[] }).embedding)).toEqual([[1], [2]]);
  });
});
