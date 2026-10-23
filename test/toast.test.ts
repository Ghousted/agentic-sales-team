import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// No DOM test setup, so these check the source (T37).
const src = (f: string) => readFileSync(path.resolve(__dirname, "..", f), "utf8");

describe("toast (T37)", () => {
  it("toastIn keeps the translateX(-50%) centring in every frame", () => {
    const kf = src("app/globals.css").match(/@keyframes toastIn \{(.*)\}/)?.[1] ?? "";
    const frames = kf.match(/transform:[^;]+/g) ?? [];
    expect(frames).toHaveLength(2);
    for (const f of frames) expect(f).toMatch(/translate\(-50%,/);
  });

  it("the error variant has its own background and icon", () => {
    const s = src("components/Toast.tsx");
    expect(s).toMatch(/s\.toastError \? "background:#991B1B" : "background:#18181B"/);
    expect(s).toMatch(/s\.toastError \? "✕" : "✓"/);
  });

  // A failure message sent through showToast shows a green ✓.
  const FAILURE = /showToast\(\s*(?:res\.error|"[^"]*(?:Couldn't|failed|required|went wrong|first, then)[^"]*"|first\(agent\))/;
  for (const f of [
    "app/leads/LeadsClient.tsx",
    "app/products/ProductsClient.tsx",
    "app/emails/EmailsClient.tsx",
    "app/agents/[id]/page.tsx",
    "app/ChatHome.tsx",
    "app/teams/[id]/page.tsx",
    "app/chats/page.tsx",
  ]) {
    it(`${f} sends failures through showError`, () => {
      expect(src(f)).not.toMatch(FAILURE);
    });
  }
});
