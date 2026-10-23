import { describe, it, expect, vi } from "vitest";
import { guardedRun } from "./useRunGuard";

describe("guardedRun (T28)", () => {
  it("a second call while the first is in flight starts nothing", async () => {
    const inFlight = new Set<string>();
    let release!: () => void;
    const fn = vi.fn(() => new Promise<void>((r) => { release = r; }));
    const first = guardedRun(inFlight, "scrape", fn);
    expect(await guardedRun(inFlight, "scrape", fn)).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
    release();
    expect(await first).toBe(true);
    expect(inFlight.size).toBe(0);
  });

  it("different keys run independently", async () => {
    const inFlight = new Set<string>();
    const fn = vi.fn(() => new Promise<void>(() => {}));
    void guardedRun(inFlight, "research", fn);
    void guardedRun(inFlight, "qualify", fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("a throw reaches onError, and onEnd still runs so the spinner clears", async () => {
    const inFlight = new Set<string>();
    const onStart = vi.fn(), onEnd = vi.fn(), onError = vi.fn();
    const ok = await guardedRun(inFlight, "outreach", async () => { throw new Error("boom"); }, { onStart, onEnd, onError });
    expect(ok).toBe(true);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "boom" }));
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(inFlight.has("outreach")).toBe(false);
    // The key is free again after the failure.
    expect(await guardedRun(inFlight, "outreach", async () => {})).toBe(true);
  });
});
