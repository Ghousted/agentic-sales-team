import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
import * as schema from "@/lib/db/schema";

// The fake database answers only the "messages sent today" count.
const db = drizzle(async (sql) => ({ rows: /^select count/.test(sql) ? [[0]] : [] }), { schema });
const scout = { id: "s1", name: "Ava Reyes", role: "Scout", goal: "find buyers", task: "", capabilities: ["scrape"] };
const state = vi.hoisted(() => ({ history: [] as { id: number; who: string; text: string }[] }));

vi.mock("@/lib/db", async (importActual) => ({ ...(await importActual<typeof import("@/lib/db")>()), isDbConfigured: () => true, getDb: () => db }));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => ({ userId: "00000000-0000-4000-8000-00000000000a" }) }));
const team = vi.hoisted(() => ({ members: ["s1"] }));
vi.mock("@/lib/teams/membership", () => ({ membersOfTeam: async () => team.members }));
vi.mock("@/lib/pod/orchestrate", () => ({ agentInfo: async () => scout }));
vi.mock("@/lib/ai/openrouter", () => ({ isAIConfigured: () => false, aiJSON: vi.fn() }));
vi.mock("@/lib/ai/intent", () => ({ detectIntent: vi.fn() }));
vi.mock("./orchestrate", () => ({
  parseMentions: () => [],
  resolve: async () => ({ actor: scout, capability: "scrape", messages: [{ who: "s1", text: "Understood. I'm finding leads now." }] }),
}));
const JOB_ID = "33333333-3333-4333-8333-333333333333";
vi.mock("@/lib/jobs/actions", () => ({ enqueueJob: vi.fn(async () => ({ jobId: "33333333-3333-4333-8333-333333333333" })) }));
vi.mock("./teamMessages", () => ({
  listTeamMessages: async () => state.history,
  insertTeamMessages: vi.fn(async (_u: string, _t: string, msgs: { who: string; text: string }[]) => msgs.map((m, i) => ({ id: 100 + i, ...m }))),
  postJobOutcome: async () => null,
}));
vi.mock("@/lib/leads/store", () => ({ listTeamLeadsForPicker: async () => [], setLeadReview: async () => {} }));
vi.mock("@/lib/ai/resolveLeads", () => ({ resolveTargetLeads: async () => ({ mode: "none", leadIds: [] }) }));
vi.mock("@/lib/meetings/store", () => ({ bookMeeting: async () => false, meetingSettings: async () => ({}) }));

const { teamChat } = await import("./actions");
const { detectIntent } = await import("@/lib/ai/intent");
const { enqueueJob } = await import("@/lib/jobs/actions");
const { stripMarkers } = await import("./thread");
const { runIdFrom } = await import("@/lib/scrape/steps");

function intent(capability: string, params: Record<string, unknown> = {}) {
  vi.mocked(detectIntent).mockResolvedValueOnce({ capability, params, summary: "" } as never);
}
/** Put the agent's last reply in the thread, as the server stores it. */
function agentSaid(text: string) {
  state.history = [{ id: 1, who: "me", text: "..." }, { id: 2, who: "s1", text }];
}

beforeEach(() => {
  state.history = [];
  team.members = ["s1"];
  vi.mocked(enqueueJob).mockClear();
});

describe("scrape clarifying questions", () => {
  it("asks for the place and the count before a vague scrape, and starts nothing", async () => {
    intent("scrape");
    const res = await teamChat("t1", "Look for business in linkedin looking for an ai training provider");
    expect(enqueueJob).not.toHaveBeenCalled();
    expect(res.job).toBeUndefined();
    expect(res.messages).toHaveLength(1);
    expect(res.messages[0].text).toMatch(/1\. Where\?.*\n2\. How many leads/);
  });

  it("starts the scrape with the place and count from the answer", async () => {
    intent("scrape");
    const ask = (await teamChat("t1", "Look for business in linkedin looking for an ai training provider")).messages[0].text;
    agentSaid(ask);
    intent("chat");
    const res = await teamChat("t1", "Austin, 15");
    expect(enqueueJob).toHaveBeenCalledOnce();
    expect(vi.mocked(enqueueJob).mock.calls[0][0]).toMatchObject({
      kind: "scrape", target: 15, pod: true, teamId: "t1",
      instruction: "Look for business in linkedin looking for an ai training provider. Location: Austin.",
    });
    expect(res.job).toEqual({ id: JOB_ID, kind: "scrape", agentId: "s1" });
    expect(runIdFrom(res.messages[0].text)).toBe(JOB_ID); // the live timeline
    expect(stripMarkers(res.messages[0].text)).toBe([
      "Understood. I am starting the search:",
      "• Looking for: Look for business in linkedin looking for an ai training provider",
      "• Where: Austin",
      "• How many: 15 leads",
      "I will post the results here.",
    ].join("\n"));
  });

  it("starts at once when the request says who, where and how many", async () => {
    intent("scrape", { geo: "Texas", target: 20 });
    const res = await teamChat("t1", "find 20 dentists in Texas");
    expect(vi.mocked(enqueueJob).mock.calls[0][0]).toMatchObject({ target: 20, instruction: "find 20 dentists in Texas. Location: Texas." });
    expect(res.job?.kind).toBe("scrape");
  });

  it("asks all three for a bare 'find leads'", async () => {
    intent("scrape");
    const res = await teamChat("t1", "find leads");
    expect(res.messages[0].text).toMatch(/1\. Who should I look for\?.*\n2\. Where\?.*\n3\. How many leads/);
  });

  it("asks again for what is still missing, then uses defaults after the second question", async () => {
    intent("scrape");
    agentSaid((await teamChat("t1", "find AI training buyers")).messages[0].text);
    intent("chat");
    const second = await teamChat("t1", "Texas");
    expect(enqueueJob).not.toHaveBeenCalled();
    expect(second.messages[0].text).toMatch(/one more detail\.\nHow many leads/);
    agentSaid(second.messages[0].text);
    intent("chat");
    await teamChat("t1", "hmm");
    expect(vi.mocked(enqueueJob).mock.calls[0][0]).toMatchObject({ target: 10, instruction: "find AI training buyers. Location: Texas." });
  });

  it("starts with the defaults when the user leaves the details to the agent", async () => {
    intent("scrape");
    agentSaid((await teamChat("t1", "find AI training buyers")).messages[0].text);
    intent("chat");
    await teamChat("t1", "not sure, you pick");
    expect(vi.mocked(enqueueJob).mock.calls[0][0]).toMatchObject({ target: 10, instruction: "find AI training buyers" });
  });

  it("starts from the card's answer without parsing it", async () => {
    const { scrapeAnswerText } = await import("./clarify");
    intent("scrape");
    agentSaid((await teamChat("t1", "find businesses that need AI training")).messages[0].text);
    intent("chat");
    // Rules would read "United Kingdom · 25 leads" badly. The marker is exact.
    await teamChat("t1", scrapeAnswerText({ where: "United Kingdom", count: "25" }));
    expect(vi.mocked(enqueueJob).mock.calls[0][0]).toMatchObject({ target: 25, instruction: "find businesses that need AI training. Location: United Kingdom." });
  });

  it("reads the answer to a question from an agent on another team", async () => {
    const { scrapeAnswerText } = await import("./clarify");
    intent("scrape");
    agentSaid((await teamChat("t1", "find businesses that need AI training")).messages[0].text);
    team.members = ["someone-else"]; // Ava was sent this request across teams
    intent("scrape");
    const res = await teamChat("t1", scrapeAnswerText({ where: "Metro Manila Philippines", count: "5" }));
    expect(vi.mocked(enqueueJob).mock.calls[0][0]).toMatchObject({ target: 5, instruction: "find businesses that need AI training. Location: Metro Manila Philippines." });
    expect(stripMarkers(res.messages[0].text)).not.toMatch(/·|⟦/);
  });

  it("never searches for a card answer's text", async () => {
    const { scrapeAnswerText } = await import("./clarify");
    intent("scrape", { geo: "Manila", target: 5 });
    const res = await teamChat("t1", scrapeAnswerText({ where: "Manila", count: "5" }));
    expect(enqueueJob).not.toHaveBeenCalled();
    expect(res.messages[0].text).toMatch(/Who should I look for\?/);
  });

  it("caps the count and says so", async () => {
    intent("scrape", { geo: "Ohio", target: 100 });
    const res = await teamChat("t1", "find 100 manufacturers in Ohio");
    expect(vi.mocked(enqueueJob).mock.calls[0][0]).toMatchObject({ target: 25 });
    expect(res.messages[0].text).toMatch(/25 is the most per search/);
  });

  it("still reads the old 'What should I look for?' question", async () => {
    agentSaid("What should I look for? Tell me who or what to find, and where.");
    intent("chat");
    const res = await teamChat("t1", "dentists");
    expect(res.messages[0].text).toMatch(/Where\?/);
  });
});
