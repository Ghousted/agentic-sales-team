import { describe, expect, it } from "vitest";
import { isNearBottom, shouldStick } from "./scroll";

describe("isNearBottom", () => {
  it("is true at the very bottom", () => {
    expect(isNearBottom({ scrollTop: 600, scrollHeight: 1000, clientHeight: 400 })).toBe(true);
  });

  it("is true within the threshold", () => {
    expect(isNearBottom({ scrollTop: 500, scrollHeight: 1000, clientHeight: 400 })).toBe(true);
  });

  it("is false when scrolled up into history", () => {
    expect(isNearBottom({ scrollTop: 100, scrollHeight: 1000, clientHeight: 400 })).toBe(false);
  });

  it("is true when the thread doesn't overflow", () => {
    expect(isNearBottom({ scrollTop: 0, scrollHeight: 300, clientHeight: 400 })).toBe(true);
  });
});

describe("shouldStick", () => {
  it("leaves a reader scrolled up alone when an agent replies", () => {
    expect(shouldStick({ fresh: false, sentByMe: false, wasNearBottom: false })).toBe(false);
  });

  it("follows new replies when the reader is at the bottom", () => {
    expect(shouldStick({ fresh: false, sentByMe: false, wasNearBottom: true })).toBe(true);
  });

  it("always jumps to the bottom on the user's own send or a fresh thread", () => {
    expect(shouldStick({ fresh: false, sentByMe: true, wasNearBottom: false })).toBe(true);
    expect(shouldStick({ fresh: true, sentByMe: false, wasNearBottom: false })).toBe(true);
  });
});
