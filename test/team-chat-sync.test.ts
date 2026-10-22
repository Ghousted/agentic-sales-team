import { beforeEach, describe, expect, it, vi } from "vitest";

// teamChat with its collaborators stubbed: the stored thread is `db.rows`, and
// insertTeamMessages appends to it with fresh ids, like the messages table.
const db = vi.hoisted(() => ({ rows: [] as { id: number; who: string; text: string }[], inserts: [] as { who: string; text: string }[][] }));

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn(async () => ({ userId: "u1" })) }));
vi.mock("@/lib/teams/membership", () => ({ membersOfTeam: vi.fn(async () => ["out", "asr"]) }));
vi.mock("@/lib/pod/orchestrate", () => {
  const roster: Record<string, unknown> = {
    out: { id: "out", name: "Ollie", role: "", goal: "", task: "", capabilities: ["outreach"] },
    asr: { id: "asr", name: "Ada", role: "", goal: "", task: "", capabilities: ["assess"] },
  };
  return { agentInfo: vi.fn(async (_u: string, id: string) => roster[id] ?? null) };
});
vi.mock("@/lib/ai/intent", () => ({ detectIntent: vi.fn(async () => ({ capability: "chat", params: {} })) }));
vi.mock("@/lib/chat/orchestrate", () => ({
  parseMentions: vi.fn(() => []),
  resolve: vi.fn(async () => ({ messages: [{ who: "asr", text: "Happy to help." }] })),
}));
vi.mock("@/lib/jobs/actions", () => ({ enqueueJob: vi.fn(async () => ({ jobId: "j1" })) }));
vi.mock("@/lib/leads/store", () => ({
  listTeamLeadsForPicker: vi.fn(async () => [{ id: "l1", name: "Jane Doe", review: "accepted" }]),
  setLeadReview: vi.fn(async () => {}),
}));
vi.mock("@/lib/ai/resolveLeads", () => ({ resolveTargetLeads: vi.fn(async () => ({ mode: "some", leadIds: ["l1"] })) }));
vi.mock("@/lib/ai/meetingTime", () => ({ parseMeetingTime: vi.fn() }));
vi.mock("@/lib/meetings/store", () => ({ bookMeeting: vi.fn(), meetingSettings: vi.fn() }));
vi.mock("@/lib/chat/teamMessages", () => ({
  listTeamMessages: vi.fn(async () => db.rows.map((r) => ({ ...r }))),
  insertTeamMessages: vi.fn(async (_u: string, _t: string, msgs: { who: string; text: string }[]) => {
    db.inserts.push(msgs);
    const out = msgs.map((m) => ({ id: (db.rows.at(-1)?.id ?? 0) + 1, ...m }));
    out.forEach((r, i) => { r.id += i; });
    db.rows.push(...out);
    return out;
  }),
  postJobOutcome: vi.fn(),
}));

import { teamChat } from "@/lib/chat/actions";
import { enqueueJob } from "@/lib/jobs/actions";
import { resolve } from "@/lib/chat/orchestrate";
import { askWhoText } from "@/lib/chat/outreachTarget";

beforeEach(() => { db.rows = []; db.inserts = []; vi.clearAllMocks(); });

describe("teamChat", () => {
  it("stores the user's message and then the agents' replies on the server", async () => {
    const res = await teamChat("t1", "hello team");
    expect(db.inserts).toEqual([[{ who: "me", text: "hello team" }], [{ who: "asr", text: "Happy to help." }]]);
    expect(db.rows.map((r) => r.who)).toEqual(["me", "asr"]);
    // The client gets the stored rows back, ids included.
    expect(res.messages).toEqual([{ id: 2, who: "asr", text: "Happy to help." }]);
  });

  it("keeps Outreach's open 'who?' when pod narration lands after it", async () => {
    db.rows = [
      { id: 1, who: "me", text: "write to my leads" },
      { id: 2, who: "out", text: askWhoText("Ollie") },
      { id: 3, who: "asr", text: "I've accepted 2 leads. @Sam — they're in your book now." },
    ];
    const res = await teamChat("t1", "Jane");
    expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({ kind: "outreach", leadIds: ["l1"] }));
    expect(res.job).toEqual({ id: "j1", kind: "outreach", agentId: "out" });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("doesn't reopen a 'who?' the user already answered", async () => {
    db.rows = [
      { id: 1, who: "out", text: askWhoText("Ollie") },
      { id: 2, who: "me", text: "never mind" },
      { id: 3, who: "asr", text: "No problem." },
    ];
    await teamChat("t1", "Jane");
    expect(enqueueJob).not.toHaveBeenCalled();
    expect(resolve).toHaveBeenCalled();
  });

  it("stores a system line when no one picks the message up", async () => {
    vi.mocked(resolve).mockResolvedValueOnce({ messages: [] });
    const res = await teamChat("t1", "hmm");
    expect(res.messages).toEqual([{ id: 2, who: "system", text: "No one picked that up. Try @mentioning an agent on this team." }]);
  });
});
