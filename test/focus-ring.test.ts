// T54: form fields show a focus ring for keyboard users, even where the field
// sets outline:none inline, and a mouse click still shows none.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { startKeyboardModality, type ModalityDoc } from "@/lib/useKeyboardModality";

const root = path.resolve(__dirname, "..");
const src = (f: string) => readFileSync(path.join(root, f), "utf8");

function files(dir: string): string[] {
  return readdirSync(path.join(root, dir)).flatMap((name) => {
    const rel = path.join(dir, name);
    if (statSync(path.join(root, rel)).isDirectory()) return files(rel);
    return /\.tsx?$/.test(rel) && !/\.test\./.test(rel) ? [rel] : [];
  });
}

function fakeDoc() {
  const listeners: Record<string, ((e: { key?: string }) => void)[]> = { keydown: [], pointerdown: [] };
  const doc: ModalityDoc = {
    documentElement: { dataset: {} },
    addEventListener: (t, l) => { listeners[t].push(l); },
    removeEventListener: (t, l) => { listeners[t] = listeners[t].filter((x) => x !== l); },
  };
  const fire = (t: "keydown" | "pointerdown", key?: string) => listeners[t].forEach((l) => l({ key }));
  return { doc, fire, listeners };
}

describe("keyboard modality", () => {
  it("marks html on Tab and clears it on a pointer press", () => {
    const { doc, fire } = fakeDoc();
    startKeyboardModality(doc);
    expect("kbd" in doc.documentElement.dataset).toBe(false);
    fire("keydown", "a");
    expect("kbd" in doc.documentElement.dataset).toBe(false);
    fire("keydown", "Tab");
    expect(doc.documentElement.dataset.kbd).toBe("");
    fire("pointerdown");
    expect("kbd" in doc.documentElement.dataset).toBe(false);
  });

  it("removes its listeners and the mark when stopped", () => {
    const { doc, fire, listeners } = fakeDoc();
    const stop = startKeyboardModality(doc);
    fire("keydown", "Tab");
    stop();
    expect(listeners.keydown).toHaveLength(0);
    expect(listeners.pointerdown).toHaveLength(0);
    expect("kbd" in doc.documentElement.dataset).toBe(false);
  });

  it("is started by AppFrame, which wraps every page", () => {
    expect(src("components/AppFrame.tsx")).toMatch(/useKeyboardModality\(\)/);
  });
});

describe("field focus ring", () => {
  const cssText = src("app/globals.css");
  const rule = cssText.split("\n").find((l) => l.startsWith("html[data-kbd]")) ?? "";

  it("covers input, textarea and select under html[data-kbd], with !important to beat inline outline:none", () => {
    for (const el of ["input", "textarea", "select"]) expect(rule).toContain(`html[data-kbd] ${el}:focus`);
    expect(rule).toMatch(/outline:\s*2px solid #006AFF !important/);
  });

  it("no stylesheet hides field focus with !important, which would beat the ring", () => {
    for (const f of [...files("app"), ...files("components"), "app/globals.css"]) {
      expect(src(f), f).not.toMatch(/outline:\s*(none|0)\s*!important/);
    }
  });
});

describe("agent page Ask/Auto", () => {
  it("toggle buttons say which one is on", () => {
    const page = src("app/agents/[id]/page.tsx");
    expect(page).toContain('aria-pressed={mode === "auto"}');
    expect(page).toContain('aria-pressed={mode === "ask"}');
  });
});
