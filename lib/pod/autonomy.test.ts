import { describe, expect, it } from "vitest";
import { autoCaps, capMode } from "./autonomy";

describe("capMode", () => {
  it("is Ask unless Auto was saved for that capability", () => {
    expect(capMode(undefined, "research")).toBe("ask");
    expect(capMode({}, "research")).toBe("ask");
    expect(capMode({ research: {} }, "research")).toBe("ask");
    expect(capMode({ research: { mode: "ask" } }, "research")).toBe("ask");
    expect(capMode({ research: { mode: "auto" } }, "research")).toBe("auto");
    expect(capMode({ research: { mode: "auto" } }, "qualify")).toBe("ask");
    expect(capMode({ research: { mode: "AUTO" } }, "research")).toBe("ask");
  });

  it("lists the capabilities saved as Auto", () => {
    expect(autoCaps({ research: { mode: "auto" }, qualify: { mode: "ask" }, "book-meeting": { type: "Call" } })).toEqual(["research"]);
    expect(autoCaps(null)).toEqual([]);
  });
});
