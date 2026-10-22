import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({}));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));

import { clampListLimit } from "./stats";

describe("clampListLimit", () => {
  it("keeps a sane limit", () => {
    expect(clampListLimit(12)).toBe(12);
  });

  it("caps huge and floors tiny or fractional limits", () => {
    expect(clampListLimit(1_000_000)).toBe(100);
    expect(clampListLimit(0)).toBe(1);
    expect(clampListLimit(-5)).toBe(1);
    expect(clampListLimit(7.9)).toBe(7);
  });

  it("falls back to 30 for anything that isn't a finite number", () => {
    expect(clampListLimit(undefined)).toBe(30);
    expect(clampListLimit(NaN)).toBe(30);
    expect(clampListLimit(Infinity)).toBe(30);
    expect(clampListLimit("500")).toBe(30);
  });
});
