import { describe, expect, it } from "vitest";
import { jobOutcomeText, mergeThread, sinceLastUserMessage, stripMarkers, threadCursor, type ThreadMsg } from "./thread";

describe("mergeThread", () => {
  it("keeps stored rows in id order however they arrive", () => {
    const cur: ThreadMsg[] = [{ id: 1, who: "me", text: "find leads" }, { id: 3, who: "a", text: "On it." }];
    // Narration (id 2) was written between the user's message and the reply.
    const out = mergeThread(cur, [{ id: 2, who: "b", text: "Over to you." }, { id: 4, who: "a", text: "Found 3." }]);
    expect(out.map((m) => m.id)).toEqual([1, 2, 3, 4]);
  });

  it("never doubles a row fetched twice", () => {
    const cur: ThreadMsg[] = [{ id: 5, who: "a", text: "I found 3 leads." }];
    expect(mergeThread(cur, [{ id: 5, who: "a", text: "I found 3 leads." }])).toHaveLength(1);
  });

  it("replaces the optimistic copy of a send with the stored row", () => {
    const cur: ThreadMsg[] = [{ id: 1, who: "a", text: "Hi" }, { who: "me", text: "hello", local: true }];
    expect(mergeThread(cur, [{ id: 2, who: "me", text: "hello" }])).toEqual([{ id: 1, who: "a", text: "Hi" }, { id: 2, who: "me", text: "hello" }]);
  });

  it("keeps local notices after the stored rows and still takes new rows", () => {
    // The old count-based poll froze here: a local row the server never got made
    // the local count run ahead of the DB, so new rows never showed.
    const cur: ThreadMsg[] = [{ id: 1, who: "me", text: "hi" }, { who: "system", text: "I'm sorry. …", local: true }];
    const out = mergeThread(cur, [{ id: 2, who: "a", text: "Hello!" }]);
    expect(out.map((m) => m.text)).toEqual(["hi", "Hello!", "I'm sorry. …"]);
  });
});

describe("threadCursor", () => {
  it("is the highest stored id, ignoring local rows", () => {
    expect(threadCursor([{ id: 4, who: "me", text: "" }, { id: 9, who: "a", text: "" }, { who: "me", text: "", local: true } as ThreadMsg])).toBe(9);
    expect(threadCursor(undefined)).toBe(0);
  });
});

describe("sinceLastUserMessage", () => {
  it("returns the rows after the user's last message, newest first", () => {
    const h = [{ who: "a", text: "1" }, { who: "me", text: "2" }, { who: "b", text: "3" }, { who: "c", text: "4" }];
    expect(sinceLastUserMessage(h).map((m) => m.text)).toEqual(["4", "3"]);
    expect(sinceLastUserMessage([{ who: "me", text: "x" }])).toEqual([]);
  });
});

describe("stripMarkers", () => {
  it("removes every hidden marker", () => {
    expect(stripMarkers("Ready. ⟦approve:abc⟧ ⟦job:j1⟧")).toBe("Ready.");
  });
});

describe("jobOutcomeText", () => {
  it("leaves a finished pod scrape to the chain's narration", () => {
    expect(jobOutcomeText("scrape", "done", { leadsFound: 3 }, true)).toBeNull();
  });
  it("reports a failed scrape and a finished outreach run", () => {
    expect(jobOutcomeText("scrape", "failed", null, true)).toBe("That search didn't complete. Please try again.");
    expect(jobOutcomeText("outreach", "done", { draftsCreated: 1 }, false)).toBe("I've drafted 1 email, ready for you to review and send.");
  });
  it("says nothing while the job is still going", () => {
    expect(jobOutcomeText("research", "running", null, false)).toBeNull();
  });
});
