import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// There is no DOM test setup, so these check the source of the agent page.
const src = readFileSync(path.resolve(__dirname, "..", "app/agents/[id]/page.tsx"), "utf8");

describe("agent page run buttons (T28)", () => {
  it.each([
    ["runScrape", "scrape"], ["runQualify", "qualify"], ["runResearch", "research"],
    ["runOutreachForAgent", "outreach"], ["runProposals", "proposal"],
  ])("%s is disabled while in flight and goes through the guard", (fn, key) => {
    expect(src).toContain(`<Btn onClick={${fn}} disabled={!!busy.${key}}`);
    expect(src).toMatch(new RegExp(`run\\("${key}"|runBatch\\("${key}"\\)`));
  });

  it("the outreach enqueue result is checked", () => {
    expect(src).toMatch(/enqueueAndRun\(await enqueueOutreachJob\(/);
    expect(src).toMatch(/if \("error" in res\) \{ showError\(res\.error\); return false; \}/);
  });

  it("meeting type saves on blur, not on every keystroke", () => {
    expect(src).not.toMatch(/onChange=\{\(e\) => setCapSetting\(cap, \{ type:/);
    expect(src).toMatch(/onBlur=\{\(e\) => \{ const v = e\.target\.value\.trim\(\)/);
  });

  it("Meetings lists the agent's own booked meetings", () => {
    expect(src).toMatch(/listMeetings\(\)\.then\(\(ms\) => setAgentMeetings\(ms\.filter\(\(m\) => m\.agentId === selId\)\)\)/);
    expect(src).toMatch(/agentMeetings\.map\(/);
  });
});
