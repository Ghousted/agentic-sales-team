import { describe, expect, it } from "vitest";
import {
  briefFromInstruction,
  briefOptions,
  isMoreRequest,
  askedBriefFields,
  scrapeAnswerFrom,
  scrapeAnswerText,
  askScrapeDetailsText,
  briefInstruction,
  mergeBrief,
  missingBriefFields,
  pendingScrapeBrief,
  settleBrief,
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

describe("scrape brief", () => {
  it("lists the fields still missing", () => {
    expect(missingBriefFields({})).toEqual(["what", "where", "count"]);
    expect(missingBriefFields({ what: "dentists", where: "Texas" })).toEqual(["count"]);
    expect(missingBriefFields({ what: "dentists", where: "anywhere", count: 5 })).toEqual([]);
  });

  it("asks only for the missing fields, and round-trips the brief in a hidden marker", () => {
    const text = askScrapeDetailsText({ what: "businesses that need AI training" }, ["where", "count"], 25);
    expect(text).toMatch(/^Before I start, I need a few details\.\n1\. Where\?.*\n2\. How many leads do you want\? Up to 25\./);
    expect(text).not.toMatch(/Who should I look for/);
    expect(pendingScrapeBrief(text)).toEqual({ what: "businesses that need AI training", where: undefined, count: undefined, asked: 1 });
  });

  it("numbers no question when only one is asked", () => {
    expect(askScrapeDetailsText({ what: "dentists", where: "Texas" }, ["count"], 25)).toMatch(/^Before I start, I need one detail\.\nHow many leads/);
    expect(askScrapeDetailsText({ what: "dentists", where: "Texas", asked: 1 }, ["count"], 25)).toMatch(/one more detail\./);
  });

  it("returns null for a missing or broken marker", () => {
    expect(pendingScrapeBrief("hello")).toBeNull();
    expect(pendingScrapeBrief("x ⟦scrape:%E0%A4%A⟧")).toBeNull();
  });

  it("drops bad values from the marker", () => {
    const m = `⟦scrape:${encodeURIComponent(JSON.stringify({ what: 5, where: "Ohio", count: -3, asked: 1 }))}⟧`;
    expect(pendingScrapeBrief(m)).toEqual({ what: undefined, where: "Ohio", count: undefined, asked: 1 });
  });

  it("merges an answer without erasing known values", () => {
    expect(mergeBrief({ what: "dentists", where: "Texas", asked: 1 }, { where: "", count: 20 })).toEqual({ what: "dentists", where: "Texas", count: 20, asked: 1 });
  });

  it("fills place and count after the last question, but never who to find", () => {
    expect(settleBrief({ what: "dentists", asked: 1 })).toEqual({ what: "dentists", asked: 1 });
    expect(settleBrief({ what: "dentists", asked: 2 })).toEqual({ what: "dentists", where: "anywhere", count: 10, asked: 2 });
    expect(missingBriefFields(settleBrief({ asked: 2 }))).toEqual(["what"]);
  });

  it("tells the card which fields a question asks", () => {
    expect(askedBriefFields(askScrapeDetailsText({ what: "dentists" }, ["where", "count"], 25))).toEqual(["where", "count"]);
    expect(askedBriefFields("I found the new leads.")).toEqual([]);
  });

  it("round-trips the card's answers", () => {
    const text = scrapeAnswerText({ where: "Anywhere", count: "10" });
    expect(text).toMatch(/^Anywhere · 10 leads ⟦answer:/);
    expect(scrapeAnswerFrom(text)).toEqual({ what: undefined, where: "anywhere", count: 10 });
    expect(scrapeAnswerFrom(scrapeAnswerText({ what: "HR managers", where: "Austin, TX", count: "15" }))).toEqual({ what: "HR managers", where: "Austin, TX", count: 15 });
  });

  it("drops bad values from a card answer", () => {
    expect(scrapeAnswerFrom(`x ⟦answer:${encodeURIComponent(JSON.stringify({ where: 7, count: "9", what: " " }))}⟧`)).toEqual({ what: undefined, where: undefined, count: undefined });
    expect(scrapeAnswerFrom("Austin, 15")).toBeNull();
  });

  it("adds the place to the instruction unless it is anywhere", () => {
    expect(briefInstruction({ what: "dentists", where: "Austin, Texas" })).toBe("dentists. Location: Austin, Texas.");
    expect(briefInstruction({ what: "dentists", where: "anywhere" })).toBe("dentists");
  });
});

describe("repeat searches", () => {
  it("reads who and where back from a search instruction", () => {
    expect(briefFromInstruction("find AI training buyers. Location: Metro Manila Philippines.")).toEqual({ what: "find AI training buyers", where: "Metro Manila Philippines" });
    expect(briefFromInstruction("find AI training buyers")).toEqual({ what: "find AI training buyers", where: undefined });
    expect(briefFromInstruction(briefInstruction({ what: "dentists", where: "Austin, TX" }))).toEqual({ what: "dentists", where: "Austin, TX" });
  });

  it.each(["Lets look for more @Nina", "search again", "find more leads", "another batch please", "same search"])("is a more request: %j", (m) =>
    expect(isMoreRequest(m)).toBe(true));
  it.each(["find dentists in Texas", "@Moreno find leads"])("is not a more request: %j", (m) => expect(isMoreRequest(m)).toBe(false));

  it("says it searches again, and carries the flag and suggestions in the marker", () => {
    const text = askScrapeDetailsText({ what: "AI training buyers", where: "Manila", again: true }, ["count"], 25);
    expect(text).toMatch(/^I will search again for AI training buyers, in Manila\. One detail first\.\nHow many leads/);
    expect(pendingScrapeBrief(text)).toMatchObject({ again: true });
  });

  it("offers the last search as the first quick picks", () => {
    const text = askScrapeDetailsText({ suggest: { what: "AI training buyers", where: "Europe" } }, ["what", "where", "count"], 25);
    const o = briefOptions(text);
    expect(o.what).toEqual(["AI training buyers"]);
    expect(o.where).toEqual(["Europe", "Anywhere", "United States", "United Kingdom"]);
    expect(o.count).toEqual(["5", "10", "25"]);
  });
});
