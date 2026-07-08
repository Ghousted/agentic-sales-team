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

/** Firecrawl /v2/search — returns public web results with markdown. Synchronous. */
async function firecrawlSearch(query: string, limit: number): Promise<SearchResult[]> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return [];
  const res = await fetch("https://api.firecrawl.dev/v2/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, limit, scrapeOptions: { formats: [{ type: "markdown" }] } }),
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
    "You plan ONE web search query to find SALES LEADS — potential BUYERS/prospects a salesperson can sell to.",
    "Aim at PUBLIC POSTS or listings where buyers show intent or can be found — people asking for recommendations, 'looking for', 'anyone know', 'need a', buying/hiring intent — NOT vendor/seller profiles, company about-pages, or competitor listicles.",
    "If the instruction names a platform (Facebook, Reddit, X/Twitter, LinkedIn), target that site's PUBLIC web-accessible content with a site: filter (e.g. site:facebook.com, site:reddit.com).",
    icpText ? `Ideal customer: ${icpText}.` : "",
    agentGoal ? `Salesperson focus: ${agentGoal}.` : "",
    "Return JSON { query, platform } where platform is the site targeted: 'facebook' | 'reddit' | 'linkedin' | 'x' | 'web'.",
  ].filter(Boolean).join("\n");
  try {
    const r = await geminiJSON<{ query: string; platform: string }>(system, [{ role: "user", text: instruction }], PLAN_SCHEMA as unknown as Record<string, unknown>, { maxTokens: 200, temperature: 0.3 });
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
    .map((r) => `SOURCE_URL: ${r.url ?? ""}\nTITLE: ${r.title ?? ""}\n${(r.markdown ?? r.description ?? "").slice(0, 3000)}`)
    .join("\n\n---\n\n")
    .slice(0, 22000);
  const system = [
    "You are building a PROSPECT LIST of potential BUYERS for a salesperson — people (or companies) they could SELL TO.",
    instruction ? `The salesperson asked: "${instruction}".` : "",
    `The ideal customer (who they sell to): ${icpText}.`,
    sells ? `The salesperson's focus: ${sells}. Do NOT include anyone who SELLS the same kind of product/service (competitors, agents, vendors).` : "",
    "These are PUBLIC POSTS / pages. Extract the PEOPLE who show buying intent or fit the ideal customer — e.g. a person asking for recommendations, saying they're 'looking for' / 'need' something, or a company that would be a customer.",
    `Return up to ${target} distinct real prospects.`,
    "EXCLUDE (never return these): sellers/agents/vendors/agencies promoting or advertising their own services (they are competitors, not buyers); the platform, page, or group itself; marketplaces and directory/aggregator sites; news, blog, or 'best of' articles; job postings; and generic informational pages. A prospect is someone you would PITCH to — never a seller and never a website/article about the topic.",
    "For each: name (the person or company — not a page/post title), title (role, '' if unknown), company ('' if unknown),",
    `profileUrl (the SOURCE_URL it came from), platform (use '${platformHint || "web"}' unless the URL clearly indicates another),`,
    "and email — ONLY if VISIBLY present in the content, otherwise ''. Never invent names or emails.",
    "If a source has no genuine buyer (e.g. it's a seller's profile or an article), skip it and return fewer. Return ONLY JSON.",
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
  const limit = Math.max(3, Math.min(target, 4)); // small so search + extract fit maxDuration=60
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
