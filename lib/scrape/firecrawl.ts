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
  // Buyer-voice fallback (no free-text instruction): find people expressing intent,
  // not vendor pages. `who`/industry describe the offering's audience.
  const what = [industry, titles].filter(Boolean).join(" ") || who;
  return `looking to buy ${what} ${geo || ""} recommendations`.replace(/\s+/g, " ").trim().slice(0, 490);
}

/** Infer a display platform from a result URL. */
function platformFromUrl(url: string): string {
  const u = url.toLowerCase();
  if (u.includes("facebook.com")) return "Facebook";
  if (u.includes("reddit.com")) return "Reddit";
  if (u.includes("linkedin.com")) return "LinkedIn";
  if (u.includes("x.com") || u.includes("twitter.com")) return "X";
  return "web";
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
    // tbs: only relatively-new results (past year) — stale buying-intent posts are dead leads.
    body: JSON.stringify({ query, limit, tbs: "qdr:y" }),
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
    "You write ONE simple web search in the BUYER'S OWN VOICE to surface PUBLIC POSTS where a potential buyer expresses intent — the phrases people actually post: 'looking to buy', 'LF' (looking for), 'want to buy', 'anyone selling', 'recommend a', 'need a'.",
    "Compose it from those buyer phrases + the ideal-customer keywords + location.",
    "Do NOT use seller jargon like 'property buyers', 'leads', or 'prospects' — buyers never write that (it matches broker ads). Do NOT add a site: filter (that's added separately). Do NOT use negative operators ('-word').",
    icpText ? `Ideal customer: ${icpText}.` : "",
    agentGoal ? `Salesperson focus: ${agentGoal}.` : "",
    "platform: return a specific site ONLY if the instruction explicitly names one ('facebook'|'reddit'|'linkedin'|'x'); otherwise 'web'.",
    "Return JSON { query, platform }.",
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
    "RECENCY: only include RELATIVELY NEW posts. If a post visibly shows its age and it is clearly old (e.g. '2y', '3 years ago', or a date more than ~1 year back), SKIP it — an old buying-intent post is a dead lead.",
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
  // With a free-text instruction, let Gemini formulate the search terms (buyer voice).
  // Otherwise fall back to the ICP-templated buyer query.
  const plan = instruction?.trim()
    ? await planSearch(instruction.trim(), icp, agent.goal)
    : { query: buildQuery(icp, agent.goal), platform: "web" };
  // Buyer-intent posts live on social/community sites — plain web returns seller
  // listings/ads. If no platform was named, search Facebook + Reddit by default.
  const domains: Record<string, string> = { facebook: "facebook.com", reddit: "reddit.com", linkedin: "linkedin.com", x: "x.com", twitter: "x.com" };
  const sites = domains[plan.platform] ? [domains[plan.platform]] : ["facebook.com", "reddit.com"];
  const per = Math.max(4, Math.min(target, 8));
  const seen = new Set<string>();
  const results: SearchResult[] = [];
  for (const site of sites) {
    const rs = await firecrawlSearch(`site:${site} ${plan.query}`, per);
    for (const r of rs) if (r.url && !seen.has(r.url)) { seen.add(r.url); results.push(r); }
  }
  const icpText = [icp?.titles, icp?.industry, icp?.geo].filter(Boolean).join(", ") || agent.goal;
  const sells = [agent.role, agent.goal].filter(Boolean).join(" — "); // seller context, to exclude competitors
  const prospects = await extractProspects(icpText, sells, results, target, plan.platform, instruction?.trim() ?? "");
  // normalize: derive platform from the source URL; ensure a profileUrl.
  return prospects.map((p) => ({
    name: p.name, title: p.title ?? "", company: p.company ?? "",
    profileUrl: p.profileUrl || "", platform: (p.profileUrl && platformFromUrl(p.profileUrl)) || p.platform || "web", email: p.email ?? "",
  }));
}
