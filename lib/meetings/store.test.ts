import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
import * as schema from "@/lib/db/schema";

// Every statement the store sends, and the rows the fake database answers with.
const sent: string[] = [];
let answer: (sql: string) => unknown[][] = () => [];

const db = drizzle(async (sql) => {
  sent.push(sql);
  return { rows: answer(sql) };
}, { schema });

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
  answer = () => [];
  sessionUser = null;
});

describe("bookMeeting", () => {
  it("refuses a lead that belongs to another user", async () => {
    // The lead lookup scoped to user A finds nothing.
    const ok = await bookMeeting(USER_A, "agent-1", LEAD_OF_B, "2026-10-22T14:00:00.000Z", "Thu 2pm");
    expect(ok).toBe(false);
    expect(sent.some((s) => /^insert into "meetings"/.test(s))).toBe(false);
  });

  it("books a lead the user owns", async () => {
    answer = (sql) => (/^select/.test(sql) ? [[LEAD_OF_A]] : []);
    const ok = await bookMeeting(USER_A, "agent-1", LEAD_OF_A, "2026-10-22T14:00:00.000Z", "Thu 2pm");
    expect(ok).toBe(true);
    expect(sent.some((s) => /^insert into "meetings"/.test(s))).toBe(true);
  });
});

describe("listMeetings", () => {
  it("joins only the caller's own leads", async () => {
    sessionUser = USER_A;
    await listMeetings();
    const select = sent.find((s) => /from "meetings"/.test(s));
    expect(select).toMatch(/inner join "leads" on \(.*"leads"\."user_id" = \$\d+.*\)/);
  });
});

describe("bookMeetingForLead", () => {
  it("parses the time in the timezone the client sent", async () => {
    sessionUser = USER_A;
    answer = (sql) => (/from "leads"/.test(sql) ? [[LEAD_OF_A, "agent-1"]] : []);
    vi.mocked(parseMeetingTime).mockResolvedValue({ iso: "2026-10-23T18:00:00.000Z", label: "Fri, Oct 23 · 2:00–2:30 PM", hasTime: true });
    const res = await bookMeetingForLead(LEAD_OF_A, "tomorrow 2pm", "America/New_York");
    expect(res).toEqual({ ok: true, label: "Fri, Oct 23 · 2:00–2:30 PM" });
    expect(parseMeetingTime).toHaveBeenCalledWith("tomorrow 2pm", expect.objectContaining({ timeZone: "America/New_York" }));
  });
});
