import "server-only";
// Matchmaking: given a lead's intent and candidate catalog listings (retrieved
// via searchProducts), pick the listings that genuinely fit. Each has a 0-100
// fit score and a one-line reason. Pure (no DB). One LLM JSON call.
import { aiJSON, isAIConfigured, type Turn } from "./openrouter";
import type { AgentSnapshot, MatchResult, ResearchBrief } from "@/lib/leads/types";
import type { ProductDTO } from "@/lib/products/store";

const SCHEMA = {
  type: "object",
  properties: {
    matches: {
      type: "array",
      items: {
        type: "object",
        properties: { productId: { type: "string" }, score: { type: "integer" }, reason: { type: "string" } },
        required: ["productId", "score", "reason"],
      },
    },
  },
  required: ["matches"],
} as const;

/** Match one lead to the listings that fit. Returns [] when nothing fits, and
 *  null when it can't run (no LLM, empty catalog); throws on an LLM error. Null
 *  and errors leave the lead to be tried again. Only ever returns productIds
 *  from the provided listings. */
export async function matchLead(
  agent: AgentSnapshot,
  lead: { name: string; title: string; company: string; research?: ResearchBrief | null },
  listings: ProductDTO[],
): Promise<MatchResult[] | null> {
  if (!isAIConfigured() || listings.length === 0) return null;
  const attrs = (p: ProductDTO) => Object.entries(p.attributes ?? {}).map(([k, v]) => ` | ${k}: ${v}`).join("");
  const catalog = listings
    .map((p) => `id=${p.id} | ${p.name}${p.price ? " (" + p.price + ")" : ""}${p.category ? " [" + p.category + "]" : ""}${p.description ? ": " + p.description : ""}${attrs(p)}`)
    .join("\n");
  const system = [
    `You are ${agent.name}, matching one prospect to the listings in our catalog that genuinely fit their need.`,
    "From the candidate listings below, return ONLY the ones that actually fit the prospect's stated intent (budget, location, type, size, etc.). Do not include poor fits. Never force a match.",
    "For each fitting listing: score its fit from 0 to 100 (100 = ideal), and give a ONE-line reason tying the listing to the prospect's need, naming the specific factor (e.g. budget or location).",
    "Order best fit first. Use productId values ONLY from the list below. Never invent an id. Return ONLY JSON { matches: [{ productId, score, reason }] }.",
    "\nCandidate listings:\n" + catalog,
  ].join("\n");
  const rb = lead.research ? `\nResearch: ${lead.research.summary}; priorities: ${(lead.research.priorities || []).join("; ")}` : "";
  const turns: Turn[] = [{ role: "user", text: `Prospect:\nName: ${lead.name}\nIntent: ${lead.title || "(unknown)"}\nCompany: ${lead.company || "(unknown)"}${rb}` }];
  const r = await aiJSON<{ matches: MatchResult[] }>(system, turns, SCHEMA as unknown as Record<string, unknown>, { maxTokens: 900, temperature: 0.3 });
  const valid = new Set(listings.map((p) => p.id));
  return (r.matches ?? [])
    .filter((m) => m && valid.has(m.productId))
    .map((m) => ({ productId: m.productId, score: Math.max(0, Math.min(100, Math.round(Number(m.score) || 0))), reason: (m.reason ?? "").trim() }))
    .slice(0, listings.length);
}
