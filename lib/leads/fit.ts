import "server-only";
// Fills in leads.fit_reason for a lead that has none: one that was saved before
// the scraper wrote reasons, or one the model skipped. One small LLM call, then
// the line is saved so it is written only once.
import { and, eq } from "drizzle-orm";
import { getDb, isDbConfigured, leads } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { aiJSON, isAIConfigured } from "@/lib/ai/openrouter";
import { agentInfo } from "@/lib/pod/orchestrate";

const SCHEMA = {
  type: "object",
  properties: { fit: { type: "string" } },
  required: ["fit"],
} as const;

/** The lead's fit reason, written and saved now when it has none. '' when it
 *  cannot be written (no AI, not the user's lead, or the call failed). */
export async function ensureFitReason(leadId: string): Promise<string> {
  if (!isDbConfigured() || !/^[0-9a-f-]{36}$/i.test(leadId)) return "";
  const userId = (await getSession())?.userId;
  if (!userId) return "";
  const db = getDb();
  const [lead] = await db.select().from(leads).where(and(eq(leads.id, leadId), eq(leads.userId, userId))).limit(1);
  if (!lead) return "";
  if (lead.fitReason) return lead.fitReason;
  if (!isAIConfigured()) return "";

  const agent = await agentInfo(userId, lead.agentId);
  const goal = [agent?.role, agent?.goal].filter(Boolean).join(". ") || "(general prospects)";
  const system = [
    "You explain to a salesperson why a lead fits what they sell.",
    `The salesperson sells / is looking for: ${goal}.`,
    "Write fit: ONE short line (under 20 words). Use only the facts given about the lead. Name the concrete reason (their need, role, industry, size or location). If the facts show no clear fit, say what is missing, for example 'No clear training need shown; a large IT services firm in Manila.'",
    "Return JSON { fit }.",
  ].join("\n");
  const facts = [
    `Name: ${lead.name}`,
    `Title / intent: ${lead.title || "(unknown)"}`,
    `Company: ${lead.company || "(unknown)"}`,
    `Platform: ${lead.platform || "(unknown)"}`,
    lead.research?.summary ? `Research: ${lead.research.summary}` : "",
  ].filter(Boolean).join("\n");
  try {
    const r = await aiJSON<{ fit?: string }>(system, [{ role: "user", text: facts }], SCHEMA as unknown as Record<string, unknown>, { maxTokens: 120, temperature: 0.2 });
    const fit = (r.fit ?? "").trim().slice(0, 300);
    if (!fit) return "";
    // Only fill an empty reason: the Assessor may have written one meanwhile.
    await db.update(leads).set({ fitReason: fit })
      .where(and(eq(leads.id, leadId), eq(leads.userId, userId), eq(leads.fitReason, "")));
    return fit;
  } catch (e) {
    console.error("[fit] could not write a fit reason:", e);
    return "";
  }
}
