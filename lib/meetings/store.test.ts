import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
import * as schema from "@/lib/db/schema";
import { withBatch } from "../../test/fake-batch";

// Every statement the store sends, and the rows the fake database answers with.
const sent: string[] = [];
let answer: (sql: string) => unknown[][] = () => [];

const batches: number[] = [];
const db = withBatch(drizzle(async (sql) => {
  sent.push(sql);
  return { rows: answer(sql) };
}, { schema }), batches);

let sessionUser: string | null = null;

vi.mock("@/lib/db", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/db")>()),
  isDbConfigured: () => true,
  getDb: () => db,
}));
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => (sessionUser ? { userId: sessionUser } : null),
}));
vi.mock("@/lib/ai/meetingTime", () => ({ parseMeetingTime: vi.fn() }));

const { bookMeeting, bookMeetingForLead, listMeetings } = await import("./store");
const { parseMeetingTime } = await import("@/lib/ai/meetingTime");

const USER_A = "00000000-0000-4000-8000-00000000000a";
const LEAD_OF_B = "00000000-0000-4000-8000-0000000000b1";
const LEAD_OF_A = "00000000-0000-4000-8000-0000000000a1";

beforeEach(() => {
  sent.length = 0;
  batches.length = 0;
  answer = () => [];
  sessionUser = null;
});

describe("bookMeeting", () => {
  it("refuses a lead that belongs to another user", async () => {
    // The insert selects from user A's leads, finds nothing, and returns no row.
    const ok = await bookMeeting(USER_A, "agent-1", LEAD_OF_B, "2026-10-22T14:00:00.000Z", "Thu 2pm");
    expect(ok).toBe(false);
  });

  it("books a lead the user owns", async () => {
    answer = (sql) => (/^insert into "meetings"/.test(sql) ? [["meeting-1"]] : []);
    const ok = await bookMeeting(USER_A, "agent-1", LEAD_OF_A, "2026-10-22T14:00:00.000Z", "Thu 2pm");
    expect(ok).toBe(true);
  });

  it("books and advances the lead in one batch, scoped to the user's own lead", async () => {
    await bookMeeting(USER_A, "agent-1", LEAD_OF_A, "2026-10-22T14:00:00.000Z", "Thu 2pm");
    expect(batches).toEqual([2]);
    expect(sent[0]).toMatch(/^insert into "meetings" \(.*\) select .* from "leads" where \("leads"\."id" = \$\d+ and "leads"\."user_id" = \$\d+\)/);
    expect(sent[1]).toMatch(/^update "leads" .* where \("leads"\."id" = \$\d+ and "leads"\."user_id" = \$\d+\)/);
  });
});

describe("listMeetings", () => {
  it("joins only the caller's own leads", async () => {
    sessionUser = USER_A;
    await listMeetings();
    const select = sent.find((s) => /from "meetings"/.test(s));
    expect(select).toMatch(/inner join "leads" on \(.*"leads"\."user_id" = \$\d+.*\)/);
  });

  it("without an agentId, lists the whole workspace", async () => {
    sessionUser = USER_A;
    await listMeetings();
    const select = sent.find((s) => /from "meetings"/.test(s));
    expect(select).toMatch(/where \(?"meetings"\."user_id" = \$\d+\)? order by/);
    expect(select).not.toMatch(/"meetings"\."agent_id" =/);
  });

  it("with an agentId, filters by agent inside the workspace", async () => {
    sessionUser = USER_A;
    await listMeetings("agent-1");
    const select = sent.find((s) => /from "meetings"/.test(s));
    expect(select).toMatch(/where \("meetings"\."user_id" = \$\d+ and "meetings"\."agent_id" = \$\d+\)/);
  });

  it("returns nothing, without querying, for a malformed agentId", async () => {
    sessionUser = USER_A;
    for (const bad of ["", 42, null, { id: "agent-1" }, "x".repeat(101)]) {
      expect(await listMeetings(bad)).toEqual([]);
    }
    expect(sent).toEqual([]);
  });
});

describe("bookMeetingForLead", () => {
  it("parses the time in the timezone the client sent", async () => {
    sessionUser = USER_A;
    answer = (sql) => (/^insert into "meetings"/.test(sql) ? [["meeting-1"]] : /from "leads"/.test(sql) ? [[LEAD_OF_A, "agent-1"]] : []);
    vi.mocked(parseMeetingTime).mockResolvedValue({ iso: "2026-10-23T18:00:00.000Z", label: "Fri, Oct 23 · 2:00–2:30 PM", hasTime: true });
    const res = await bookMeetingForLead(LEAD_OF_A, "tomorrow 2pm", "America/New_York");
    expect(res).toEqual({ ok: true, label: "Fri, Oct 23 · 2:00–2:30 PM" });
    expect(parseMeetingTime).toHaveBeenCalledWith("tomorrow 2pm", expect.objectContaining({ timeZone: "America/New_York" }));
  });
});
