import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
import * as schema from "@/lib/db/schema";

// The fake database answers only the "messages sent today" count.
const db = drizzle(async (sql) => ({ rows: /^select count/.test(sql) ? [[0]] : /from "jobs"/.test(sql) ? state.lastJobs : [] }), { schema });
const scout = { id: "s1", name: "Ava Reyes", role: "Scout", goal: "find buyers", task: "", capabilities: ["scrape"] };
const state = vi.hoisted(() => ({ history: [] as { id: number; who: string; text: string }[], lastJobs: [] as unknown[][] }));

vi.mock("@/lib/db", async (importActual) => ({ ...(await importActual<typeof import("@/lib/db")>()), isDbConfigured: () => true, getDb: () => db }));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => ({ userId: "00000000-0000-4000-8000-00000000000a" }) }));
const team = vi.hoisted(() => ({ members: ["s1"] }));
vi.mock("@/lib/teams/membership", () => ({ membersOfTeam: async () => team.members }));
const pending = vi.hoisted(() => ({ n: 3 }));
vi.mock("@/lib/pod/orchestrate", () => ({ agentInfo: async () => scout, countPending: vi.fn(async () => pending.n) }));
vi.mock("@/lib/ai/openrouter", () => ({ isAIConfigured: () => false, aiJSON: vi.fn() }));
vi.mock("@/lib/ai/intent", () => ({ detectIntent: vi.fn() }));
const route = vi.hoisted(() => ({ next: null as null | { actor: unknown; capability: string; messages: { who: string; text: string }[]; handoff?: { who: string; text: string }[] } }));
vi.mock("./orchestrate", () => ({
  parseMentions: vi.fn(() => []),
  resolve: async () => route.next ?? ({ actor: scout, capability: "scrape", messages: [{ who: "s1", text: "Understood. I'm finding leads now." }] }),
}));
const catalog = vi.hoisted(() => ({ items: [] as { id: string; name: string; description: string }[] }));
vi.mock("@/lib/products/store", () => ({ listProducts: async () => catalog.items }));
const search = vi.hoisted(() => ({ configError: null as null | { job: string; user: string } }));
vi.mock("@/lib/jobs/scrape", () => ({ scrapeConfigError: () => search.configError }));
const JOB_ID = "33333333-3333-4333-8333-333333333333";
vi.mock("@/lib/jobs/actions", () => ({ enqueueJob: vi.fn(async () => ({ jobId: "33333333-3333-4333-8333-333333333333" })) }));
vi.mock("./teamMessages", () => ({
  listTeamMessages: async () => state.history,
  insertTeamMessages: vi.fn(async (_u: string, _t: string, msgs: { who: string; text: string }[]) => msgs.map((m, i) => ({ id: 100 + i, ...m }))),
  postJobOutcome: async () => null,
}));
const book = vi.hoisted(() => ({ leads: [] as { id: string; name: string; review: string }[] }));
vi.mock("@/lib/leads/store", () => ({ listTeamLeadsForPicker: async () => book.leads, setLeadReview: async () => {} }));
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
  state.lastJobs = [];
  team.members = ["s1"];
  route.next = null;
  book.leads = [];
  pending.n = 3;
  search.configError = null;
  // One product: the search uses it without asking.
  catalog.items = [{ id: "p1", name: "AI Training", description: "" }];
  vi.mocked(enqueueJob).mockClear();
});

describe("scrape clarifying questions", () => {
  it("asks for the place and the count before a vague scrape, and starts nothing", async () => {
    intent("scrape");
    const res = await teamChat("t1", "Look for business in linkedin looking for an ai training provider");
    expect(enqueueJob).not.toHaveBeenCalled();
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
      kind: "scrape", target: 15, pod: true, teamId: "t1", ask: true,
      instruction: "Look for business in linkedin looking for an ai training provider. Selling: AI Training. Location: Austin.",
    });
    // The agent asks first: the Proceed/Cancel panel sits under this message, and
    // the live timeline only appears once the user proceeds.
    expect(res.messages[0].text).toContain(`⟦approve:${JOB_ID}⟧`);
    expect(runIdFrom(res.messages[0].text)).toBeNull();
    expect(stripMarkers(res.messages[0].text)).toBe([
      "I'm ready to search:",
      "• For: AI Training",
      "• Looking for: Look for business in linkedin looking for an ai training provider",
      "• Where: Austin",
      "• How many: 15 leads",
      "Proceed?",
    ].join("\n"));
  });

  it("starts at once when the request says who, where and how many", async () => {
    intent("scrape", { geo: "Texas", target: 20 });
    const res = await teamChat("t1", "find 20 dentists in Texas");
    expect(vi.mocked(enqueueJob).mock.calls[0][0]).toMatchObject({ target: 20, instruction: "find 20 dentists in Texas. Selling: AI Training. Location: Texas.", ask: true });
    expect(res.messages[0].text).toMatch(/^I'm ready to search:[\s\S]*Proceed\?/);
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
    expect(vi.mocked(enqueueJob).mock.calls[0][0]).toMatchObject({ target: 10, instruction: "find AI training buyers. Selling: AI Training. Location: Texas." });
  });

  it("starts with the defaults when the user leaves the details to the agent", async () => {
    intent("scrape");
    agentSaid((await teamChat("t1", "find AI training buyers")).messages[0].text);
    intent("chat");
    await teamChat("t1", "not sure, you pick");
    expect(vi.mocked(enqueueJob).mock.calls[0][0]).toMatchObject({ target: 10, instruction: "find AI training buyers. Selling: AI Training." });
  });

  it("starts from the card's answer without parsing it", async () => {
    const { scrapeAnswerText } = await import("./clarify");
    intent("scrape");
    agentSaid((await teamChat("t1", "find businesses that need AI training")).messages[0].text);
    intent("chat");
    // Rules would read "United Kingdom · 25 leads" badly. The marker is exact.
    await teamChat("t1", scrapeAnswerText({ where: "United Kingdom", count: "25" }));
    expect(vi.mocked(enqueueJob).mock.calls[0][0]).toMatchObject({ target: 25, instruction: "find businesses that need AI training. Selling: AI Training. Location: United Kingdom." });
  });

  it("reads the answer to a question from an agent on another team", async () => {
    const { scrapeAnswerText } = await import("./clarify");
    intent("scrape");
    agentSaid((await teamChat("t1", "find businesses that need AI training")).messages[0].text);
    team.members = ["someone-else"]; // Ava was sent this request across teams
    intent("scrape");
    const res = await teamChat("t1", scrapeAnswerText({ where: "Metro Manila Philippines", count: "5" }));
    expect(vi.mocked(enqueueJob).mock.calls[0][0]).toMatchObject({ target: 5, instruction: "find businesses that need AI training. Selling: AI Training. Location: Metro Manila Philippines." });
    expect(stripMarkers(res.messages[0].text)).not.toMatch(/·|⟦/);
  });

  it("never searches for a card answer's text", async () => {
    const { scrapeAnswerText } = await import("./clarify");
    intent("scrape", { geo: "Manila", target: 5 });
    const res = await teamChat("t1", scrapeAnswerText({ where: "Manila", count: "5" }));
    expect(enqueueJob).not.toHaveBeenCalled();
    expect(res.messages[0].text).toMatch(/Who should I look for\?/);
  });

  it("asks only how many for 'look for more', with the last search's who and where", async () => {
    state.lastJobs = [[{ teamId: "t1", instruction: "find AI training buyers. Location: Metro Manila Philippines." }]];
    intent("scrape");
    const res = await teamChat("t1", "Lets look for more @Nina");
    expect(enqueueJob).not.toHaveBeenCalled();
    expect(res.messages[0].text).toMatch(/^I will search again for find AI training buyers, in Metro Manila Philippines\. One detail first\.\nHow many leads/);
    agentSaid(res.messages[0].text);
    intent("chat");
    await teamChat("t1", "10");
    expect(vi.mocked(enqueueJob).mock.calls[0][0]).toMatchObject({ target: 10, instruction: "find AI training buyers. Selling: AI Training. Location: Metro Manila Philippines." });
  });

  it("passes the agent's last message to intent detection", async () => {
    agentSaid("If you'd like to adjust the criteria for finding new leads, I can send that request to them.");
    intent("chat");
    await teamChat("t1", "yes");
    expect(vi.mocked(detectIntent).mock.calls.at(-1)?.[2]).toBe("If you'd like to adjust the criteria for finding new leads, I can send that request to them.");
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

  it("asks who to find when the request is only a greeting and an @mention", async () => {
    intent("scrape", { geo: "Makati Philippines", target: 2 });
    const res = await teamChat("t1", "@Ava Hi find me leads pls");
    expect(enqueueJob).not.toHaveBeenCalled();
    expect(res.messages[0].text).toMatch(/Who should I look for\?/);
    expect(res.messages[0].text).not.toMatch(/@Ava/);
  });
});

describe("the product the leads are for", () => {
  it("tells the user, and searches nothing, when the catalog is empty", async () => {
    catalog.items = [];
    intent("scrape", { geo: "Texas", target: 20 });
    const res = await teamChat("t1", "find 20 dentists in Texas");
    expect(enqueueJob).not.toHaveBeenCalled();
    expect(res.messages[0].text).toMatch(/no products in your catalog/);
  });

  it("asks which product when the catalog has more than one", async () => {
    catalog.items = [{ id: "p1", name: "AI Training", description: "" }, { id: "p2", name: "Payroll", description: "Monthly payroll service" }];
    intent("scrape", { geo: "Texas", target: 20 });
    const res = await teamChat("t1", "find 20 dentists in Texas");
    expect(enqueueJob).not.toHaveBeenCalled();
    expect(res.messages[0].text).toMatch(/Which product should I find leads for\?/);
    expect(res.messages[0].text).not.toMatch(/Where\?|How many/);
  });

  it("starts with the picked product and its description", async () => {
    catalog.items = [{ id: "p1", name: "AI Training", description: "" }, { id: "p2", name: "Payroll", description: "Monthly payroll service" }];
    intent("scrape", { geo: "Texas", target: 20 });
    agentSaid((await teamChat("t1", "find 20 dentists in Texas")).messages[0].text);
    intent("chat");
    const res = await teamChat("t1", "payroll please");
    expect(vi.mocked(enqueueJob).mock.calls[0][0]).toMatchObject({ target: 20, instruction: "find 20 dentists in Texas. Selling: Payroll (Monthly payroll service). Location: Texas." });
    expect(res.messages[0].text).toMatch(/• For: Payroll/);
  });

  it("uses the whole catalog for 'Any product'", async () => {
    catalog.items = [{ id: "p1", name: "AI Training", description: "" }, { id: "p2", name: "Payroll", description: "" }];
    intent("scrape", { geo: "Texas", target: 20 });
    agentSaid((await teamChat("t1", "find 20 dentists in Texas")).messages[0].text);
    intent("chat");
    await teamChat("t1", "any of them");
    expect(vi.mocked(enqueueJob).mock.calls[0][0]).toMatchObject({ instruction: "find 20 dentists in Texas. Selling: AI Training, Payroll. Location: Texas." });
  });
});

describe("an agent from another team", () => {
  const researcher = { id: "r1", name: "Apex", role: "Researcher", goal: "", task: "", capabilities: ["research"] };

  it("counts and works this team's leads: the job carries the team", async () => {
    const { countPending } = await import("@/lib/pod/orchestrate");
    route.next = { actor: researcher, capability: "research", messages: [] };
    intent("research");
    await teamChat("t1", "run research");
    expect(vi.mocked(countPending)).toHaveBeenCalledWith(expect.any(String), "r1", "research", "t1");
    const job = vi.mocked(enqueueJob).mock.calls[0][0];
    expect(job).toMatchObject({ kind: "research", teamId: "t1" });
    expect(job.leadIds).toBeUndefined();
  });

  it("says so, and asks nothing, when no lead on the team needs the step", async () => {
    pending.n = 0;
    route.next = { actor: researcher, capability: "research", messages: [] };
    intent("research");
    const res = await teamChat("t1", "run research");
    expect(enqueueJob).not.toHaveBeenCalled();
    expect(res.messages.at(-1)?.text).toMatch(/no accepted leads on this team that still need research/);
  });
});

describe("an open question", () => {
  it("still takes the answer when the user @mentions the agent that asked", async () => {
    intent("scrape");
    agentSaid((await teamChat("t1", "find leads")).messages[0].text);
    intent("chat");
    const { parseMentions } = await import("./orchestrate");
    vi.mocked(parseMentions).mockReturnValueOnce(["s1"]);
    const res = await teamChat("t1", "@Ava dentists");
    const { pendingScrapeBrief } = await import("./clarify");
    expect(pendingScrapeBrief(res.messages[0].text)?.what).toBe("dentists");
  });

  it("closes on 'never mind' instead of searching for it", async () => {
    intent("scrape");
    agentSaid((await teamChat("t1", "find leads")).messages[0].text);
    intent("chat");
    const res = await teamChat("t1", "never mind");
    expect(enqueueJob).not.toHaveBeenCalled();
    expect(res.messages[0].text).toMatch(/I stopped/);
  });

  it("reads a card answer even when its words look like another command", async () => {
    intent("scrape");
    agentSaid((await teamChat("t1", "find leads")).messages[0].text);
    intent("outreach");
    await teamChat("t1", "Email marketers · Austin · 5 leads ⟦answer:" + encodeURIComponent(JSON.stringify({ what: "Email marketers", where: "Austin", count: 5 })) + "⟧");
    expect(vi.mocked(enqueueJob).mock.calls[0][0]).toMatchObject({ kind: "scrape", target: 5, instruction: "Email marketers. Selling: AI Training. Location: Austin." });
  });
});

describe("setup the agent needs", () => {
  it("says lead search is not set up, before any question, when the keys are missing", async () => {
    search.configError = { job: "FIRECRAWL_API_KEY not set.", user: "" };
    intent("scrape");
    const res = await teamChat("t1", "find leads");
    expect(enqueueJob).not.toHaveBeenCalled();
    expect(res.messages[0].text).toMatch(/Lead search isn't set up/);
  });

  it("says the catalog is empty when asked to match leads", async () => {
    catalog.items = [];
    route.next = { actor: { ...scout, capabilities: ["match"] }, capability: "match", messages: [] };
    intent("match");
    const res = await teamChat("t1", "match the leads");
    expect(enqueueJob).not.toHaveBeenCalled();
    expect(res.messages.at(-1)?.text).toMatch(/catalog is empty, so I can't match leads/);
  });
});
