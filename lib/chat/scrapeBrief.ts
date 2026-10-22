import "server-only";
// Builds the scrape brief (who, where, how many) from the user's first message and
// from their answers to the agent's questions. One small JSON call per answer, with
// a rule-based fallback when AI isn't configured or the call fails.
import { aiJSON, isAIConfigured } from "@/lib/ai/openrouter";
import { scrapeHasTarget, DEFAULT_SCRAPE_COUNT, type BriefField, type ScrapeBrief } from "./clarify";
import { stripMarkers } from "./thread";

const ANYWHERE = /\b(anywhere|any ?where|any location|everywhere|worldwide|world ?wide|global(ly)?|international(ly)?|remote|online|doesn'?t matter|does not matter|no preference|any country|all countries)\b/i;

/** A site is where to search, not a place. The intent model sometimes returns it as geo. */
const PLATFORM = /^(on )?(linkedin|facebook|fb|reddit|x|twitter|instagram|ig|tiktok|youtube|google|online|the web|web|internet|social media)$/i;

/** In a request, "online" or "remote" usually describes the target, not the place. */
const ANYWHERE_REQUEST = /\b(anywhere|everywhere|worldwide|world ?wide|globally|any location|any country|all countries)\b/i;

/** "You decide": take the default for every missing place and count. */
const DEFER = /\b(not sure|unsure|don'?t know|no idea|you (pick|choose|decide)|up to you|your call|whatever|any is fine|doesn'?t matter|does not matter)\b/i;

function firstCount(text: string): number | undefined {
  const n = Number(text.match(/\b(\d{1,3})\b/)?.[1]);
  return n > 0 ? n : undefined;
}

/** The brief from a fresh scrape request. `params` comes from intent detection,
 *  which already reads the place (geo) and the count (target). */
export function briefFromRequest(raw: string, params: { geo?: string; target?: number }): ScrapeBrief {
  // Hidden ⟦…⟧ markers are app state, never part of what to search for.
  const message = stripMarkers(raw);
  // A card answer ("Manila · 5 leads") names a place and a count, not who to find.
  if (/⟦answer:/.test(raw)) return {};
  const geo = params.geo?.trim() && !PLATFORM.test(params.geo.trim()) ? params.geo.trim() : undefined;
  return {
    what: scrapeHasTarget(message) ? message.trim() : undefined,
    where: geo && !ANYWHERE.test(geo) ? geo : ANYWHERE_REQUEST.test(message) || (geo && ANYWHERE.test(geo)) ? "anywhere" : undefined,
    count: params.target && params.target > 0 ? params.target : undefined,
  };
}

/** Rules only. Used when the model is not available. */
export function ruleAnswer(reply: string, missing: BriefField[]): ScrapeBrief {
  const out: ScrapeBrief = {};
  if (missing.includes("count")) out.count = firstCount(reply) ?? (DEFER.test(reply) ? DEFAULT_SCRAPE_COUNT : undefined);
  if (missing.includes("where") && (ANYWHERE.test(reply) || DEFER.test(reply))) out.where = "anywhere";
  const rest = reply.replace(/\b\d{1,3}\b/g, " ").replace(ANYWHERE, " ").replace(DEFER, " ").replace(/\s+/g, " ").replace(/^[\s,.;-]+|[\s,.;-]+$/g, "").trim();
  if (rest) {
    // Free text fills who-to-find first. A place-only answer fills where.
    if (missing.includes("what") && scrapeHasTarget(rest)) out.what = rest;
    else if (missing.includes("where") && !out.where) out.where = rest;
  }
  return out;
}

const SCHEMA = {
  type: "object",
  properties: { what: { type: "string" }, where: { type: "string" }, count: { type: "integer" } },
  required: ["what", "where", "count"],
} as const;

/** Read the user's answer to the agent's scrape questions. */
export async function readScrapeAnswer(reply: string, known: ScrapeBrief, missing: BriefField[]): Promise<ScrapeBrief> {
  if (!isAIConfigured()) return ruleAnswer(reply, missing);
  const system = [
    "A sales agent asked the user for details before it searches for leads. Read the user's reply and extract the details.",
    `The agent asked for: ${missing.join(", ")}.`,
    `Already known: ${JSON.stringify({ what: known.what ?? "", where: known.where ?? "", count: known.count ?? 0 })}.`,
    "- what: who to find (the buyer or the kind of company, with any industry, role or need). '' if the reply does not say.",
    "- where: the city, country or region. 'anywhere' if the user says location does not matter (anywhere, worldwide, global, online, no preference). '' if the reply does not say.",
    `- count: how many leads, as an integer. ${DEFAULT_SCRAPE_COUNT} if the user leaves it to the agent ('you pick', 'not sure'). 0 if the reply does not say.`,
    "If the user leaves the place to the agent ('you pick', 'not sure', 'up to you'), where is 'anywhere'.",
    "Use only what the reply says. Do not repeat the already known values. Return JSON { what, where, count }.",
  ].join("\n");
  try {
    const r = await aiJSON<{ what?: string; where?: string; count?: number }>(system, [{ role: "user", text: reply }], SCHEMA as unknown as Record<string, unknown>, { maxTokens: 150, temperature: 0 });
    return {
      what: r.what?.trim() || undefined,
      where: r.where?.trim() || undefined,
      count: typeof r.count === "number" && r.count > 0 ? Math.floor(r.count) : undefined,
    };
  } catch (e) {
    console.error("[scrapeBrief] AI call failed, using rules:", e);
    return ruleAnswer(reply, missing);
  }
}
