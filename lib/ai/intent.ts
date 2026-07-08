import "server-only";
// Natural-language intent detection for the team group chat: a message → the
// capability the user wants + any scrape params. One Gemini JSON call.
import { geminiJSON, isGeminiConfigured, type Turn } from "./gemini";

export interface Intent {
  capability: "scrape" | "research" | "outreach" | "follow-up" | "book-meeting" | "chat" | "unknown";
  params: { industry?: string; titles?: string; geo?: string; target?: number };
  summary: string;
}

const SCHEMA = {
  type: "object",
  properties: {
    capability: { type: "string", enum: ["scrape", "research", "outreach", "follow-up", "book-meeting", "chat", "unknown"] },
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
    "- chat: small talk, questions, status — no action.",
    "- unknown: a task request that fits none of the above.",
    "For a scrape request, extract params from the message: industry, titles (job titles), geo (geography), target (how many, integer).",
    "Return a short `summary` restating the ask in a few words.",
    "The team's agents and their capabilities (for context only — you pick the capability, not the agent):",
    roster,
    "Return ONLY JSON matching the schema.",
  ].join("\n");
}

export async function detectIntent(message: string, agents: { name: string; capabilities: string[] }[]): Promise<Intent> {
  if (!isGeminiConfigured()) return { capability: "chat", params: {}, summary: message.slice(0, 60) };
  const turns: Turn[] = [{ role: "user", text: message }];
  try {
    const r = await geminiJSON<Intent>(systemPrompt(agents), turns, SCHEMA as unknown as Record<string, unknown>, { maxTokens: 400, temperature: 0.2 });
    return {
      capability: r.capability ?? "unknown",
      params: r.params ?? {},
      summary: (r.summary ?? message.slice(0, 60)).trim(),
    };
  } catch {
    return { capability: "chat", params: {}, summary: message.slice(0, 60) };
  }
}
