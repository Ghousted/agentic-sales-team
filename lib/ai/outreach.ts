import "server-only";
// The outreach engine: one structured Gemini call per lead that both qualifies
// (score + pipeline stage) and drafts a personalized email. Pure — no DB.
import { geminiJSON, isGeminiConfigured, type Turn } from "./gemini";
import type { AgentSnapshot, OutreachResult } from "@/lib/leads/types";

const SCHEMA = {
  type: "object",
  properties: {
    score: { type: "integer" },
    stage: { type: "string", enum: ["new", "contacted", "engaged", "replied", "meeting"] },
    subject: { type: "string" },
    body: { type: "string" },
    rationale: { type: "string" },
  },
  required: ["score", "stage", "subject", "body", "rationale"],
} as const;

function systemPrompt(a: AgentSnapshot): string {
  return [
    `You are ${a.name}, an AI ${a.role} on a B2B sales team.`,
    `Your objective: ${a.goal}. Current focus: ${a.task}.`,
    `Given ONE prospect, do two things: (1) score their fit for your objective from 0 to 100 and pick the best pipeline stage, (2) write a concise, personalized cold outreach email.`,
    `The email must be specific to the prospect's title and company, give a plausible business reason to reach out, and align with your objective. 90-140 words, plain text, first person as ${a.name}, no placeholder tokens like [Company], and end with a soft call to action.`,
    `Return ONLY JSON matching the schema.`,
  ].join(" ");
}

export async function draftOutreach(agent: AgentSnapshot, lead: { name: string; title: string; company: string; email: string }): Promise<OutreachResult> {
  if (!isGeminiConfigured()) {
    const first = lead.name.split(" ")[0] || "there";
    return {
      score: 60,
      stage: "contacted",
      subject: `Quick idea for ${lead.company || "your team"}`,
      body: `Hi ${first},\n\nI'm ${agent.name}, ${agent.role}. I work with ${lead.title || "leaders"} on ${agent.goal}. Would a short call next week be worth 15 minutes?\n\nBest,\n${agent.name}`,
      rationale: "Fallback draft (Gemini not configured).",
    };
  }
  const turns: Turn[] = [{
    role: "user",
    text: `Prospect:\nName: ${lead.name}\nTitle: ${lead.title || "(unknown)"}\nCompany: ${lead.company || "(unknown)"}\nEmail: ${lead.email}`,
  }];
  const r = await geminiJSON<OutreachResult>(systemPrompt(agent), turns, SCHEMA as unknown as Record<string, unknown>, { maxTokens: 700, temperature: 0.6 });
  return {
    score: typeof r.score === "number" ? r.score : 50,
    stage: r.stage || "contacted",
    subject: (r.subject || `Quick note for ${lead.company || "you"}`).trim(),
    body: (r.body || "").trim(),
    rationale: (r.rationale || "").trim(),
  };
}
