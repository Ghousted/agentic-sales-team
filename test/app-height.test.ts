import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { css } from "@/components/primitives";

// No DOM test setup, so these check the source (T55).
const src = (f: string) => readFileSync(path.resolve(__dirname, "..", f), "utf8");

describe("app height on iOS Safari (T55)", () => {
  it("defines --app-h as 100vh with a 100dvh override where supported", () => {
    const cssText = src("app/globals.css");
    expect(cssText).toContain(":root { --app-h: 100vh; }");
    expect(cssText).toContain("@supports (height: 100dvh) { :root { --app-h: 100dvh; } }");
  });

  it("sizes the app shell, dashboard hub and emails list from --app-h, not 100vh", () => {
    for (const f of ["components/Shell.tsx", "app/dashboard/HomeClient.tsx", "app/emails/EmailsClient.tsx"]) {
      const s = src(f);
      expect(s, f).not.toContain("100vh");
      expect(s, f).toContain("var(--app-h)");
    }
    expect(src("components/Shell.tsx").match(/height:var\(--app-h\);/g)).toHaveLength(3);
  });

  it("passes var() and calc() through css() unchanged", () => {
    expect(css("height:var(--app-h)")).toEqual({ height: "var(--app-h)" });
    expect(css("max-height:calc(var(--app-h) - 300px)")).toEqual({ maxHeight: "calc(var(--app-h) - 300px)" });
  });
});
