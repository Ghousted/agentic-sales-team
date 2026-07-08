import "server-only";
// Public-web lead discovery for the scrape capability: Firecrawl /v2/search fetches
// public pages for an ICP query, then Gemini extracts structured Prospects. Replaces
// the browser-use worker. Runs synchronously inside a Node route (Vercel Hobby-safe).
import { geminiJSON, isGeminiConfigured, type Turn } from "@/lib/ai/gemini";

export interface Prospect {
  name: string;
  title: string;
  company: string;
  profileUrl: string;
  platform: string;
  email: string;
}

export function isFirecrawlConfigured(): boolean {
  return !!process.env.FIRECRAWL_API_KEY;
}

interface SearchResult { title?: string; description?: string; url?: string; markdown?: string }

/** Build a web search query aimed at the BUYERS (the people/companies to sell to),
 * not vendor/contact/directory pages. */
function buildQuery(icp: { industry?: string; titles?: string; geo?: string } | null, agentGoal: string): string {
  const titles = icp?.titles?.trim();
  const industry = icp?.industry?.trim();
  const geo = icp?.geo?.trim();
  if (!titles && !industry && !geo) return `${agentGoal} — potential customers, decision makers`.slice(0, 490);
  const who = titles || "decision makers";
  const seg = [industry && `${industry} companies`, geo && `in ${geo}`].filter(Boolean).join(" ") || industry || geo;
  // Target the prospects themselves (profiles / leadership / company lists), not "contact us" vendor pages.
  return `${who} at ${seg} — leadership team, company directory, LinkedIn profiles`.slice(0, 490);
}

/** Firecrawl /v2/search — returns public SERP results (title + description snippet
 * + url). We do NOT scrape page bodies: walled sites (Facebook/Reddit/LinkedIn)
 * return empty content, and the snippet already carries the buying-intent text. */
async function firecrawlSearch(query: string, limit: number): Promise<SearchResult[]> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return [];
  const res = await fetch("https://api.firecrawl.dev/v2/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, limit }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Firecrawl ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  const data = await res.json();
  const web = data?.data?.web;
  return Array.isArray(web) ? (web as SearchResult[]) : [];
}

const PLAN_SCHEMA = {
  type: "object",
  properties: { query: { type: "string" }, platform: { type: "string" } },
  required: ["query", "platform"],
} as const;

/** Turn the user's free-text instruction + ICP into ONE web search query aimed at
 * BUYER posts. Platform-aware: if the instruction names Facebook/Reddit/etc., it
 * targets that site's public, web-accessible content (via a site: filter). */
async function planSearch(instruction: string, icp: { industry?: string; titles?: string; geo?: string } | null, agentGoal: string): Promise<{ query: string; platform: string }> {
  const fallback = { query: buildQuery(icp, agentGoal), platform: "web" };
  if (!isGeminiConfigured()) return fallback;
  const icpText = [icp?.titles, icp?.industry, icp?.geo].filter(Boolean).join(", ");
  const system = [
    "You write ONE simple web search query to surface PUBLIC POSTS where potential BUYERS show intent (people asking for recommendations / 'looking for' / 'need a' / 'want to buy').",
    "Compose it from: buyer-intent phrases + the ideal-customer keywords + location. If the instruction names a platform (Facebook, Reddit, X, LinkedIn), prepend a site: filter (e.g. site:facebook.com).",
    "CRITICAL: keep it SIMPLE. Do NOT use negative/exclusion operators (never use '-word'). Do NOT exclude words like 'agent', 'realtor', 'broker', 'buy', 'buyer' — buyers use those words when asking for help; over-filtering returns nothing.",
    icpText ? `Ideal customer: ${icpText}.` : "",
    agentGoal ? `Salesperson focus: ${agentGoal}.` : "",
    "Return JSON { query, platform } where platform is the site targeted: 'facebook' | 'reddit' | 'linkedin' | 'x' | 'web'.",
  ].filter(Boolean).join("\n");
  try {
    const r = await geminiJSON<{ query: string; platform: string }>(system, [{ role: "user", text: instruction }], PLAN_SCHEMA as unknown as Record<string, unknown>, { maxTokens: 200, temperature: 0.15 });
    return { query: (r.query || fallback.query).slice(0, 490), platform: (r.platform || "web").toLowerCase() };
  } catch {
    return fallback;
  }
}

const PROSPECTS_SCHEMA = {
  type: "object",
  properties: {
    prospects: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" }, title: { type: "string" }, company: { type: "string" },
          profileUrl: { type: "string" }, platform: { type: "string" }, email: { type: "string" },
        },
        required: ["name", "title", "company", "profileUrl", "platform", "email"],
      },
    },
  },
  required: ["prospects"],
} as const;

/** Extract BUYER prospects (people showing intent / companies to sell to) from
 * public post/page content — not vendors, competitors, directories, or articles. */
async function extractProspects(icpText: string, sells: string, results: SearchResult[], target: number, platformHint: string, instruction: string): Promise<Prospect[]> {
  if (!isGeminiConfigured() || results.length === 0) return [];
  const corpus = results
    .map((r) => `SOURCE_URL: ${r.url ?? ""}\nTITLE: ${r.title ?? ""}\nSNIPPET: ${(r.description ?? "").slice(0, 600)}\n${(r.markdown ?? "").slice(0, 2000)}`)
    .join("\n\n---\n\n")
    .slice(0, 22000);
  const system = [
    "You turn PUBLIC posts/listings into SALES LEADS — potential BUYERS a salesperson can reach out to.",
    instruction ? `The salesperson asked: "${instruction}".` : "",
    `The ideal customer (who they sell to): ${icpText}.`,
    sells ? `The salesperson's focus: ${sells}. NEVER return anyone who SELLS the same product/service (competitors, agents, vendors advertising themselves).` : "",
    "Each source where someone shows BUYING INTENT or matches the ideal customer is ONE lead — e.g. a person asking for recommendations, saying they're 'looking for' / 'need' / 'want to buy', or a company that would be a customer.",
    `Return up to ${target} distinct leads.`,
    "For each lead:",
    "- name: the poster's real name ONLY if it clearly appears in the title/snippet; otherwise a short human-readable descriptor of who they are (e.g. 'First-time home buyer — Austin'). NEVER fabricate a specific personal name.",
    "- title: a one-line summary of what they're looking for (their intent).",
    "- company: '' unless clearly stated.",
    `- profileUrl: the SOURCE_URL (the post/page link — this is how the salesperson reaches them). platform: '${platformHint || "web"}' unless the URL clearly indicates another.`,
    "- email: ONLY if VISIBLY present, otherwise ''. Never invent emails.",
    "INCLUDE a lead even when the name isn't shown — the post link is the contact path.",
    "EXCLUDE: posts by sellers/agents/vendors ADVERTISING their own services (competitors, not buyers); the platform/group/page itself; directories, marketplaces, news/blog/'best of' articles, and job postings. A lead is someone to PITCH to — never a seller or an article about the topic.",
    "Return ONLY JSON.",
  ].filter(Boolean).join("\n");
  const turns: Turn[] = [{ role: "user", text: corpus }];
  try {
    const r = await geminiJSON<{ prospects: Prospect[] }>(system, turns, PROSPECTS_SCHEMA as unknown as Record<string, unknown>, { maxTokens: 1500, temperature: 0.3 });
    return (r.prospects ?? []).filter((p) => p && p.name).slice(0, target);
  } catch {
    return [];
  }
}

export async function runFirecrawlScrape(
  agent: { id: string; name: string; role: string; goal: string; task: string; capabilities?: string[] },
  icp: { industry?: string; titles?: string; geo?: string } | null,
  target: number,
  instruction?: string,
): Promise<Prospect[]> {
  // With a free-text instruction, let Gemini formulate the search terms (buyer-intent,
  // platform-aware). Otherwise fall back to the ICP-templated query.
  const plan = instruction?.trim()
    ? await planSearch(instruction.trim(), icp, agent.goal)
    : { query: buildQuery(icp, agent.goal), platform: "web" };
  const limit = Math.max(6, Math.min(target + 4, 12)); // SERP-only (no page scrape) is fast → pull more candidates
  const results = await firecrawlSearch(plan.query, limit);
  const icpText = [icp?.titles, icp?.industry, icp?.geo].filter(Boolean).join(", ") || agent.goal;
  const sells = [agent.role, agent.goal].filter(Boolean).join(" — "); // seller context, to exclude competitors
  const prospects = await extractProspects(icpText, sells, results, target, plan.platform, instruction?.trim() ?? "");
  // normalize: ensure a profileUrl/platform even if the model omitted them
  return prospects.map((p) => ({
    name: p.name, title: p.title ?? "", company: p.company ?? "",
    profileUrl: p.profileUrl || "", platform: p.platform || plan.platform || "web", email: p.email ?? "",
  }));
}
