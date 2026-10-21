import { describe, expect, it } from "vitest";
import { hasUnread, syncRead } from "./unread";
import type { ChatMsg } from "@/lib/types";

const me = (text: string): ChatMsg => ({ who: "me", text });
const agent = (text: string): ChatMsg => ({ who: "sk", text });

describe("hasUnread", () => {
  it("is false once the user has seen the agent's last reply", () => {
    // The old rule (last message not from "me") kept this dot on forever.
    expect(hasUnread([me("hi"), agent("hello")], 2)).toBe(false);
  });

  it("is true when an agent message arrived after the last one seen", () => {
    expect(hasUnread([me("hi"), agent("hello"), agent("found 3 leads")], 2)).toBe(true);
  });

  it("is true when an agent replied and the user wrote after it", () => {
    expect(hasUnread([me("hi"), agent("hello"), me("ok")], 1)).toBe(true);
  });

  it("ignores the user's own new messages", () => {
    expect(hasUnread([agent("hello"), me("thanks")], 1)).toBe(false);
  });

  it("is false for empty or unknown conversations", () => {
    expect(hasUnread(undefined, undefined)).toBe(false);
    expect(hasUnread([], 0)).toBe(false);
    expect(hasUnread([me("a"), agent("b")], undefined)).toBe(false);
  });

  it("treats a cleared conversation (fewer messages than seen) as read", () => {
    expect(hasUnread([agent("new")], 5)).toBe(false);
  });
});

describe("syncRead", () => {
  it("marks the conversation being viewed as read", () => {
    const chats = { a: [me("x"), agent("y"), agent("z")] };
    const next = syncRead({ a: 1 }, chats, "a");
    expect(next.a).toBe(3);
    expect(hasUnread(chats.a, next.a)).toBe(false);
  });

  it("leaves other conversations unread", () => {
    const chats = { a: [agent("y")], b: [me("x"), agent("z")] };
    const next = syncRead({ a: 1, b: 1 }, chats, "a");
    expect(next.b).toBe(1);
    expect(hasUnread(chats.b, next.b)).toBe(true);
  });

  it("seeds unknown conversations as read and resets cleared ones", () => {
    const next = syncRead({ b: 4 }, { a: [agent("y"), agent("z")], b: [] }, null);
    expect(next).toEqual({ a: 2, b: 0 });
    expect(hasUnread([agent("after clear")], next.b)).toBe(true);
  });
});
