import "server-only";
// Natural-language intent detection for the team group chat: a message → the
// capability the user wants + any scrape params. One LLM JSON call, with a
// keyword fallback when AI isn't configured or the call fails, so commands
// still route instead of all reading as small talk.
import { aiJSON, isAIConfigured, type Turn } from "./openrouter";

const CAPABILITIES = ["scrape", "research", "outreach", "follow-up", "book-meeting", "qualify", "proposal", "enrich", "match", "assess", "status", "chat", "unknown"] as const;

export interface Intent {
  capability: (typeof CAPABILITIES)[number];
  params: { industry?: string; titles?: string; geo?: string; target?: number };
  summary: string;
}

const SCHEMA = {
  type: "object",
  properties: {
    capability: { type: "string", enum: CAPABILITIES },
    params: {
      type: "object",
      properties: { industry: { type: "string" }, titles: { type: "string" }, geo: { type: "string" }, target: { type: "integer" } },
    },
    summary: { type: "string" },
  },
  required: ["capability", "params", "summary"],
} as const;

function systemPrompt(agents: { name: string; capabilities: string[] }[]): string {
  const roster = agents.map((a) => `- ${a.name}: ${a.capabilities.join(", ") || "(no capabilities)"}`).join("\n");
  return [
    "You route messages in a B2B sales team chat. Given a user's message, decide which single capability they want done:",
    "- scrape: find/import new prospects/leads matching a description (an ICP).",
    "- research: enrich existing leads with a research brief.",
    "- outreach: draft/write emails or messages to leads.",
    "- follow-up: re-engage cold/non-replying leads.",
    "- book-meeting: propose times / book meetings.",
    "- qualify: score/prioritize EXISTING leads (hot/warm/cold) — not new leads.",
    "- proposal: draft a proposal or quote for a lead using our products/pricing.",
    "- enrich: fill in a lead's missing contact info (email, title, company).",
    "- match: match existing leads to the products/listings in our catalog that fit them.",
    "- assess: review new/pending leads and accept the ones that fit our goal (drop the misses).",
    "- status: the user asks for an update/progress on what an agent is doing or recently did — e.g. 'any updates?', 'how's it going?', 'what are you working on?', 'done yet?', 'where are you at?'.",
    "- chat: small talk, or a QUESTION about how the team/an agent works or how something is done (e.g. 'how do you assess leads?', 'how do you guys find prospects?', 'what can you do?'). The user is asking, not commanding — no action.",
    "- unknown: a task request that fits none of the above.",
    "Distinguish commands from questions: 'assess these leads' is `assess`, but 'how do you assess leads?' is `chat`. A message asking HOW/WHAT/WHY/WHETHER you do something is `chat`, not the capability it mentions.",
    "For a scrape request, extract params from the message: industry, titles (job titles), geo (geography), target (how many, integer).",
    "Return a short `summary` restating the ask in a few words.",
    "The team's agents and their capabilities (for context only — you pick the capability, not the agent):",
    roster,
    "Return ONLY JSON matching the schema.",
  ].join("\n");
}

type Capability = Intent["capability"];

// A status ask, then a question about how things work, then each command's
// keywords, most specific first — "find a time to meet" is a meeting, not a scrape.
const STATUS = /\b(any (updates?|news)|status|progress|how('?s| is) it going|done yet|working on|where are (you|we) at)\b/i;
const QUESTION = /^(how|what|why|who|where|which|is|are|do|does|did)\b/i;
const RULES: [Capability, RegExp][] = [
  ["book-meeting", /\b(meeting|meet|call|demo|calendar|book|schedule)\b/i],
  ["follow-up", /\bfollow[- ]?ups?\b|\bre-?engage\b|\bnudge\b/i],
  ["proposal", /\b(proposals?|quotes?)\b/i],
  ["qualify", /\b(qualify|score|prioriti[sz]e|rank)\b/i],
  ["enrich", /\b(enrich|contact (info|details)|missing (emails?|info))\b/i],
  ["match", /\bmatch(es|ing)?\b/i],
  ["assess", /\b(assess|vet|screen)\b|\breview\b.*\bleads?\b/i],
  ["research", /\bresearch\b/i],
  ["outreach", /\b(outreach|emails?|draft|write|reach out|message|dm)\b/i],
  ["scrape", /\b(find|search|scrape|source|prospect|look for|import|get me|pull)\b/i],
];

/** The intent read from keywords alone — the fallback when the model can't be asked. */
export function keywordIntent(message: string): Intent {
  const text = message.replace(/@[\w'-]+/g, " ").trim();
  const summary = message.slice(0, 60);
  if (STATUS.test(text)) return { capability: "status", params: {}, summary };
  if (QUESTION.test(text)) return { capability: "chat", params: {}, summary };
  const hit = RULES.find(([, re]) => re.test(text));
  if (!hit) return { capability: "chat", params: {}, summary };
  const n = hit[0] === "scrape" ? Number(text.match(/\b(\d{1,3})\b/)?.[1]) : NaN;
  return { capability: hit[0], params: n > 0 ? { target: n } : {}, summary };
}

export async function detectIntent(message: string, agents: { name: string; capabilities: string[] }[]): Promise<Intent> {
  if (!isAIConfigured()) return keywordIntent(message);
  const turns: Turn[] = [{ role: "user", text: message }];
  try {
    const r = await aiJSON<Intent>(systemPrompt(agents), turns, SCHEMA as unknown as Record<string, unknown>, { maxTokens: 400, temperature: 0.2 });
    return {
      // The schema enum is only a hint, so anything outside it becomes unknown.
      capability: CAPABILITIES.includes(r.capability) ? r.capability : "unknown",
      params: r.params ?? {},
      summary: (r.summary ?? message.slice(0, 60)).trim(),
    };
  } catch (e) {
    console.error("[intent] AI call failed, using keywords:", e);
    return keywordIntent(message);
  }
}
