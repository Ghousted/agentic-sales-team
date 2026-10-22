import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// There is no DOM test setup, so these check the source: every destructive
// call must sit behind the two-click confirm (useConfirmClick).
const src = (f: string) => readFileSync(path.resolve(__dirname, "..", f), "utf8");

describe("destructive actions need a second click (T34)", () => {
  it("agent delete on /agents is gated by confirm", () => {
    const s = src("app/agents/page.tsx");
    expect(s).toMatch(/useConfirmClick\(/);
    expect(s.match(/deleteAgent\(a\.id\)/g) ?? []).toHaveLength(1);
    expect(s).toMatch(/if \(del\.confirm\(a\.id\)\) deleteAgent\(a\.id\)/);
  });

  it("product and folder delete are gated by confirm", () => {
    const s = src("app/products/ProductsClient.tsx");
    expect(s).toMatch(/useConfirmClick\(/);
    expect(s).toMatch(/if \(!del\.confirm\("f:" \+ folder\)\) return;\s*await deleteFolder\(folder\)/);
    expect(s).toMatch(/if \(!del\.confirm\("p:" \+ id\)\) return;\s*await deleteProduct\(id\)/);
  });
});
