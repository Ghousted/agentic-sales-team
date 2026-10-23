import { beforeEach, describe, expect, it, vi } from "vitest";

// teamChat with its collaborators stubbed: the stored thread is `db.rows`, and
// insertTeamMessages appends to it with fresh ids, like the messages table.
const db = vi.hoisted(() => ({ rows: [] as { id: number; who: string; text: string }[], inserts: [] as { who: string; text: string }[][] }));
// The team's agents. A test can set `auto` (capabilities run on Auto); beforeEach resets it.
const roster = vi.hoisted(() => ({
  out: { id: "out", name: "Ollie", role: "", goal: "", task: "", capabilities: ["outreach"], auto: [] as string[] },
  asr: { id: "asr", name: "Ada", role: "", goal: "", task: "", capabilities: ["assess"], auto: [] as string[] },
  mtg: { id: "mtg", name: "Mia", role: "", goal: "", task: "", capabilities: ["book-meeting"], auto: [] as string[] },
}));

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn(async () => ({ userId: "u1" })) }));
vi.mock("@/lib/teams/membership", () => ({ membersOfTeam: vi.fn(async () => ["out", "asr"]) }));
vi.mock("@/lib/pod/orchestrate", () => ({
  agentInfo: vi.fn(async (_u: string, id: string) => (roster as Record<string, unknown>)[id] ?? null),
}));
vi.mock("@/lib/pod/decisions", () => ({
  approveStep: vi.fn(async () => ({ ok: true, kind: "outreach", pod: false })),
  cancelStep: vi.fn(async () => ({ ok: true, kind: "outreach", pod: false })),
  openApproval: vi.fn(async () => null),
  createMeetingAsk: vi.fn(async () => "mj1"),
}));
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
vi.mock("@/lib/ai/meetingTime", async (importActual) => ({ ...(await importActual<typeof import("@/lib/ai/meetingTime")>()), parseMeetingTime: vi.fn() }));
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
import { askWhenText } from "@/lib/chat/clarify";
import { membersOfTeam } from "@/lib/teams/membership";
import { parseMeetingTime } from "@/lib/ai/meetingTime";
import { bookMeeting, meetingSettings } from "@/lib/meetings/store";
import { approveStep, cancelStep, openApproval, createMeetingAsk } from "@/lib/pod/decisions";

beforeEach(() => {
  db.rows = []; db.inserts = []; vi.clearAllMocks();
  for (const a of Object.values(roster)) a.auto = [];
});

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
      { id: 3, who: "asr", text: "I've accepted 2 leads. @Sam, they're in your book now." },
    ];
    const res = await teamChat("t1", "Jane");
    expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({ kind: "outreach", leadIds: ["l1"], teamId: "t1", ask: true }));
    // The agent asks first; Proceed starts the job.
    expect(res.messages.at(-1)?.text).toBe("I'm ready to draft outreach to 1 lead. Proceed? ⟦approve:j1⟧");
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

  describe("booking a meeting", () => {
    const SETTINGS = { type: "Intro call", duration: 30, windowStart: 9, windowEnd: 17, weekdaysOnly: true };
    beforeEach(() => {
      vi.mocked(membersOfTeam).mockResolvedValue(["mtg"]);
      vi.mocked(meetingSettings).mockResolvedValue(SETTINGS);
      vi.mocked(parseMeetingTime).mockResolvedValue({ iso: "2026-10-23T18:00:00.000Z", label: "Fri, Oct 23 · 2:00–2:30 PM", hasTime: true });
      db.rows = [{ id: 1, who: "mtg", text: askWhenText("Jane Doe", ["l1"]) }];
    });

    it("reads the time in the timezone the client sent", async () => {
      vi.mocked(bookMeeting).mockResolvedValue(true);
      await teamChat("t1", "tomorrow 2pm", undefined, "America/New_York");
      expect(parseMeetingTime).toHaveBeenCalledWith("tomorrow 2pm", { ...SETTINGS, timeZone: "America/New_York" });
    });

    it("uses UTC when the client's timezone isn't a real one", async () => {
      vi.mocked(bookMeeting).mockResolvedValue(true);
      await teamChat("t1", "tomorrow 2pm", undefined, "<script>");
      expect(parseMeetingTime).toHaveBeenCalledWith("tomorrow 2pm", { ...SETTINGS, timeZone: "UTC" });
    });

    it("asks Proceed/Cancel before booking (Ask is the default)", async () => {
      const res = await teamChat("t1", "tomorrow 2pm", undefined, "America/New_York");
      expect(bookMeeting).not.toHaveBeenCalled();
      expect(createMeetingAsk).toHaveBeenCalledWith("u1", { id: "mtg", name: "Mia" }, {
        teamId: "t1", leadIds: ["l1"], names: { l1: "Jane Doe" }, iso: "2026-10-23T18:00:00.000Z", label: "Fri, Oct 23 · 2:00–2:30 PM", type: "Intro call",
      });
      expect(res.messages.map((m) => m.text)).toEqual(["I'm ready to book a Intro call with Jane Doe on Fri, Oct 23 · 2:00–2:30 PM. Proceed? ⟦approve:mj1⟧"]);
    });

    it("says Booked when the meeting was booked (Auto)", async () => {
      roster.mtg.auto = ["book-meeting"];
      vi.mocked(bookMeeting).mockResolvedValue(true);
      const res = await teamChat("t1", "tomorrow 2pm", undefined, "America/New_York");
      expect(res.messages.map((m) => m.text)).toEqual(["Booked a Intro call with Jane Doe on Fri, Oct 23 · 2:00–2:30 PM. It is on your calendar."]);
    });

    it("doesn't say Booked when bookMeeting refused the lead (Auto)", async () => {
      roster.mtg.auto = ["book-meeting"];
      vi.mocked(bookMeeting).mockResolvedValue(false);
      const res = await teamChat("t1", "tomorrow 2pm", undefined, "America/New_York");
      expect(res.messages[0].text).not.toMatch(/Booked/);
      expect(res.messages[0].text).toMatch(/could not book/);
    });
  });
  describe("Auto", () => {
    it("starts outreach at once, with no ask, and hands the job to the client to follow", async () => {
      roster.out.auto = ["outreach"];
      db.rows = [{ id: 1, who: "me", text: "write to my leads" }, { id: 2, who: "out", text: askWhoText("Ollie") }];
      const res = await teamChat("t1", "Jane");
      expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({ kind: "outreach", leadIds: ["l1"], ask: false }));
      expect(res.messages.at(-1)?.text).toBe("Okay, starting now.");
      expect(res.follow).toEqual({ id: "j1", kind: "outreach", pod: false });
    });

    it("still asks when Auto is set for a different capability", async () => {
      roster.out.auto = ["research"];
      db.rows = [{ id: 1, who: "me", text: "write to my leads" }, { id: 2, who: "out", text: askWhoText("Ollie") }];
      const res = await teamChat("t1", "Jane");
      expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({ kind: "outreach", ask: true }));
      expect(res.follow).toBeUndefined();
    });
  });

  describe("typed answer to an open Proceed? ask", () => {
    const JOB = "11111111-1111-4111-8111-111111111111";
    beforeEach(() => {
      db.rows = [{ id: 1, who: "me", text: "write to Jane" }, { id: 2, who: "out", text: `I'm ready to draft outreach to 1 lead. Proceed? ⟦approve:${JOB}⟧` }];
      vi.mocked(openApproval).mockResolvedValue(JOB);
    });

    it("'yes' works as Proceed: the step starts and the client follows it", async () => {
      const res = await teamChat("t1", "Yes, go ahead!");
      expect(openApproval).toHaveBeenCalledWith("u1", [JOB]);
      expect(approveStep).toHaveBeenCalledWith("u1", JOB);
      expect(res).toEqual({ messages: [], follow: { id: JOB, kind: "outreach", pod: false } });
      // The reply is stored like any message, and nothing else reads it.
      expect(db.inserts).toEqual([[{ who: "me", text: "Yes, go ahead!" }]]);
      expect(resolve).not.toHaveBeenCalled();
    });

    it("'no' works as Cancel, and the run summary looks past the 'no' itself", async () => {
      const res = await teamChat("t1", "cancel");
      expect(cancelStep).toHaveBeenCalledWith("u1", JOB, 3);
      expect(res).toEqual({ messages: [], follow: undefined });
      expect(approveStep).not.toHaveBeenCalled();
    });

    it("shows the error and keeps the ask when the step can't start", async () => {
      vi.mocked(approveStep).mockResolvedValueOnce({ error: "I couldn't start that. Please try again." });
      const res = await teamChat("t1", "ok");
      expect(res.messages).toEqual([{ id: 4, who: "system", text: "I couldn't start that. Please try again." }]);
    });

    it("treats anything that isn't a clear yes or no as a normal message", async () => {
      await teamChat("t1", "yes but only the first 5");
      expect(openApproval).not.toHaveBeenCalled();
      expect(approveStep).not.toHaveBeenCalled();
      expect(resolve).toHaveBeenCalled();
    });

    it("treats 'yes' as a normal message when no ask is open", async () => {
      vi.mocked(openApproval).mockResolvedValue(null);
      await teamChat("t1", "yes");
      expect(approveStep).not.toHaveBeenCalled();
      expect(resolve).toHaveBeenCalled();
    });
  });
});
