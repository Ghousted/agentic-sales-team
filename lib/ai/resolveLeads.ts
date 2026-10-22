import "server-only";
// Interpret a free-text reply to Outreach's "who should I write to?" against the
// user's actual leads → which lead ids they mean (or all / none). One LLM call.
import { aiJSON, isAIConfigured, type Turn } from "./openrouter";
import type { TeamLeadPick } from "@/lib/leads/types";

export interface TargetResolution { mode: "all" | "some" | "none"; leadIds: string[] }

const SCHEMA = {
  type: "object",
  properties: {
    mode: { type: "string", enum: ["all", "some", "none"] },
    leadIds: { type: "array", items: { type: "string" } },
  },
  required: ["mode", "leadIds"],
} as const;

/** Map a reply like "Maria", "the Makati buyer", "all", or "this" to lead ids.
 *  Returns mode='none' (safe re-ask) on empty catalog, no AI key, or error. */
export async function resolveTargetLeads(reply: string, leads: TeamLeadPick[]): Promise<TargetResolution> {
  if (!isAIConfigured() || leads.length === 0) return { mode: "none", leadIds: [] };
  const list = leads
    .map((l) => `id=${l.id} | ${l.name}${l.title ? " — " + l.title : ""}${l.company ? " @ " + l.company : ""}${l.platform ? " (" + l.platform + ")" : ""}`)
    .join("\n");
  const system = [
    "A salesperson was asked which of their leads to write outreach to. Read their reply and map it to the lead list.",
    "Return JSON { mode, leadIds }:",
    "- mode='all' if they mean everyone / the whole list / 'all' / 'everyone'. leadIds: [].",
    "- mode='some' if they name or describe specific lead(s); set leadIds to the matching id(s) from the list ONLY.",
    "- mode='none' if you cannot tell which (a vague pointer like 'this'/'that one' with no detail, or unrelated). leadIds: [].",
    "Match on name, title, company, or platform. NEVER invent ids — use only ids from the list.",
    "LEADS:",
    list,
  ].join("\n");
  try {
    const r = await aiJSON<TargetResolution>(system, [{ role: "user", text: reply }] as Turn[], SCHEMA as unknown as Record<string, unknown>, { maxTokens: 300, temperature: 0.15 });
    const mode = r.mode === "all" || r.mode === "some" || r.mode === "none" ? r.mode : "none";
    const ids = Array.isArray(r.leadIds) ? r.leadIds.filter((id) => leads.some((l) => l.id === id)) : [];
    return { mode, leadIds: mode === "some" ? ids : [] };
  } catch {
    return { mode: "none", leadIds: [] };
  }
}
