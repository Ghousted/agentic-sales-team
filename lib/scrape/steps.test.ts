import { describe, expect, it, vi } from "vitest";
import { cleanTitle, createStepLog, domainOf, runIdFrom, runMarker, stepSummary, trunc, type ScrapeStep } from "./steps";

describe("step log", () => {
  it("replaces a step by id and writes every change in order", async () => {
    const writes: string[][] = [];
    const log = createStepLog(async (steps) => { await new Promise((r) => setTimeout(r, 1)); writes.push(steps.map((s) => `${s.id}:${s.status}`)); });
    log.put({ id: "plan", status: "active", label: "Planning" });
    log.put({ id: "plan", status: "done", label: "Searching" });
    log.put({ id: "search", status: "active", label: "Searching Reddit" });
    await log.flush();
    expect(writes).toEqual([["plan:active"], ["plan:done"], ["plan:done", "search:active"]]);
    expect(log.all().map((s) => s.label)).toEqual(["Searching", "Searching Reddit"]);
  });

  it("keeps going when a write fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const ok: number[] = [];
    let n = 0;
    const log = createStepLog(async () => { n++; if (n === 1) throw new Error("db down"); ok.push(n); });
    log.put({ id: "plan", status: "active", label: "a" });
    log.put({ id: "plan", status: "done", label: "b" });
    await log.flush();
    expect(ok).toEqual([2]);
  });

  it("works with no writer", () => {
    const log = createStepLog();
    log.put({ id: "save", status: "done", label: "3 new leads saved" });
    expect(log.all()).toHaveLength(1);
  });
});

describe("helpers", () => {
  it("reads a domain", () => {
    expect(domainOf("https://www.reddit.com/r/x/1")).toBe("reddit.com");
    expect(domainOf("nope")).toBe("");
  });

  it("drops the site suffix from a title", () => {
    expect(cleanTitle("JCI Manila - Facebook")).toBe("JCI Manila");
    expect(cleanTitle("Jane Doe - HR Director - Acme | LinkedIn")).toBe("Jane Doe - HR Director - Acme");
    expect(cleanTitle("What if AI companies ... - Reddit")).toBe("What if AI companies ...");
    expect(cleanTitle("Plain title")).toBe("Plain title");
  });

  it("truncates", () => {
    expect(trunc("a  b", 10)).toBe("a b");
    expect(trunc("abcdefghij", 5)).toBe("abcd…");
  });

  it("round-trips the run marker", () => {
    const id = "33333333-3333-4333-8333-333333333333";
    expect(runIdFrom(`Starting.${runMarker(id)}`)).toBe(id);
    expect(runIdFrom("⟦run:nope⟧")).toBeNull();
  });

  it("sums up a finished run", () => {
    const steps: ScrapeStep[] = [
      { id: "plan", status: "done", label: 'Searching for "x"' },
      { id: "search", status: "done", label: "Found 47 sources on Facebook and Reddit" },
      { id: "gate", status: "done", label: "Dropped 11 sellers", items: [{ title: "a", meta: "" }, { title: "b", meta: "" }, { title: "c", meta: "" }], more: 8 },
      { id: "extract", status: "done", label: "Picked out 9 leads" },
      { id: "save", status: "done", label: "8 new leads saved" },
    ];
    expect(stepSummary(steps)).toBe("47 sources · 11 dropped · 8 new leads saved");
  });
});
