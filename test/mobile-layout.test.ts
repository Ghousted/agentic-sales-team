import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MOBILE_QUERY } from "@/lib/useMediaQuery";

// No DOM test setup, so these check the source (T42).
const src = (f: string) => readFileSync(path.resolve(__dirname, "..", f), "utf8");

describe("small-screen CSS (T42)", () => {
  const cssText = src("app/globals.css");
  const media = cssText.slice(cssText.indexOf("@media (max-width: 767px)"));

  it("uses the same breakpoint as MOBILE_QUERY", () => {
    expect(MOBILE_QUERY).toBe("(max-width: 767px)");
    expect(cssText).toContain("@media (max-width: 767px) {");
  });

  it("hides mobile-only controls on desktop", () => {
    const before = cssText.slice(0, cssText.indexOf("@media (max-width: 767px)"));
    expect(before).toMatch(/\.m-only \{ display: none !important; \}/);
  });

  it("defines every layout class inside the breakpoint", () => {
    for (const c of ["m-only", "m-hide", "m-page", "m-stack", "m-2col", "m-scroll", "m-table", "m-modal", "m-wrap", "m-fluid", "m-header", "m-wiz-body", "m-wiz-card", "m-step-line"]) {
      expect(media, c).toContain("." + c + " {");
    }
  });
});

describe("app shell on small screens (T42)", () => {
  const shell = src("components/Shell.tsx");

  it("hides the docked sidebar and the rail with CSS, so the first paint is right", () => {
    expect(shell).toMatch(/<aside aria-label="Sidebar" className=\{drawer \? undefined : "m-hide"\}/);
    expect(shell).toMatch(/<nav aria-label="Main" className="m-hide"/);
  });

  it("opens a drawer from a header menu button and closes it on navigation", () => {
    expect(shell).toMatch(/className="m-only" onClick=\{\(\) => setDrawer\(true\)\} aria-label="Open menu"/);
    expect(shell).toMatch(/useEffect\(\(\) => \{ setDrawer\(false\); \}, \[path\]\);/);
    expect(shell).toMatch(/const openChat = \(id: string\) => \{ setDrawer\(false\);/);
  });

  it("keeps the desktop sidebar choice separate from the drawer", () => {
    expect(shell).toMatch(/if \(drawer\) setDrawer\(false\); else set\(\{ sidebarOpen: false \}\);/);
  });
});

describe("pages use the small-screen classes (T42)", () => {
  const pages = [
    "app/dashboard/HomeClient.tsx",
    "app/agents/page.tsx",
    "app/agents/[id]/page.tsx",
    "app/teams/[id]/page.tsx",
    "app/leads/LeadsClient.tsx",
    "app/products/ProductsClient.tsx",
    "app/calendar/CalendarClient.tsx",
    "app/emails/EmailsClient.tsx",
    "app/settings/page.tsx",
  ];

  it.each(pages)("%s has mobile page padding", (f) => {
    expect(src(f)).toContain('className="m-page"');
  });

  it("wide tables scroll sideways instead of squashing", () => {
    for (const f of ["app/leads/LeadsClient.tsx", "app/products/ProductsClient.tsx", "app/agents/[id]/page.tsx"]) {
      const s = src(f);
      expect(s, f).toContain('className="m-scroll"');
      expect(s, f).toContain('className="m-table"');
    }
  });

  it("the create wizard and team modal fit a phone", () => {
    const wiz = src("app/create/page.tsx");
    expect(wiz).toContain('className="m-wiz-body"');
    expect(wiz).toContain('className="m-wiz-card"');
    expect(src("components/TeamModal.tsx")).toContain('className="m-modal"');
  });
});
