import { describe, expect, it } from "vitest";

describe("test runner", () => {
  it("resolves the @/ alias", async () => {
    const mod = await import("@/lib/calendar");
    expect(mod).toBeTypeOf("object");
  });
});
