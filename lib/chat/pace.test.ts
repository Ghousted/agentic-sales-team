import { describe, expect, it } from "vitest";
import { MIN_REPLY_MS, NEW_SPEAKER_MS, REPLY_MS, lastAgent, markSent, revealWait, takeSinceSent, thinkPause } from "./pace";

describe("revealWait", () => {
  it("holds the first reply until 2 s after the send", () => {
    expect(revealWait(300)).toBe(MIN_REPLY_MS - 300);
    expect(revealWait(0)).toBe(MIN_REPLY_MS);
  });

  it("still types for 1 s when the server already took 2 s", () => {
    expect(revealWait(2500)).toBe(REPLY_MS);
  });

  it("types for 1 s on rows that answer no fresh send", () => {
    expect(revealWait(null)).toBe(1000);
  });

  it("types for 2 s when a different agent answers a hand-off", () => {
    expect(revealWait(null, true)).toBe(NEW_SPEAKER_MS);
    expect(revealWait(2500, true)).toBe(2000);
  });
});

describe("markSent / takeSinceSent", () => {
  it("returns the time since the send once, then null", () => {
    markSent("team-a", 1000);
    expect(takeSinceSent("team-a", 1400)).toBe(400);
    expect(takeSinceSent("team-a", 1500)).toBeNull();
  });

  it("keeps threads apart", () => {
    markSent("team-b", 0);
    expect(takeSinceSent("team-c", 100)).toBeNull();
    expect(takeSinceSent("team-b", 100)).toBe(100);
  });
});

describe("lastAgent", () => {
  it("skips the user's and system rows", () => {
    expect(lastAgent([{ who: "a1" }, { who: "me" }, { who: "system" }])).toBe("a1");
  });

  it("is null for an empty or agent-less thread", () => {
    expect(lastAgent(undefined)).toBeNull();
    expect(lastAgent([{ who: "me" }])).toBeNull();
  });
});

describe("thinkPause", () => {
  it("waits 1 s before a different agent starts typing", () => {
    expect(thinkPause(null, true)).toBe(1000);
  });

  it("waits 0.4 s before the same agent types again", () => {
    expect(thinkPause(null, false)).toBe(400);
  });

  it("doesn't pause the first reply to a send", () => {
    expect(thinkPause(300, true)).toBe(0);
  });
});
