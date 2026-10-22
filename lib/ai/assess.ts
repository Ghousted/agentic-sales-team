import "server-only";
// Lead assessment: judge whether a freshly-scraped lead genuinely fits the
// agent's goal (a real prospect to sell to), so the good ones can be
// auto-accepted and clear misses dropped. Pure (no DB). One LLM JSON call.
import { aiJSON, isAIConfigured, type Turn } from "./openrouter";
import { untrusted, UNTRUSTED_RULE } from "./untrusted";
import type { AgentSnapshot, AssessResult, ResearchBrief } from "@/lib/leads/types";

const SCHEMA = {
  type: "object",
  properties: {
    accept: { type: "boolean" },
    score: { type: "integer" },
    reason: { type: "string" },
  },
  required: ["accept", "score", "reason"],
} as const;

/** Assess one lead against the agent's goal. On no AI key / error, accept it
 *  (fail-open, because the scraper already filtered it) with a neutral note. */
export async function assessLead(
  agent: AgentSnapshot,
  lead: { name: string; title: string; company: string; research?: ResearchBrief | null },
): Promise<AssessResult> {
  if (!isAIConfigured()) return { accept: true, reason: "Auto-accepted (assessment not configured).", score: 50 };
  const system = [
    `You are ${agent.name}, screening a newly-found lead before your team works it.`,
    `Your goal / who you sell to: ${agent.goal || agent.role || "(general prospects)"}.`,
    "Decide if this lead is a GENUINE, relevant prospect for that goal. A genuine prospect is a real person or company that shows the right intent (for example, a buyer when you sell to buyers). It is not a competitor, a vendor, a seller of the same thing, spam, or an off-topic post.",
    "Return JSON { accept, score, reason }: accept=true if they fit and are worth reaching out to; score 0-100 for fit; reason ONE short line explaining the call. Be reasonably inclusive, but reject clear misses.",
    UNTRUSTED_RULE,
  ].join("\n");
  const rb = lead.research ? `\nResearch: ${lead.research.summary}` : "";
  const turns: Turn[] = [{ role: "user", text: `Lead:\n${untrusted(`Name: ${lead.name}\nIntent/title: ${lead.title || "(unknown)"}\nCompany: ${lead.company || "(unknown)"}${rb}`)}` }];
  try {
    const r = await aiJSON<AssessResult>(system, turns, SCHEMA as unknown as Record<string, unknown>, { maxTokens: 300, temperature: 0.2 });
    return { accept: !!r.accept, score: Math.max(0, Math.min(100, Math.round(Number(r.score) || 0))), reason: (r.reason ?? "").trim() };
  } catch {
    return { accept: true, reason: "Auto-accepted (assessment unavailable).", score: 50 };
  }
}
