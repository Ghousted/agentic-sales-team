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

const { approveJob, rejectJob } = await import("@/lib/pod/actions");
const { postTeamMessage } = await import("@/lib/chat/teamMessages");

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
