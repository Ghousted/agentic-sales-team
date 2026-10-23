import { describe, expect, it } from "vitest";
import { actionPhrase, askBookText, askText, cancelSummary, startText, waitingText } from "./summary";

describe("waitingText", () => {
  it("says what the agent is waiting to do, per job kind", () => {
    expect(waitingText("proposal", 5)).toBe("I'm waiting for your go-ahead to draft proposals for 5 leads.");
    expect(waitingText("outreach", null)).toBe("I'm waiting for your go-ahead to draft outreach to all accepted leads.");
    expect(waitingText("scrape", 20)).toBe("I'm waiting for your go-ahead to search for 20 leads.");
    expect(waitingText("book-meeting", 1)).toBe("I'm waiting for your go-ahead to book the meeting.");
  });
});

describe("startText and askBookText", () => {
  it("starts a scrape with its live timeline marker, other steps with a short line", () => {
    expect(startText("scrape", "j1")).toBe("Okay, starting the search now. I will post the results here. ⟦run:j1⟧");
    expect(startText("research", "j1")).toBe("Okay, starting now.");
  });

  it("asks before booking, with who, when and the Proceed/Cancel marker", () => {
    expect(askBookText("Intro call", "Jane Doe", "Fri, Oct 23 · 2:00–2:30 PM", "j9")).toBe("I'm ready to book a Intro call with Jane Doe on Fri, Oct 23 · 2:00–2:30 PM. Proceed? ⟦approve:j9⟧");
  });
});

describe("askText", () => {
  it("says what the agent will do and how many leads, with the Proceed/Cancel marker", () => {
    expect(askText("research", 12, "job-1", "Clyde")).toBe("@Clyde, I'm ready to research 12 leads. Proceed? ⟦approve:job-1⟧");
    expect(askText("assess", 1, "job-2")).toBe("I'm ready to review 1 new lead. Proceed? ⟦approve:job-2⟧");
  });

  it("names the target when there is no lead count", () => {
    expect(actionPhrase("outreach", null)).toBe("draft outreach to all accepted leads");
    expect(actionPhrase("match", 3)).toBe("match 3 leads to your catalog");
  });
});

describe("cancelSummary", () => {
  it("lists what each finished step did, oldest first", () => {
    expect(cancelSummary([
      { kind: "scrape", status: "done", result: { leadsFound: 8, leadIds: [] }, agentName: "Bea Santos" },
      { kind: "assess", status: "done", result: { accepted: 5 }, agentName: "Carlo Reyes" },
      { kind: "research", status: "done", result: { briefed: 1 }, agentName: "Tess Aquino" },
      { kind: "qualify", status: "dismissed", result: null, agentName: "Gab Ramos" },
    ])).toBe([
      "Okay, stopping now. Here's a summary of what we did:",
      "• Bea found 8 leads",
      "• Carlo accepted 5 leads",
      "• Tess researched 1 lead",
    ].join("\n"));
  });

  it("names a failed step and a step still running", () => {
    const text = cancelSummary([
      { kind: "scrape", status: "failed", result: null, agentName: "Bea" },
      { kind: "outreach", status: "running", result: null, agentName: "Ivan Torres" },
    ]);
    expect(text).toContain("• Bea's search didn't finish");
    expect(text).toContain("• Ivan was still drafting outreach. That step will finish, but nothing runs after it");
  });

  it("says nothing changed when no step had run", () => {
    expect(cancelSummary([{ kind: "scrape", status: "dismissed", result: null, agentName: "Bea" }]))
      .toBe("Okay, stopping now. We hadn't done anything yet, so nothing changed.");
    expect(cancelSummary([])).toBe("Okay, stopping now. We hadn't done anything yet, so nothing changed.");
  });
});
