// T43: accessibility pass — shared Modal, real labels, keyboard-reachable cards,
// search that survives Tab, and readable muted text.
import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import Modal, { wrapTarget } from "@/components/Modal";
import { focusStaysIn } from "@/components/GlobalSearch";

(globalThis as { React?: typeof React }).React = React;

// No DOM test setup, so behaviour that needs a document is checked in the source.
const root = path.resolve(__dirname, "..");
const src = (f: string) => readFileSync(path.join(root, f), "utf8");

function tsxFiles(dir: string): string[] {
  return readdirSync(path.join(root, dir)).flatMap((name) => {
    const rel = path.join(dir, name);
    if (statSync(path.join(root, rel)).isDirectory()) return name === "landing" ? [] : tsxFiles(rel);
    return rel.endsWith(".tsx") ? [rel] : [];
  });
}

function luminance(hex: string): number {
  const c = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("Modal", () => {
  it("renders a labelled, modal dialog", () => {
    const html = renderToStaticMarkup(<Modal onClose={() => {}} labelledBy="t"><h2 id="t">Title</h2></Modal>);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="t"');
    expect(html).not.toContain("aria-label=");
  });

  it("falls back to aria-label when there is no title id", () => {
    const html = renderToStaticMarkup(<Modal onClose={() => {}} label="Lead details">x</Modal>);
    expect(html).toContain('aria-label="Lead details"');
  });

  it("closes on Escape, traps Tab and restores focus", () => {
    const m = src("components/Modal.tsx");
    expect(m).toMatch(/e\.key === "Escape"/);
    expect(m).toMatch(/e\.key !== "Tab"/);
    expect(m).toMatch(/opener\.focus\(\)/);
  });
});

describe("wrapTarget (focus trap)", () => {
  const items = ["a", "b", "c"];
  it("wraps Tab from the last item to the first", () => expect(wrapTarget(items, "c", false)).toBe("a"));
  it("wraps Shift+Tab from the first item to the last", () => expect(wrapTarget(items, "a", true)).toBe("c"));
  it("lets the browser move focus between inner items", () => {
    expect(wrapTarget(items, "a", false)).toBeNull();
    expect(wrapTarget(items, "c", true)).toBeNull();
  });
  it("pulls focus back in when it is outside the card", () => {
    expect(wrapTarget(items, null, false)).toBe("a");
    expect(wrapTarget(items, null, true)).toBe("c");
  });
  it("does nothing when there is nothing to focus", () => expect(wrapTarget([], null, false)).toBeNull());
});

describe("modals use the shared Modal", () => {
  for (const f of ["components/TeamModal.tsx", "app/teams/[id]/page.tsx", "app/leads/LeadsClient.tsx", "app/products/ProductsClient.tsx", "app/chats/ScrapeResults.tsx"]) {
    it(f, () => {
      const s = src(f);
      expect(s).toMatch(/<Modal\b/);
      // No hand-rolled overlay left behind.
      expect(s).not.toMatch(/<div onClick=\{[^}]*\} style=\{css\("position:fixed;inset:0;background:rgba\(24,24,27/);
    });
  }
});

describe("form fields have names", () => {
  it("modal and settings captions are <label htmlFor>", () => {
    for (const [f, ids] of Object.entries({
      "components/TeamModal.tsx": ["team-modal-name", "team-modal-goal"],
      "app/teams/[id]/page.tsx": ["edit-team-name", "edit-team-goal"],
      "app/leads/LeadsClient.tsx": ["add-lead-name", "add-lead-role", "add-lead-company", "add-lead-email", "add-lead-agent"],
      "app/products/ProductsClient.tsx": ["new-folder-name", "add-product-name", "add-product-category", "add-product-price", "add-product-description"],
      "app/settings/page.tsx": ["settings-workspace-name", "settings-your-name"],
      "app/agents/[id]/page.tsx": ["agent-cfg-role", "agent-cfg-goal"],
    })) {
      const s = src(f);
      for (const id of ids) {
        expect(s, `${f} label for ${id}`).toContain(`htmlFor="${id}"`);
        expect(s, `${f} field ${id}`).toMatch(new RegExp(`<(input|textarea|select)\\b[^>]*\\bid="${id}"|<(input|textarea|select)\\s*\\n\\s*id="${id}"`));
      }
    }
  });

  it("every single-line input, textarea and select has a label, id or aria-label", () => {
    const bare: string[] = [];
    // Login wraps every field in <Field>, which is a <label>.
    for (const f of [...tsxFiles("app"), ...tsxFiles("components")].filter((f) => f !== path.join("components", "Login.tsx"))) {
      const lines = src(f).split("\n");
      lines.forEach((line, i) => {
        const tag = line.match(/<(input|textarea|select)\b/);
        if (!tag || line.trim().endsWith(`<${tag[1]}`)) return; // multi-line tags are checked by eye
        if (/aria-label|aria-labelledby|\bid=/.test(line)) return;
        if (/<label\b/.test(line) || /<label\b/.test(lines[i - 1] ?? "")) return;
        bare.push(`${f}:${i + 1}`);
      });
    }
    expect(bare).toEqual([]);
  });
});

describe("clickable cards are reachable by keyboard", () => {
  it("agent cards and team member rows link the name", () => {
    expect(src("app/agents/page.tsx")).toMatch(/<Link href=\{"\/agents\/" \+ a\.id\}/);
    expect(src("app/teams/[id]/page.tsx")).toMatch(/<Link href=\{"\/agents\/" \+ a!\.id\}/);
  });
  it("links get the keyboard focus ring", () => {
    expect(src("app/globals.css")).toMatch(/a:focus-visible \{ outline/);
  });
});

describe("GlobalSearch", () => {
  const s = src("components/GlobalSearch.tsx");
  it("closes on container focus-out, not a blur timer", () => {
    expect(s).not.toMatch(/setTimeout\(\(\) => setOpen\(false\)/);
    expect(s).toMatch(/focusStaysIn\(e\.currentTarget, e\.relatedTarget\)/);
  });
  it("focusStaysIn", () => {
    const inside = {} as Node;
    const box = { contains: (n: Node | null) => n === inside };
    expect(focusStaysIn(box, inside as unknown as EventTarget)).toBe(true);
    expect(focusStaysIn(box, {} as EventTarget)).toBe(false);
    expect(focusStaysIn(box, null)).toBe(false);
  });
});

describe("mobile drawer", () => {
  const s = src("components/Shell.tsx");
  it("is a modal dialog with a focus trap that returns focus to the menu button", () => {
    expect(s).toMatch(/role=\{drawer \? "dialog" : undefined\} aria-modal=\{drawer \|\| undefined\}/);
    expect(s).toMatch(/wrapTarget\(focusablesIn\(aside\)/);
    expect(s).toMatch(/getElementById\("drawer-menu-btn"\)\?\.focus\(\)/);
  });
});

describe("muted text contrast", () => {
  const css = src("app/globals.css");
  const token = css.match(/--text-muted:\s*#([0-9A-Fa-f]{6})/)?.[1];
  it("--text-muted is AA (4.5:1) on white and on the page background", () => {
    expect(token).toBeTruthy();
    expect(contrast(token!, "FFFFFF")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token!, "FAFAFB")).toBeGreaterThanOrEqual(4.5);
  });
  it("no app text uses the old #A1A1AA", () => {
    const left = [...tsxFiles("app"), ...tsxFiles("components")].filter((f) => /color:\s*"?#A1A1AA/i.test(src(f)));
    expect(left).toEqual([]);
  });
});
