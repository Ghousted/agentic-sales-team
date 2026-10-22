import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ai = vi.hoisted(() => ({ aiJSON: vi.fn() }));
vi.mock("./openrouter", () => ({ isAIConfigured: () => true, aiJSON: ai.aiJSON }));

import { parseMeetingTime, safeTimeZone, inBookingWindow, meetingLabel } from "./meetingTime";

const W = { windowStart: 9, windowEnd: 17, weekdaysOnly: true, duration: 30 };
const answer = (iso: string, hasTime = true) => ai.aiJSON.mockResolvedValueOnce({ iso, label: "model label", hasTime });
const prompt = () => ai.aiJSON.mock.calls[0][0] as string;

beforeEach(() => {
  ai.aiJSON.mockReset();
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
