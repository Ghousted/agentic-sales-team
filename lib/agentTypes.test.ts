import { describe, expect, it } from "vitest";
import * as agentTypes from "@/lib/agentTypes";
import { CAPABILITIES, TEAM_TEMPLATES } from "@/lib/agentTypes";

const ready = (c: string) => CAPABILITIES.find((x) => x.id === c)?.engineReady === true;

describe("team templates", () => {
  it("only require capabilities the engine can run", () => {
    for (const t of TEAM_TEMPLATES) {
      expect(t.requiredCapabilities.filter((c) => !ready(c)), t.id).toEqual([]);
    }
  });

  it("keep not-ready capabilities visible as coming soon", () => {
    const outbound = TEAM_TEMPLATES.find((t) => t.id === "outbound") as unknown as { comingSoon?: string[] };
    expect(outbound.comingSoon).toEqual(["follow-up"]);
  });
});

describe("parseMeetingMinutes", () => {
  const parse = (agentTypes as Record<string, unknown>).parseMeetingMinutes as ((s: string) => number | undefined) | undefined;

  it("maps the wizard's free-text length to the numeric duration meetings read", () => {
    expect(parse).toBeTypeOf("function");
    expect(parse!("30 min")).toBe(30);
    expect(parse!("45")).toBe(45);
    expect(parse!("1 hour")).toBe(60);
    expect(parse!("1.5h")).toBe(90);
    expect(parse!(" 20 Minutes ")).toBe(20);
  });

  it("rejects text it can't turn into a sane length", () => {
    expect(parse!("")).toBeUndefined();
    expect(parse!("half an hour")).toBeUndefined();
    expect(parse!("0")).toBeUndefined();
    expect(parse!("2 min")).toBeUndefined();
    expect(parse!("10 hours")).toBeUndefined();
  });
});
