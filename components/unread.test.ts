import { describe, expect, it } from "vitest";
import { badgeText, syncSeen, unreadCounts } from "./unread";

describe("syncSeen", () => {
  it("marks a conversation seen for the first time as read up to now", () => {
    expect(syncSeen({}, { a: { lastId: 40, unread: 0 } }, [])).toEqual({ a: 40 });
  });

  it("marks the open conversation and the one just left as read", () => {
    const heads = { a: { lastId: 50, unread: 2 }, b: { lastId: 60, unread: 1 }, c: { lastId: 70, unread: 3 } };
    expect(syncSeen({ a: 40, b: 55, c: 65 }, heads, ["a", "b"])).toEqual({ a: 50, b: 60, c: 65 });
  });

  it("keeps a cleared conversation's seen id, so new messages after the clear count", () => {
    // Clear deletes rows; new rows get higher ids than the old seen id.
    expect(syncSeen({ a: 90 }, { a: { lastId: 95, unread: 1 } }, [])).toEqual({ a: 90 });
  });
});

describe("unreadCounts", () => {
  it("uses the server counts but shows 0 for the conversations being read", () => {
    const heads = { a: { lastId: 50, unread: 2 }, b: { lastId: 60, unread: 4 } };
    expect(unreadCounts(heads, ["a", null])).toEqual({ a: 0, b: 4 });
  });
});

describe("badgeText", () => {
  it("caps large counts", () => {
    expect(badgeText(3)).toBe("3");
    expect(badgeText(150)).toBe("99+");
  });
});
