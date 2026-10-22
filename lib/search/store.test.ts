import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

// A chainable stand-in for the Drizzle query builder (same shape as
// lib/products/store.test.ts). Each awaited query is answered by `respond`.
type Chain = { calls: { name: string; args: unknown[] }[] };
const db = vi.hoisted(() => ({
  respond: (_c: Chain): unknown => [],
  queries: [] as Chain[],
}));

vi.mock("@/lib/db", async () => {
  const schema = await vi.importActual<typeof import("@/lib/db/schema")>("@/lib/db/schema");
  const builder = () => {
    const chain: Chain = { calls: [] };
    db.queries.push(chain);
    const proxy: object = new Proxy({}, {
      get(_t, prop) {
        if (prop === "then") return (res: (v: unknown) => void, rej: (e: unknown) => void) => Promise.resolve().then(() => db.respond(chain)).then(res, rej);
        return (...args: unknown[]) => { chain.calls.push({ name: String(prop), args }); return proxy; };
      },
    });
    return proxy;
  };
  return { ...schema, isDbConfigured: () => true, getDb: () => ({ select: () => builder() }) };
});

import { leads, products } from "@/lib/db/schema";
import { likePattern, searchRecords, SEARCH_LIMIT } from "./store";

const arg = (c: Chain, name: string) => c.calls.find((x) => x.name === name)?.args[0];
const table = (c: Chain) => arg(c, "from");
const where = (c: Chain) => new PgDialect().sqlToQuery(arg(c, "where") as SQL);

beforeEach(() => {
  db.queries = [];
  db.respond = () => [];
});

describe("searchRecords", () => {
  it("returns the caller's matching leads and products", async () => {
    db.respond = (c) => table(c) === leads
      ? [{ id: "l1", name: "Ana Reyes", title: "CTO", company: "Acme", email: "ana@acme.io" }, { id: "l2", name: "Bo", title: "", company: "", email: "bo@x.io" }]
      : [{ id: "p1", name: "Acme Suite", category: "SaaS", price: "$99" }];
    const res = await searchRecords("u1", "  acme ");
    expect(res.leads).toEqual([
      { id: "l1", title: "Ana Reyes", subtitle: "CTO · Acme" },
      { id: "l2", title: "Bo", subtitle: "bo@x.io" },
    ]);
    expect(res.products).toEqual([{ id: "p1", title: "Acme Suite", subtitle: "SaaS · $99" }]);
  });

  it("scopes both queries to the user, skips dismissed leads, and caps results", async () => {
    await searchRecords("u1", "acme");
    expect(db.queries).toHaveLength(2);
    const [lq, pq] = [db.queries.find((c) => table(c) === leads)!, db.queries.find((c) => table(c) === products)!];
    for (const c of [lq, pq]) {
      expect(arg(c, "limit")).toBe(SEARCH_LIMIT);
      expect(where(c).params).toContain("u1");
      expect(where(c).params).toContain("%acme%");
    }
    expect(where(lq).sql).toMatch(/"review" <> \$\d/);
    expect(where(lq).params).toContain("dismissed");
  });

  it("does not query for empty or one-character input", async () => {
    expect(await searchRecords("u1", "   ")).toEqual({ leads: [], products: [] });
    expect(await searchRecords("u1", "a")).toEqual({ leads: [], products: [] });
    expect(db.queries).toHaveLength(0);
  });

  it("matches LIKE wildcards literally", () => {
    expect(likePattern("50%_off\\")).toBe("%50\\%\\_off\\\\%");
  });
});
