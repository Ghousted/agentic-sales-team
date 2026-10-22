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

const ai = vi.hoisted(() => ({ aiEmbed: vi.fn(), aiEmbedBatch: vi.fn() }));
vi.mock("@/lib/ai/openrouter", () => ai);

import { addProduct, importProductsCsv, reembedProducts, searchProducts, setProductFolder } from "./store";

const row = (id: string, name: string) => ({ id, name, description: "", price: "", category: "", folderId: null, attributes: {} });
const has = (c: Chain, name: string, arg?: unknown) => c.calls.some((x) => x.name === name && (arg === undefined || x.args[0] === arg));

beforeEach(() => {
  db.queries = [];
  db.respond = () => [];
  ai.aiEmbed.mockReset();
  ai.aiEmbedBatch.mockReset();
});

describe("searchProducts", () => {
  it("falls back to keyword search when the query can't be embedded", async () => {
    ai.aiEmbed.mockRejectedValue(new Error("OpenRouter embed 404"));
    db.respond = (c) => (has(c, "limit", 1) ? [{ id: "p1" }] : has(c, "limit", 50) ? [row("p2", "Pool condo")] : [row("recent", "Recent")]);
    const res = await searchProducts("u1", "condo with pool");
    expect(res.map((p) => p.id)).toEqual(["p2"]);
  });

  it("includes keyword matches for rows that have no embedding", async () => {
    ai.aiEmbed.mockResolvedValue([1, 0]);
    db.respond = (c) =>
      has(c, "limit", 1) ? [{ id: "p1" }]
      : has(c, "orderBy") ? [row("v1", "Vector hit")]
      : has(c, "limit", 50) ? [row("k1", "Pool condo, not embedded")]
      : [];
    const res = await searchProducts("u1", "pool condo");
    expect(res.map((p) => p.id)).toEqual(["v1", "k1"]);
    expect(ai.aiEmbed).toHaveBeenCalledWith("pool condo", "search_query");
  });
});

describe("addProduct", () => {
  it("saves the product and returns a warning when embedding fails", async () => {
    ai.aiEmbed.mockRejectedValue(new Error("OpenRouter embed 429: quota"));
    db.respond = () => [row("p1", "Widget")];
    const res = await addProduct("u1", { name: "Widget" });
    expect(res?.id).toBe("p1");
    expect(res?.warning).toMatch(/could not be indexed.*429/);
  });
});

describe("importProductsCsv", () => {
  it("reports rows saved without an embedding", async () => {
    ai.aiEmbedBatch.mockResolvedValue({ vectors: [[1], null], error: "OpenRouter embed 500" });
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
    ai.aiEmbedBatch.mockResolvedValue({ vectors: [[1], null, [2]], error: "OpenRouter embed 500" });
    db.respond = (c) => (c.op === "select" ? [row("a", "A"), row("b", "B"), row("c", "C")] : []);
    const res = await reembedProducts("u1");
    expect(res).toEqual({ embedded: 2, failed: 1, error: "OpenRouter embed 500" });
    const updates = db.queries.filter((q) => q.op === "update");
    expect(updates.map((u) => (u.calls.find((c) => c.name === "set")!.args[0] as { embedding: number[] }).embedding)).toEqual([[1], [2]]);
  });
});

describe("folder ownership", () => {
  const FOLDER = "11111111-2222-4333-8444-555555555555";
  const folderLookup = (c: Chain) => c.op === "select" && has(c, "limit", 1);

  it("refuses to add a product into a folder from another workspace", async () => {
    db.respond = () => []; // the folder lookup finds nothing in this workspace
    expect(await addProduct("u1", { name: "Widget", folderId: FOLDER })).toBeNull();
    expect(db.queries.some((q) => q.op === "insert")).toBe(false);
    expect(ai.aiEmbed).not.toHaveBeenCalled();
  });

  it("adds a product into a folder this workspace owns", async () => {
    ai.aiEmbed.mockResolvedValue([1]);
    db.respond = (c) => (folderLookup(c) ? [{ id: FOLDER }] : [row("p1", "Widget")]);
    expect((await addProduct("u1", { name: "Widget", folderId: FOLDER }))?.id).toBe("p1");
  });

  it("rejects a folder id that isn't a UUID without querying it", async () => {
    expect(await addProduct("u1", { name: "Widget", folderId: "x' OR 1=1" })).toBeNull();
    expect(db.queries).toHaveLength(0);
  });

  it("won't move a product into a foreign folder, but can clear its folder", async () => {
    await setProductFolder("u1", "p1", FOLDER);
    expect(db.queries.some((q) => q.op === "update")).toBe(false);
    await setProductFolder("u1", "p1", null);
    expect(db.queries.some((q) => q.op === "update")).toBe(true);
  });

  it("refuses a CSV import into a foreign folder", async () => {
    const res = await importProductsCsv("u1", "name\nA\n", FOLDER);
    expect(res).toEqual({ added: 0, error: "That folder doesn't exist." });
    expect(ai.aiEmbedBatch).not.toHaveBeenCalled();
  });

  it("returns a generic error when the import insert fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    ai.aiEmbedBatch.mockResolvedValue({ vectors: [[1]] });
    db.respond = (c) => { if (c.op === "insert") throw new Error('duplicate key value violates "products_pkey"'); return []; };
    const res = await importProductsCsv("u1", "name\nA\n");
    expect(res).toEqual({ added: 0, error: "Import failed. Please try again." });
    log.mockRestore();
  });
});
