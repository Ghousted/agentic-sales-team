import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
import * as schema from "@/lib/db/schema";

// A proxy database: every query is recorded, and `answer` scripts the rows
// (in column order, as the driver returns them) by matching the SQL.
const state = vi.hoisted(() => ({
  queries: [] as { sql: string; params: unknown[] }[],
  answer: (_sql: string): unknown[][] => [],
}));
const db = drizzle(async (sql, params) => {
  state.queries.push({ sql, params });
  return { rows: state.answer(sql) };
}, { schema });

vi.mock("@/lib/db", async (importActual) => ({ ...(await importActual<typeof import("@/lib/db")>()), isDbConfigured: () => true, getDb: () => db }));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => ({ userId: "00000000-0000-4000-8000-00000000000a" }) }));
vi.mock("@/lib/chat/teamMessages", () => ({ postTeamMessage: vi.fn(async () => {}) }));
vi.mock("@/lib/meetings/store", () => ({ bookMeeting: vi.fn(async () => true) }));

const { approveJob, rejectJob } = await import("@/lib/pod/actions");
const { cancelStep, openApproval } = await import("@/lib/pod/decisions");
const { postTeamMessage } = await import("@/lib/chat/teamMessages");
const { bookMeeting } = await import("@/lib/meetings/store");

const JOB = "11111111-1111-4111-8111-111111111111";
const team = (teamId: string, name = "Tess Aquino") => ({ teamId, pod: true, agent: { name } });

beforeEach(() => { state.queries = []; state.answer = () => []; vi.mocked(postTeamMessage).mockClear(); });

describe("rejectJob (Cancel)", () => {
  it("stops the whole run: dismisses the team's other waiting steps, then posts what the run did", async () => {
    state.answer = (sql) => {
      // The cancelled step itself.
      if (/^update "jobs"/.test(sql) && /returning/.test(sql)) return [["a3", "research", team("t1"), "2026-10-23T01:05:00Z"]];
      // Waiting steps: one of this team, one of another team.
      if (/^select "id", "params" from "jobs"/.test(sql)) return [["j-mine", team("t1")], ["j-other", team("t2")]];
      // The user's last message in the thread.
      if (/from "messages"/.test(sql)) return [["2026-10-23T01:00:00Z"]];
      // The run since then, oldest first.
      if (/^select "kind", "status", "result", "params" from "jobs"/.test(sql)) return [
        ["scrape", "done", { leadsFound: 8 }, team("t1", "Lia Navarro")],
        ["assess", "done", { accepted: 5 }, team("t1", "Marco Villanueva")],
        ["scrape", "done", { leadsFound: 3 }, team("t2", "Someone Else")],
        ["research", "dismissed", null, team("t1")],
      ];
      return [];
    };
    const res = await rejectJob(JOB);
    expect(res).toEqual({ ok: true, kind: "research", pod: true });

    const updates = state.queries.filter((q) => /^update "jobs"/.test(q.sql));
    expect(updates).toHaveLength(2);
    // The second update dismisses only this team's waiting step.
    expect(updates[1].params).toContain("dismissed");
    expect(updates[1].params).toContain("j-mine");
    expect(updates[1].params).not.toContain("j-other");

    expect(vi.mocked(postTeamMessage).mock.calls).toEqual([["00000000-0000-4000-8000-00000000000a", "t1", "a3", [
      "Okay, stopping now. Here's a summary of what we did:",
      "• Lia found 8 leads",
      "• Marco accepted 5 leads",
    ].join("\n")]]);
  });

  it("says nothing changed when the run had done nothing yet", async () => {
    state.answer = (sql) => {
      if (/^update "jobs"/.test(sql) && /returning/.test(sql)) return [["a1", "scrape", team("t1"), "2026-10-23T01:05:00Z"]];
      if (/^select "kind", "status", "result", "params" from "jobs"/.test(sql)) return [["scrape", "dismissed", null, team("t1")]];
      return [];
    };
    await rejectJob(JOB);
    expect(vi.mocked(postTeamMessage).mock.calls[0][3]).toBe("Okay, stopping now. We hadn't done anything yet, so nothing changed.");
  });

  it("does nothing for a step that is no longer waiting", async () => {
    expect(await rejectJob(JOB)).toEqual({ ok: true, kind: null, pod: false });
    expect(postTeamMessage).not.toHaveBeenCalled();
  });

  it("reports a failure instead of failing silently", async () => {
    state.answer = () => { throw new Error("db down"); };
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    expect(await rejectJob(JOB)).toEqual({ error: "I couldn't cancel that. Please try again." });
  });
});

describe("approveJob (Proceed)", () => {
  it("queues the step, and a scrape's reply carries its live timeline", async () => {
    state.answer = (sql) => (/^update "jobs"/.test(sql) ? [["a1", "scrape", team("t1")]] : []);
    expect(await approveJob(JOB)).toEqual({ ok: true, kind: "scrape", pod: true });
    expect(state.queries[0].params).toContain("queued");
    expect(vi.mocked(postTeamMessage).mock.calls[0][3]).toBe(`Okay, starting the search now. I will post the results here. ⟦run:${JOB}⟧`);
  });

  it("says a short 'starting now' for other steps", async () => {
    state.answer = (sql) => (/^update "jobs"/.test(sql) ? [["a2", "research", { teamId: "t1" }]] : []);
    expect(await approveJob(JOB)).toEqual({ ok: true, kind: "research", pod: false });
    expect(vi.mocked(postTeamMessage).mock.calls[0][3]).toBe("Okay, starting now.");
  });
});

describe("meeting asks", () => {
  const MEET = {
    teamId: "t1", leadIds: ["l1", "l2"], names: { l1: "Jane Doe", l2: "Ray Cruz" },
    iso: "2026-10-23T18:00:00.000Z", label: "Fri, Oct 23 · 2:00–2:30 PM", type: "Intro call",
  };

  it("Proceed books the meeting on the spot and posts what was booked", async () => {
    let claims = 0;
    state.answer = (sql) => {
      if (!/^update "jobs"/.test(sql) || !/returning/.test(sql)) return [];
      // The first claim (queue a runner step) skips meeting asks; the second claims the meeting.
      return claims++ === 0 ? [] : [["mtg", MEET]];
    };
    vi.mocked(bookMeeting).mockReset().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await approveJob(JOB)).toEqual({ ok: true, kind: null, pod: false });
    expect(bookMeeting).toHaveBeenCalledTimes(2);
    expect(vi.mocked(bookMeeting).mock.calls[0]).toEqual(["00000000-0000-4000-8000-00000000000a", "mtg", "l1", MEET.iso, MEET.label, "Intro call"]);
    expect(vi.mocked(postTeamMessage).mock.calls[0][3]).toBe(
      "Booked a Intro call with Jane Doe on Fri, Oct 23 · 2:00–2:30 PM. It is on your calendar. I could not book Ray Cruz. I did not find them in your leads.");
    // The job ends done with the count, so it isn't picked up again.
    const done = state.queries.find((q) => /^update "jobs"/.test(q.sql) && q.params.includes("done"));
    expect(done?.params).toContainEqual(JSON.stringify({ booked: 1 }));
  });

  it("a second Proceed books nothing (the ask is no longer waiting)", async () => {
    vi.mocked(bookMeeting).mockClear();
    expect(await approveJob(JOB)).toEqual({ ok: true, kind: null, pod: false });
    expect(bookMeeting).not.toHaveBeenCalled();
    expect(postTeamMessage).not.toHaveBeenCalled();
  });

  it("Cancel says it won't book, with no run summary", async () => {
    state.answer = (sql) => (/^update "jobs"/.test(sql) && /returning/.test(sql) ? [["mtg", "book-meeting", { ...MEET }, "2026-10-23T01:05:00Z"]] : []);
    expect(await rejectJob(JOB)).toEqual({ ok: true, kind: "book-meeting", pod: false });
    expect(vi.mocked(postTeamMessage).mock.calls).toEqual([["00000000-0000-4000-8000-00000000000a", "t1", "mtg", "Okay, I won't book it."]]);
    expect(state.queries.some((q) => /from "messages"/.test(q.sql))).toBe(false);
  });
});

describe("typed answers", () => {
  it("a typed 'no' sums up the run from before that message", async () => {
    state.answer = (sql) => (/^update "jobs"/.test(sql) && /returning/.test(sql) ? [["a3", "research", team("t1"), "2026-10-23T01:05:00Z"]] : []);
    await cancelStep("00000000-0000-4000-8000-00000000000a", JOB, 42);
    const q = state.queries.find((x) => /from "messages"/.test(x.sql));
    expect(q?.sql).toMatch(/"messages"\."id" < \$\d/);
    expect(q?.params).toContain(42);
  });

  it("openApproval picks the newest ask that is still waiting", async () => {
    state.answer = (sql) => (/^select "id" from "jobs"/.test(sql) ? [["j1"], ["j3"]] : []);
    expect(await openApproval("00000000-0000-4000-8000-00000000000a", ["j3", "j2", "j1"])).toBe("j3");
    state.answer = (sql) => (/^select "id" from "jobs"/.test(sql) ? [["j1"]] : []);
    expect(await openApproval("00000000-0000-4000-8000-00000000000a", ["j3", "j2", "j1"])).toBe("j1");
    state.answer = () => [];
    expect(await openApproval("00000000-0000-4000-8000-00000000000a", ["j3"])).toBeNull();
  });

  it("openApproval asks nothing when no ask is open", async () => {
    expect(await openApproval("00000000-0000-4000-8000-00000000000a", [])).toBeNull();
    expect(state.queries).toHaveLength(0);
  });
});
