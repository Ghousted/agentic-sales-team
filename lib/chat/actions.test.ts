import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
import * as schema from "@/lib/db/schema";
import { DAILY_CHAT_MESSAGE_QUOTA, MAX_CHAT_MESSAGE_CHARS } from "@/lib/jobs/limits";

// The fake database answers only the "messages sent today" count.
let sentToday = 0;
const db = drizzle(async (sql) => ({ rows: /^select count/.test(sql) ? [[sentToday]] : [] }), { schema });

vi.mock("@/lib/db", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/db")>()),
  isDbConfigured: () => true,
  getDb: () => db,
}));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => ({ userId: "00000000-0000-4000-8000-00000000000a" }) }));
vi.mock("@/lib/teams/membership", () => ({ membersOfTeam: async () => [] }));
vi.mock("@/lib/pod/orchestrate", () => ({ agentInfo: async () => null }));
vi.mock("@/lib/ai/intent", () => ({ detectIntent: vi.fn(async () => ({ capability: "chat", params: {} })) }));
vi.mock("./orchestrate", () => ({ parseMentions: () => [], resolve: async () => ({ messages: [] }) }));
vi.mock("@/lib/jobs/actions", () => ({ enqueueJob: vi.fn() }));
vi.mock("./teamMessages", () => ({
  listTeamMessages: async () => [],
  insertTeamMessages: vi.fn(async (_u: string, _t: string, msgs: { who: string; text: string }[]) => msgs.map((m, i) => ({ id: i + 1, ...m }))),
  postJobOutcome: async () => null,
}));
vi.mock("@/lib/leads/store", () => ({ listTeamLeadsForPicker: async () => [], setLeadReview: async () => {} }));
vi.mock("@/lib/ai/resolveLeads", () => ({ resolveTargetLeads: async () => ({ mode: "none", leadIds: [] }) }));
vi.mock("@/lib/meetings/store", () => ({ bookMeeting: async () => false, meetingSettings: async () => ({}) }));

const { teamChat } = await import("./actions");
const { detectIntent } = await import("@/lib/ai/intent");
const { insertTeamMessages } = await import("./teamMessages");

beforeEach(() => {
  sentToday = 0;
  vi.mocked(detectIntent).mockClear();
  vi.mocked(insertTeamMessages).mockClear();
});

describe("teamChat spend limits", () => {
  it("refuses an over-long message without storing it or calling the model", async () => {
    const res = await teamChat("team-1", "x".repeat(MAX_CHAT_MESSAGE_CHARS + 1));
    expect(res.messages).toEqual([{ who: "system", text: expect.stringMatching(/too long/) }]);
    expect(detectIntent).not.toHaveBeenCalled();
    expect(insertTeamMessages).not.toHaveBeenCalled();
  });

  it("refuses a message once the daily message quota is used", async () => {
    sentToday = DAILY_CHAT_MESSAGE_QUOTA;
    const res = await teamChat("team-1", "hello");
    expect(res.messages).toEqual([{ who: "system", text: expect.stringMatching(/today's limit/) }]);
    expect(detectIntent).not.toHaveBeenCalled();
    expect(insertTeamMessages).not.toHaveBeenCalled();
  });

  it("still answers a message within the limits", async () => {
    sentToday = DAILY_CHAT_MESSAGE_QUOTA - 1;
    await teamChat("team-1", "x".repeat(MAX_CHAT_MESSAGE_CHARS));
    expect(detectIntent).toHaveBeenCalledOnce();
  });
});
