import { describe, expect, it } from "vitest";
import { buildCalendarFromMeetings } from "@/lib/calendar";

// Wednesday 21 Oct 2026, 10:00 local. Its week runs Mon 19 – Sun 25 Oct.
const now = new Date(2026, 9, 21, 10, 0);
const meeting = (leadName: string, d: Date) => ({ agentId: "a1", leadName, whenAt: d.toISOString(), whenLabel: "" });

// Every meeting is Tuesday 11 AM, in a different week.
const meetings = [
  meeting("Last week", new Date(2026, 9, 13, 11, 0)),
  meeting("This week", new Date(2026, 9, 20, 11, 0)),
  meeting("Next week", new Date(2026, 9, 27, 11, 0)),
];

const shownTitles = (weekOffset: number) =>
  buildCalendarFromMeetings(meetings, [], { now, weekOffset })
    .weekRows.flatMap((r) => r.cells.flat())
    .map((e) => e.title);

describe("calendar week view", () => {
  it("only shows meetings inside the selected Mon–Sun week", () => {
    expect(shownTitles(0)).toEqual(["This week"]);
    expect(shownTitles(-1)).toEqual(["Last week"]);
    expect(shownTitles(1)).toEqual(["Next week"]);
    expect(shownTitles(5)).toEqual([]);
  });

  it("includes Sunday night and excludes the next Monday", () => {
    const edge = [
      meeting("Sun", new Date(2026, 9, 25, 17, 30)),
      meeting("Mon after", new Date(2026, 9, 26, 8, 0)),
    ];
    const titles = buildCalendarFromMeetings(edge, [], { now, weekOffset: 0 })
      .weekRows.flatMap((r) => r.cells.flat()).map((e) => e.title);
    expect(titles).toEqual(["Sun"]);
  });

  it("labels the week by its dates, not a fixed list that sticks past ±2 weeks", () => {
    const label = (weekOffset: number) => buildCalendarFromMeetings([], [], { now, weekOffset }).weekLabel;
    expect(label(0)).toBe("Oct 19 – 25");
    expect(label(1)).toBe("Oct 26 – Nov 1");
    expect(label(-2)).toBe("Oct 5 – 11");
    expect(label(3)).toBe("Nov 9 – 15");
    expect(label(10)).toBe("Dec 28, 2026 – Jan 3, 2027");
    expect(label(-43)).toBe("Dec 22 – 28, 2025");
  });

  it("gives the day numbers of the shown week", () => {
    expect(buildCalendarFromMeetings([], [], { now, weekOffset: 1 }).dayNums).toEqual(["26", "27", "28", "29", "30", "31", "1"]);
  });

  it("computes no dates without a client clock (server render)", () => {
    const cal = buildCalendarFromMeetings(meetings, []);
    expect(cal.weekLabel).toBe("");
    expect(cal.dayNums.every((d) => d === "")).toBe(true);
    expect(cal.weekRows.flatMap((r) => r.cells.flat())).toEqual([]);
    expect(cal.summary.find((s) => s.label === "Meetings")?.value).toBe("3");
  });
});
