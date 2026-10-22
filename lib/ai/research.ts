import "server-only";
// The research engine: one structured LLM call per lead that produces a
// personalization brief. Pure (no DB). Mirrors lib/ai/outreach.ts.
import { aiJSON, isAIConfigured, type Turn } from "./openrouter";
import type { AgentSnapshot, ResearchBrief } from "@/lib/leads/types";

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    priorities: { type: "array", items: { type: "string" } },
    hooks: { type: "array", items: { type: "string" } },
    angle: { type: "string" },
  },
  required: ["summary", "priorities", "hooks", "angle"],
} as const;

function systemPrompt(a: AgentSnapshot): string {
  return [
    `You are ${a.name}, an AI research assistant on a B2B sales team.`,
    `Your objective: ${a.goal}.`,
    `Given ONE prospect, produce a concise research brief that helps a teammate personalize outreach.`,
    `Reason from the prospect's title, company, and platform using what you know about that kind of company and role.`,
    `Return: a 2-3 sentence summary; 3-5 likely priorities or pain points; 3-5 specific personalization hooks a rep could reference; and one recommended outreach angle.`,
    `Be concrete and specific. Do not use generic filler. Return ONLY JSON matching the schema.`,
  ].join(" ");
}

export async function draftResearch(agent: AgentSnapshot, lead: { name: string; title: string; company: string; platform?: string | null }): Promise<ResearchBrief> {
  if (!isAIConfigured()) {
    return {
      summary: `${lead.name}${lead.title ? ", " + lead.title : ""}${lead.company ? " at " + lead.company : ""}. Research brief unavailable (AI not configured).`,
      priorities: ["Operational efficiency", "Cost control", "Growth"],
      hooks: [lead.company ? `Reference ${lead.company}'s space` : "Reference their role"],
      angle: "Lead with a specific, relevant value proposition.",
    };
  }
  const turns: Turn[] = [{
    role: "user",
    text: `Prospect:\nName: ${lead.name}\nTitle: ${lead.title || "(unknown)"}\nCompany: ${lead.company || "(unknown)"}\nPlatform: ${lead.platform || "(unknown)"}`,
  }];
  const r = await aiJSON<ResearchBrief>(systemPrompt(agent), turns, SCHEMA as unknown as Record<string, unknown>, { maxTokens: 700, temperature: 0.6 });
  return {
    summary: (r.summary || "").trim(),
    priorities: Array.isArray(r.priorities) ? r.priorities : [],
    hooks: Array.isArray(r.hooks) ? r.hooks : [],
    angle: (r.angle || "").trim(),
  };
}
