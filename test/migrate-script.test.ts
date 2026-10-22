import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// scripts/migrate.mjs against a fake Neon client: every migration but the
// newest is already recorded, so the run applies exactly one.
const dir = join(process.cwd(), "lib/db/migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const newest = files[files.length - 1];

const run: { text: string; params?: unknown[] }[] = [];
const transactions: { text: string; params?: unknown[] }[][] = [];

vi.mock("dotenv", () => ({ config: () => ({}) }));
vi.mock("@neondatabase/serverless", () => ({
  neon: () => {
    // sql.query() builds a query object; awaiting it outside a transaction runs it.
    const query = (text: string, params?: unknown[]) => {
      const q = { text, params };
      return Object.assign(q, {
        then: (ok: (rows: unknown[]) => unknown) => {
          run.push(q);
          return Promise.resolve(/^SELECT name FROM "_migrations"/.test(text) ? files.slice(0, -1).map((name) => ({ name })) : []).then(ok);
        },
      });
    };
    return {
      query,
      transaction: async (qs: { text: string; params?: unknown[] }[]) => {
        transactions.push(qs.map(({ text, params }) => ({ text, params })));
        return qs.map(() => []);
      },
    };
  },
}));

describe("scripts/migrate.mjs", () => {
  it("applies a migration's statements and its _migrations row in one transaction", async () => {
    process.env.DATABASE_URL = "postgres://fake";
    vi.spyOn(console, "log").mockImplementation(() => {});
    await import("../scripts/migrate.mjs");

    const statements = readFileSync(join(dir, newest), "utf8").split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
    expect(transactions).toHaveLength(1);
    const [tx] = transactions;
    expect(tx).toHaveLength(statements.length + 1);
    expect(tx.slice(0, -1).map((q) => q.text)).toEqual(statements);
    expect(tx[tx.length - 1]).toEqual({ text: `INSERT INTO "_migrations" (name) VALUES ($1)`, params: [newest] });
    // Nothing from the migration ran outside the transaction.
    expect(run.some((q) => statements.includes(q.text))).toBe(false);
  });
});
