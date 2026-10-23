import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startPolling, type PollEnv } from "./usePolling";

function fakeEnv() {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  return { env: { win, doc } as unknown as PollEnv, win, doc };
}
// Let the poller's promise chain settle.
const flush = () => vi.advanceTimersByTimeAsync(0);

describe("startPolling", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("runs now and again on each interval", async () => {
    const { env } = fakeEnv();
    const fn = vi.fn().mockResolvedValue(undefined);
    const stop = startPolling(fn, 30_000, env);
    await flush();
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fn).toHaveBeenCalledTimes(3);
    stop();
  });

  it("refreshes when the window regains focus or the tab becomes visible", async () => {
    const { env, win, doc } = fakeEnv();
    const fn = vi.fn().mockResolvedValue(undefined);
    const stop = startPolling(fn, 30_000, env);
    await flush();
    win.dispatchEvent(new Event("focus"));
    await flush();
    expect(fn).toHaveBeenCalledTimes(2);
    doc.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(fn).toHaveBeenCalledTimes(3);
    stop();
  });

  it("pauses while the tab is hidden", async () => {
    const { env, doc } = fakeEnv();
    const fn = vi.fn().mockResolvedValue(undefined);
    const stop = startPolling(fn, 30_000, env);
    await flush();
    doc.visibilityState = "hidden";
    await vi.advanceTimersByTimeAsync(90_000);
    expect(fn).toHaveBeenCalledTimes(1);
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(fn).toHaveBeenCalledTimes(2);
    stop();
  });

  it("never overlaps a slow fetch", async () => {
    const { env, win } = fakeEnv();
    let resolve!: () => void;
    const fn = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    const stop = startPolling(fn, 30_000, env);
    await flush();
    win.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fn).toHaveBeenCalledTimes(1);
    resolve();
    await flush();
    win.dispatchEvent(new Event("focus"));
    await flush();
    expect(fn).toHaveBeenCalledTimes(2);
    stop();
  });

  it("keeps polling after a failed fetch", async () => {
    const { env } = fakeEnv();
    const fn = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const stop = startPolling(fn, 30_000, env);
    await flush();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fn).toHaveBeenCalledTimes(2);
    stop();
  });

  it("stops the timer and listeners", async () => {
    const { env, win, doc } = fakeEnv();
    const fn = vi.fn().mockResolvedValue(undefined);
    const stop = startPolling(fn, 30_000, env);
    await flush();
    stop();
    win.dispatchEvent(new Event("focus"));
    doc.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(90_000);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
