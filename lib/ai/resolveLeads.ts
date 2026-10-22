import "server-only";
// Interpret a free-text reply to Outreach's "who should I write to?" against the
// user's actual leads → which lead ids they mean (or all / none). One LLM call.
import { aiJSON, isAIConfigured, type Turn } from "./openrouter";
import { untrusted, UNTRUSTED_RULE } from "./untrusted";
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

const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2);

/** Without AI: "all"/"everyone" → all; else the leads whose full name, first or
 *  last name, or company appears as whole words in the reply. */
export function matchLeadsByName(reply: string, leads: TeamLeadPick[]): TargetResolution {
  if (/^\s*(all|everyone|everybody|all of them|the whole list)\s*[.!]?\s*$/i.test(reply)) return { mode: "all", leadIds: [] };
  const said = new Set(words(reply));
  const ids = leads
    .filter((l) => words(l.name).some((w) => said.has(w)) || (l.company && words(l.company).length > 0 && words(l.company).every((w) => said.has(w))))
    .map((l) => l.id);
  return ids.length ? { mode: "some", leadIds: ids } : { mode: "none", leadIds: [] };
}

/** Map a reply like "Maria", "the Makati buyer", "all", or "this" to lead ids.
 *  Uses name matching when AI isn't configured or fails; mode='none' (safe
 *  re-ask) on an empty catalog or no match. */
export async function resolveTargetLeads(reply: string, leads: TeamLeadPick[]): Promise<TargetResolution> {
  if (leads.length === 0) return { mode: "none", leadIds: [] };
  if (!isAIConfigured()) return matchLeadsByName(reply, leads);
  const list = leads
    .map((l) => `id=${l.id} | ${l.name}${l.title ? ", " + l.title : ""}${l.company ? " @ " + l.company : ""}${l.platform ? " (" + l.platform + ")" : ""}`)
    .join("\n");
  const system = [
    "A salesperson was asked which of their leads to write outreach to. Read their reply and map it to the lead list.",
    "Return JSON { mode, leadIds }:",
    "- mode='all' if they mean everyone / the whole list / 'all' / 'everyone'. leadIds: [].",
    "- mode='some' if they name or describe specific lead(s); set leadIds to the matching id(s) from the list ONLY.",
    "- mode='none' if you cannot tell which (a vague pointer like 'this'/'that one' with no detail, or unrelated). leadIds: [].",
    "Match on name, title, company, or platform. NEVER invent ids. Use only ids from the list.",
    UNTRUSTED_RULE,
    "LEADS:",
    untrusted(list),
  ].join("\n");
  try {
    const r = await aiJSON<TargetResolution>(system, [{ role: "user", text: reply }] as Turn[], SCHEMA as unknown as Record<string, unknown>, { maxTokens: 300, temperature: 0.15 });
    const mode = r.mode === "all" || r.mode === "some" || r.mode === "none" ? r.mode : "none";
    const ids = Array.isArray(r.leadIds) ? r.leadIds.filter((id) => leads.some((l) => l.id === id)) : [];
    return { mode, leadIds: mode === "some" ? ids : [] };
  } catch (e) {
    console.error("[resolveLeads] AI call failed, matching by name:", e);
    return matchLeadsByName(reply, leads);
  }
}
