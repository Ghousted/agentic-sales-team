import { describe, expect, it } from "vitest";
import { draftCounts, filterDrafts, mailtoUrl, relTime } from "./drafts";
import type { DraftDTO } from "./types";

function draft(over: Partial<DraftDTO>): DraftDTO {
  return {
    id: "d", agentId: "a1", leadId: "l", subject: "Quick question", body: "Hi there", rationale: "",
    status: "draft", createdAt: "2026-10-22T10:00:00Z", sentAt: null, leadName: "Jane Doe",
    leadCompany: "Acme", leadEmail: "jane@acme.com", leadProfileUrl: null, leadPlatform: null, ...over,
  };
}

const drafts = [
  draft({ id: "1" }),
  draft({ id: "2", status: "sent", agentId: "a2", leadName: "Bob Ray", leadCompany: "Globex", leadEmail: "" }),
  draft({ id: "3", agentId: "a2", subject: "Training for your plant", body: "Saw your Ohio site" }),
];
const ids = (ds: DraftDTO[]) => ds.map((d) => d.id);

describe("draftCounts", () => {
  it("counts unsent, sent and total", () => {
    expect(draftCounts(drafts)).toEqual({ unsent: 2, sent: 1, total: 3 });
  });
});

describe("filterDrafts", () => {
  it("filters by status tab", () => {
    expect(ids(filterDrafts(drafts, { status: "unsent" }))).toEqual(["1", "3"]);
    expect(ids(filterDrafts(drafts, { status: "sent" }))).toEqual(["2"]);
    expect(ids(filterDrafts(drafts, { status: "all" }))).toEqual(["1", "2", "3"]);
  });

  it("filters by agent, and an empty agent means every agent", () => {
    expect(ids(filterDrafts(drafts, { status: "all", agentId: "a2" }))).toEqual(["2", "3"]);
    expect(ids(filterDrafts(drafts, { status: "all", agentId: "" }))).toEqual(["1", "2", "3"]);
  });

  it("searches lead, company, subject and body without case", () => {
    expect(ids(filterDrafts(drafts, { status: "all", q: "globex" }))).toEqual(["2"]);
    expect(ids(filterDrafts(drafts, { status: "all", q: "OHIO" }))).toEqual(["3"]);
    expect(ids(filterDrafts(drafts, { status: "all", q: "  " }))).toEqual(["1", "2", "3"]);
  });
});

describe("mailtoUrl", () => {
  it("keeps the recipient literal and encodes subject and body", () => {
    expect(mailtoUrl({ leadEmail: "jane@acme.com", subject: "Hi & hello", body: "Line 1\nLine 2" }))
      .toBe("mailto:jane@acme.com?subject=Hi%20%26%20hello&body=Line%201%0ALine%202");
  });
});

describe("relTime", () => {
  const now = new Date("2026-10-22T12:00:00Z").getTime();
  it("shows minutes, hours and days", () => {
    expect(relTime("2026-10-22T12:00:00Z", now)).toBe("now");
    expect(relTime("2026-10-22T11:45:00Z", now)).toBe("15m");
    expect(relTime("2026-10-22T09:00:00Z", now)).toBe("3h");
    expect(relTime("2026-10-20T12:00:00Z", now)).toBe("2d");
  });
});
