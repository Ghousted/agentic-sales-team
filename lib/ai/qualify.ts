import "server-only";
// Lead qualification: score a lead's ICP-fit/intent (hot/warm/cold) from its
// title/company (+ research brief when present). One LLM JSON call. Pure (no DB).
import { aiJSON, isAIConfigured, type Turn } from "./openrouter";
import type { AgentSnapshot, QualifyResult, ResearchBrief } from "@/lib/leads/types";

const SCHEMA = {
  type: "object",
  properties: {
    score: { type: "integer" },
    tier: { type: "string", enum: ["hot", "warm", "cold"] },
    reason: { type: "string" },
  },
  required: ["score", "tier", "reason"],
} as const;

const clampTier = (s: number): QualifyResult["tier"] => (s >= 75 ? "hot" : s >= 50 ? "warm" : "cold");

export async function qualifyLead(
  agent: AgentSnapshot,
  lead: { name: string; title: string; company: string; email: string; research?: ResearchBrief | null },
): Promise<QualifyResult> {
  if (!isAIConfigured()) {
    const s = lead.email ? 60 : 45;
    return { score: s, tier: clampTier(s), reason: "Heuristic score (AI not configured)." };
  }
  const system = [
    `You are ${agent.name}, qualifying B2B sales leads for: ${agent.goal}.`,
    "Score this lead 1-100 for ICP fit + buying intent, assign a tier (hot ≥75, warm 50-74, cold <50),",
    "and give a one-sentence reason. Judge from title (seniority/role fit), company, and any research. Return ONLY JSON.",
  ].join("\n");
  const rb = lead.research ? `\nResearch: ${lead.research.summary}; priorities: ${(lead.research.priorities || []).join("; ")}` : "";
  const turns: Turn[] = [{ role: "user", text: `Name: ${lead.name}\nTitle: ${lead.title || "(unknown)"}\nCompany: ${lead.company || "(unknown)"}\nHas email: ${lead.email ? "yes" : "no"}${rb}` }];
  try {
    const r = await aiJSON<QualifyResult>(system, turns, SCHEMA as unknown as Record<string, unknown>, { maxTokens: 300, temperature: 0.3 });
    const score = Math.max(1, Math.min(100, Math.round(r.score ?? 50)));
    return { score, tier: r.tier ?? clampTier(score), reason: (r.reason ?? "").trim() || "Qualified." };
  } catch {
    const s = lead.email ? 60 : 45;
    return { score: s, tier: clampTier(s), reason: "Heuristic score (qualification failed)." };
  }
}
