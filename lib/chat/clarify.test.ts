import { describe, expect, it } from "vitest";
import {
  askMeetingWhoText,
  askScrapeText,
  askWhatTimeText,
  askWhenText,
  isAskMeetingWhoPrompt,
  isAskScrapePrompt,
  pendingMeeting,
  scrapeHasTarget,
} from "./clarify";

describe("scrapeHasTarget", () => {
  it.each(["find leads", "@Scout find me some leads please", "scrape linkedin", "Get prospects on Facebook!", "", "   "])(
    "is false for a bare command: %j",
    (msg) => expect(scrapeHasTarget(msg)).toBe(false),
  );

  it.each(["find dentists", "@Scout find leads in Texas", "scrape linkedin for CTOs", "get SaaS founders", "find leads in NY"])(
    "is true when a target is named: %j",
    (msg) => expect(scrapeHasTarget(msg)).toBe(true),
  );

  it("ignores the @mention even when it is the only extra word", () => {
    expect(scrapeHasTarget("@Dentist-Bot find leads")).toBe(false);
  });

  it.each(["find leads in the US", "find leads in the U.S.", "@Scout scrape USA"])("treats the country as a target: %j", (msg) =>
    expect(scrapeHasTarget(msg)).toBe(true),
  );

  it('still treats the pronoun "us" as filler', () => {
    expect(scrapeHasTarget("find us some leads")).toBe(false);
  });

  it.each(["find me 50 leads", "get 20 prospects"])("treats a count alone as a bare command: %j", (msg) =>
    expect(scrapeHasTarget(msg)).toBe(false),
  );
});

describe("scrape prompt", () => {
  it("recognises only its own exact text", () => {
    expect(isAskScrapePrompt(askScrapeText())).toBe(true);
    expect(isAskScrapePrompt(askScrapeText() + " ")).toBe(false);
    expect(isAskScrapePrompt(askMeetingWhoText())).toBe(false);
  });
});

describe("meeting who prompt", () => {
  it("recognises only its own exact text", () => {
    expect(isAskMeetingWhoPrompt(askMeetingWhoText())).toBe(true);
    expect(isAskMeetingWhoPrompt(askScrapeText())).toBe(false);
  });
});

describe("pendingMeeting", () => {
  it("round-trips the when prompt's lead ids with no date", () => {
    expect(pendingMeeting(askWhenText("Ana and Bo", ["l1", "l2"]))).toEqual({ leadIds: ["l1", "l2"], date: undefined });
  });

  it("round-trips the what-time prompt's lead ids and date", () => {
    expect(pendingMeeting(askWhatTimeText("Ana", "Friday", ["l1"], "2026-10-23"))).toEqual({ leadIds: ["l1"], date: "2026-10-23" });
  });

  it("trims ids and drops empty ones", () => {
    expect(pendingMeeting("x ⟦meet: a , ,b ⟧")).toEqual({ leadIds: ["a", "b"], date: undefined });
  });

  it("is null with no marker or no ids", () => {
    expect(pendingMeeting("When should I set the meeting?")).toBeNull();
    expect(pendingMeeting("⟦meet:⟧")).toBeNull();
    expect(pendingMeeting("⟦meet: , |2026-10-23⟧")).toBeNull();
  });
});
