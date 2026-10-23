import { describe, it, expect } from "vitest";
import { greetingFor, hubScaleFor } from "./greeting";

describe("greetingFor", () => {
  it("follows the local hour", () => {
    expect(greetingFor(5)).toBe("Good morning");
    expect(greetingFor(11)).toBe("Good morning");
    expect(greetingFor(12)).toBe("Good afternoon");
    expect(greetingFor(17)).toBe("Good afternoon");
    expect(greetingFor(18)).toBe("Good evening");
    expect(greetingFor(0)).toBe("Good evening");
    expect(greetingFor(4)).toBe("Good evening");
  });
});

describe("hubScaleFor", () => {
  it("fits the hub to the card and clamps to 0.7–1.45", () => {
    expect(hubScaleFor(800, 596)).toBe(1); // (800-40)/760 = 1, (596-72)/524 = 1
    expect(hubScaleFor(420, 596)).toBe(0.7); // too narrow: clamped up
    expect(hubScaleFor(3000, 3000)).toBe(1.45); // huge: clamped down
    expect(hubScaleFor(2000, 596)).toBe(1); // wide card: height limits
  });
});
