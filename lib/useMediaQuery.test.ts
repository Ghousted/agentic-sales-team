import { describe, it, expect } from "vitest";
import { watchMedia, type MediaList } from "./useMediaQuery";

function fakeMedia(matches: boolean) {
  const listeners = new Set<() => void>();
  const mq: MediaList & { set(m: boolean): void; count(): number } = {
    matches,
    addEventListener: (_t, l) => { listeners.add(l); },
    removeEventListener: (_t, l) => { listeners.delete(l); },
    set(m) { this.matches = m; listeners.forEach((l) => l()); },
    count: () => listeners.size,
  };
  return mq;
}

describe("watchMedia", () => {
  it("reports the current match at once and every change after", () => {
    const mq = fakeMedia(true);
    const seen: boolean[] = [];
    watchMedia(mq, (m) => seen.push(m));
    mq.set(false);
    mq.set(true);
    expect(seen).toEqual([true, false, true]);
  });

  it("stops listening when stopped", () => {
    const mq = fakeMedia(false);
    const seen: boolean[] = [];
    const stop = watchMedia(mq, (m) => seen.push(m));
    stop();
    mq.set(true);
    expect(seen).toEqual([false]);
    expect(mq.count()).toBe(0);
  });
});
