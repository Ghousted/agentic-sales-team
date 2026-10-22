import "server-only";
// Proposal drafting, grounded in the real product catalog (RAG): the caller
// passes the products retrieved via searchProducts; the model must use ONLY
// those real offerings + prices. One LLM JSON call. Pure (no DB).
import { aiJSON, isAIConfigured, type Turn } from "./openrouter";
import type { AgentSnapshot, ProposalResult, ResearchBrief } from "@/lib/leads/types";
import type { ProductDTO } from "@/lib/products/store";

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    body: { type: "string" },
    productsUsed: { type: "array", items: { type: "string" } },
  },
  required: ["title", "body", "productsUsed"],
} as const;

export async function draftProposal(
  agent: AgentSnapshot,
  lead: { name: string; title: string; company: string; research?: ResearchBrief | null },
  products: ProductDTO[],
): Promise<ProposalResult> {
  const attrs = (p: ProductDTO) => Object.entries(p.attributes ?? {}).map(([k, v]) => ` | ${k}: ${v}`).join("");
  const catalog = products.map((p) => `- ${p.name}${p.price ? " (" + p.price + ")" : ""}${p.description ? ": " + p.description : ""}${attrs(p)}`).join("\n");
  if (!isAIConfigured()) {
    return {
      title: `Proposal for ${lead.company || lead.name}`,
      body: `Hi ${lead.name.split(" ")[0]},\n\nBased on your needs, we recommend:\n${catalog || "(add products to your catalog to tailor this)"}\n\nHappy to walk through details.\n\nBest regards,\n${agent.name}`,
      productsUsed: products.map((p) => p.name),
    };
  }
  const system = [
    `You are ${agent.name}, writing a concise B2B sales proposal for a prospect.`,
    "Use ONLY the offerings below, with the real product names and prices. Never invent products or pricing.",
    "Produce: a short title, and a body (150-250 words) with a brief intro, 2-4 recommended offerings (name + price) mapped to the prospect's likely needs, and a soft next step.",
    "List the exact product names you referenced in productsUsed. Return ONLY JSON.",
    "\nAvailable offerings:\n" + (catalog || "(none. Write a brief generic proposal and leave productsUsed empty)"),
  ].join("\n");
  const rb = lead.research ? `\nResearch: ${lead.research.summary}; priorities: ${(lead.research.priorities || []).join("; ")}` : "";
  const turns: Turn[] = [{ role: "user", text: `Prospect:\nName: ${lead.name}\nTitle: ${lead.title || "(unknown)"}\nCompany: ${lead.company || "(unknown)"}${rb}` }];
  try {
    const r = await aiJSON<ProposalResult>(system, turns, SCHEMA as unknown as Record<string, unknown>, { maxTokens: 900, temperature: 0.5 });
    return { title: (r.title ?? "Proposal").trim(), body: (r.body ?? "").trim(), productsUsed: Array.isArray(r.productsUsed) ? r.productsUsed : [] };
  } catch {
    return { title: `Proposal for ${lead.company || lead.name}`, body: `Draft proposal for ${lead.name}.`, productsUsed: products.map((p) => p.name) };
  }
}
