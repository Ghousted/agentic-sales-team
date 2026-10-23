import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// No DOM test setup, so these check the source (T38).
const src = (f: string) => readFileSync(path.resolve(__dirname, "..", f), "utf8");

describe("app store doesn't re-render the whole tree on a timer (T38)", () => {
  const store = src("lib/store.tsx");

  it("has no app-wide interval or animation-frame state", () => {
    expect(store).not.toMatch(/hubTick|countT|requestAnimationFrame/);
    expect(store).not.toMatch(/setInterval\(/);
  });

  it("memoizes the context value", () => {
    expect(store).toMatch(/const value = useMemo<Ctx>\(/);
  });
});

describe("dashboard (T38)", () => {
  const home = src("app/dashboard/HomeClient.tsx");

  it("sizes the hub from the card, not from guessed sidebar widths", () => {
    expect(home).toMatch(/new ResizeObserver\(/);
    expect(home).not.toMatch(/sidebarOpen \? 224 : 70/);
  });

  it("greets by time of day, computed after mount", () => {
    expect(home).not.toMatch(/>Good morning, /);
    expect(home).toMatch(/greetingFor\(now\.getHours\(\)\)/);
    // The only Date in the file is inside the mount effect.
    expect(home.match(/new Date\(/g) ?? []).toHaveLength(1);
    expect(home).toMatch(/useEffect\(\(\) => \{\s*const now = new Date\(\);/);
  });

  it("hides the activity pills when there is no activity", () => {
    expect(home).toMatch(/\{hubLive && <div/);
    expect(home).toMatch(/\{hubLive2 && <div/);
  });

  it("keeps the badge tick local to the dashboard", () => {
    expect(home).toMatch(/setInterval\(\(\) => setTick\(/);
  });
});
