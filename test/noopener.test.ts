import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Every new tab must be opened without `window.opener` (T59). The page and
// component code goes through openExternal / openMailto in lib/url/safeUrl.ts.
const root = path.resolve(__dirname, "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

describe("window.open (T59)", () => {
  it("is never called without noopener in app/, components/ or lib/", () => {
    const bad: string[] = [];
    for (const dir of ["app", "components", "lib"]) {
      for (const file of sources(path.join(root, dir))) {
        readFileSync(file, "utf8").split("\n").forEach((line, i) => {
          if (/window\.open\(/.test(line) && !/noopener/.test(line)) bad.push(`${path.relative(root, file)}:${i + 1}`);
        });
      }
    }
    expect(bad).toEqual([]);
  });
});
