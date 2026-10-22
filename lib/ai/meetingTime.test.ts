import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ai = vi.hoisted(() => ({ aiJSON: vi.fn(), configured: true }));
vi.mock("./openrouter", () => ({ isAIConfigured: () => ai.configured, aiJSON: ai.aiJSON }));

import { parseMeetingTime, parseMeetingPhrase, safeTimeZone, inBookingWindow, meetingLabel } from "./meetingTime";

const W = { windowStart: 9, windowEnd: 17, weekdaysOnly: true, duration: 30 };
const answer = (iso: string, hasTime = true) => ai.aiJSON.mockResolvedValueOnce({ iso, label: "model label", hasTime });
const prompt = () => ai.aiJSON.mock.calls[0][0] as string;

beforeEach(() => {
  ai.aiJSON.mockReset();
  ai.configured = true;
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-22T12:00:00Z")); // Thu 8:00 AM in New York
});
afterEach(() => vi.useRealTimers());

describe("parseMeetingTime", () => {
  it("tells the model the user's timezone and local time, not the server's", async () => {
    answer("2026-10-23T14:00:00-04:00");
    await parseMeetingTime("tomorrow 2pm", { ...W, timeZone: "America/New_York" });
    expect(prompt()).toContain("America/New_York");
    expect(prompt()).toContain("Thursday, October 22, 2026 at 8:00 AM GMT-04:00");
  });

  it("lists the coming days with their weekday and UTC offset, across a DST change", async () => {
    answer("2026-10-23T14:00:00-04:00");
    await parseMeetingTime("tomorrow 2pm", { ...W, timeZone: "America/New_York" });
    expect(prompt()).toContain("Fri 2026-10-23 (UTC-04:00)");
    expect(prompt()).toContain("Mon 2026-11-02 (UTC-05:00)");
  });

  it("returns UTC iso and builds the label in the user's timezone", async () => {
    answer("2026-10-23T14:00:00-04:00");
    const r = await parseMeetingTime("tomorrow 2pm", { ...W, timeZone: "America/New_York" });
    expect(r).toEqual({ iso: "2026-10-23T18:00:00.000Z", label: "Fri, Oct 23 · 2:00–2:30 PM", hasTime: true });
  });

  it("rejects a time outside the booking window in the user's timezone", async () => {
    answer("2026-10-23T20:00:00-04:00"); // 8 PM in New York
    const r = await parseMeetingTime("tomorrow 8pm", { ...W, timeZone: "America/New_York" });
    expect(r.iso).toBe("");
  });

  it("rejects a time that has already passed", async () => {
    answer("2026-10-21T14:00:00-04:00");
    const r = await parseMeetingTime("yesterday 2pm", { ...W, timeZone: "America/New_York" });
    expect(r.iso).toBe("");
  });

  it("falls back to UTC for a timezone it doesn't know", async () => {
    answer("2026-10-23T14:00:00Z");
    const r = await parseMeetingTime("tomorrow 2pm", { ...W, timeZone: "Not/AZone" });
    expect(prompt()).toContain("The user's timezone is UTC.");
    expect(r.label).toBe("Fri, Oct 23 · 2:00–2:30 PM");
  });
});

describe("parseMeetingTime without AI", () => {
  const NY = { ...W, timeZone: "America/New_York" };
  beforeEach(() => { ai.configured = false; });
  afterEach(() => expect(ai.aiJSON).not.toHaveBeenCalled());

  it.each([
    ["tomorrow 2pm", "2026-10-23T18:00:00.000Z", "Fri, Oct 23 · 2:00–2:30 PM"],
    ["2pm", "2026-10-22T18:00:00.000Z", "Thu, Oct 22 · 2:00–2:30 PM"],
    ["friday at 3", "2026-10-23T19:00:00.000Z", "Fri, Oct 23 · 3:00–3:30 PM"],
    ["next Tuesday 10:30am", "2026-10-27T14:30:00.000Z", "Tue, Oct 27 · 10:30–11:00 AM"],
    ["2026-10-23 noon", "2026-10-23T16:00:00.000Z", "Fri, Oct 23 · 12:00–12:30 PM"],
    ["Nov 2 at 10am", "2026-11-02T15:00:00.000Z", "Mon, Nov 2 · 10:00–10:30 AM"], // after DST ends: UTC-5
    ["23 October 14:00", "2026-10-23T18:00:00.000Z", "Fri, Oct 23 · 2:00–2:30 PM"],
    ["10/26 9am", "2026-10-26T13:00:00.000Z", "Mon, Oct 26 · 9:00–9:30 AM"],
  ])("books %j", async (phrase, iso, label) => {
    expect(await parseMeetingTime(phrase, NY)).toEqual({ iso, label, hasTime: true });
  });

  it("reads a day with no clock time as that day at the window start, and asks the time", async () => {
    const r = await parseMeetingTime("monday", NY);
    expect(r).toMatchObject({ iso: "2026-10-26T13:00:00.000Z", hasTime: false });
  });

  it("moves a bare time that has passed today to the next weekday", async () => {
    vi.setSystemTime(new Date("2026-10-23T20:00:00Z")); // Fri 4:00 PM in New York
    expect((await parseMeetingTime("10am", NY)).iso).toBe("2026-10-26T14:00:00.000Z");
  });

  it("still enforces the window, the weekdays and the past", async () => {
    expect((await parseMeetingTime("saturday 10am", NY)).iso).toBe("");
    expect((await parseMeetingTime("tomorrow 8pm", NY)).iso).toBe("");
    expect((await parseMeetingTime("today 7am", NY)).iso).toBe("");
    expect((await parseMeetingTime("2026-10-20", NY)).iso).toBe("");
  });

  it("returns no time for a phrase with no day or time in it", async () => {
    expect((await parseMeetingTime("whenever works for them", NY)).iso).toBe("");
  });
});

describe("parseMeetingTime when the AI call fails", () => {
  it("falls back to the built-in parser", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    ai.aiJSON.mockRejectedValueOnce(new Error("OpenRouter 502"));
    const r = await parseMeetingTime("tomorrow 2pm", { ...W, timeZone: "America/New_York" });
    expect(ai.aiJSON).toHaveBeenCalledOnce();
    expect(r).toEqual({ iso: "2026-10-23T18:00:00.000Z", label: "Fri, Oct 23 · 2:00–2:30 PM", hasTime: true });
  });
});

describe("parseMeetingPhrase", () => {
  const now = new Date("2026-10-22T12:00:00Z");
  it("doesn't mistake words like 'monthly' or 'market' for a day", () => {
    expect(parseMeetingPhrase("a monthly market review call", now, "UTC")).toBeNull();
  });
  it("rolls a passed month/day into next year", () => {
    expect(parseMeetingPhrase("jan 5", now, "UTC")).toEqual({ date: "2027-01-05", minutes: null });
  });
});

describe("inBookingWindow", () => {
  it("judges the weekday in the user's timezone", () => {
    // Mon 10 AM in Tokyo is still Sunday in UTC.
    expect(inBookingWindow("2026-10-26T01:00:00Z", "Asia/Tokyo", true, W)).toBe(true);
    expect(inBookingWindow("2026-10-26T01:00:00Z", "UTC", true, W)).toBe(false);
  });

  it("needs the whole meeting to end by the window end", () => {
    expect(inBookingWindow("2026-10-23T16:30:00Z", "UTC", true, W)).toBe(true);
    expect(inBookingWindow("2026-10-23T16:45:00Z", "UTC", true, W)).toBe(false);
    expect(inBookingWindow("2026-10-23T08:59:00Z", "UTC", true, W)).toBe(false);
  });

  it("checks only the day when no clock time was given", () => {
    expect(inBookingWindow("2026-10-23T03:00:00Z", "UTC", false, W)).toBe(true);
    expect(inBookingWindow("2026-10-24T09:00:00Z", "UTC", false, W)).toBe(false);
  });
});

describe("meetingLabel", () => {
  it("shows AM/PM once when start and end share it, both when they don't", () => {
    expect(meetingLabel("2026-10-23T14:00:00Z", "UTC", 30)).toBe("Fri, Oct 23 · 2:00–2:30 PM");
    expect(meetingLabel("2026-10-23T11:45:00Z", "UTC", 30)).toBe("Fri, Oct 23 · 11:45 AM–12:15 PM");
  });
});

describe("safeTimeZone", () => {
  it("keeps a real IANA zone and drops anything else", () => {
    expect(safeTimeZone("Asia/Manila")).toBe("Asia/Manila");
    expect(safeTimeZone("bogus")).toBe("UTC");
    expect(safeTimeZone(undefined)).toBe("UTC");
  });
});
