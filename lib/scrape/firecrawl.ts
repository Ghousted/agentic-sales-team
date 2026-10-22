import "server-only";
// Public-web lead discovery for the scrape capability: Firecrawl /v2/search fetches
// public pages for an ICP query, then LLM extracts structured Prospects. Replaces
// the browser-use worker. Runs synchronously inside a Node route (Vercel Hobby-safe).
import { aiJSON, isAIConfigured, type Turn } from "@/lib/ai/openrouter";

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

/** One Firecrawl search call. Two run per scrape, inside the route's 45s budget. */
const FIRECRAWL_TIMEOUT_MS = 15_000;
/** Room for ~30 prospects of JSON. 1500 cut the reply off mid-array, and the
 *  parse error used to surface as "found 0 leads". */
const EXTRACT_MAX_TOKENS = 4000;

/** Buyer-voice fallback query when no instruction is given (derived from the goal). */
function buildQuery(agentGoal: string): string {
  return `${agentGoal || "potential customers"} looking to buy recommendations`.replace(/\s+/g, " ").trim().slice(0, 490);
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
    // tbs: only recent results (past month) — stale buying-intent posts are dead leads.
    body: JSON.stringify({ query, limit, tbs: "qdr:m" }),
    cache: "no-store",
    signal: AbortSignal.timeout(FIRECRAWL_TIMEOUT_MS),
  }).catch((e) => {
    if ((e as Error)?.name === "TimeoutError") throw new Error(`Firecrawl search timed out after ${FIRECRAWL_TIMEOUT_MS / 1000}s`);
    throw e;
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

/** Turn the user's free-text instruction into ONE web search query aimed at BUYER
 * posts. The instruction IS the targeting (what/who/where). Platform-aware. */
async function planSearch(instruction: string, agentGoal: string): Promise<{ query: string; platform: string }> {
  const fallback = { query: buildQuery(agentGoal), platform: "web" };
  if (!isAIConfigured()) return fallback;
  const system = [
    "You write ONE simple web search in the BUYER'S OWN VOICE to surface PUBLIC POSTS where a potential buyer expresses intent — the phrases people actually post: 'looking to buy', 'LF' (looking for), 'want to buy', 'anyone selling', 'recommend a', 'need a'.",
    "Compose it from the specifics in the instruction (what they want, and any location).",
    "Do NOT use seller jargon like 'buyers', 'leads', or 'prospects' — buyers never write that (it matches broker ads). Do NOT add a site: filter (that's added separately). Do NOT use negative operators ('-word').",
    agentGoal ? `Salesperson focus (context only): ${agentGoal}.` : "",
    "platform: return a specific site ONLY if the instruction explicitly names one ('facebook'|'reddit'|'linkedin'|'x'); otherwise 'web'.",
    "Return JSON { query, platform }.",
  ].filter(Boolean).join("\n");
  try {
    const r = await aiJSON<{ query: string; platform: string }>(system, [{ role: "user", text: instruction }], PLAN_SCHEMA as unknown as Record<string, unknown>, { maxTokens: 200, temperature: 0.15 });
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
async function extractProspects(targetDesc: string, sells: string, results: SearchResult[], target: number, platformHint: string): Promise<Prospect[]> {
  if (!isAIConfigured() || results.length === 0) return [];
  const corpus = results
    .map((r) => `SOURCE_URL: ${r.url ?? ""}\nTITLE: ${r.title ?? ""}\nSNIPPET: ${(r.description ?? "").slice(0, 600)}\n${(r.markdown ?? "").slice(0, 2000)}`)
    .join("\n\n---\n\n")
    .slice(0, 22000);
  const system = [
    "You turn PUBLIC posts/listings into SALES LEADS — people the salesperson can reach out to.",
    `The salesperson is looking for: ${targetDesc}.`,
    sells ? `The salesperson's focus: ${sells}. NEVER return anyone who SELLS the same product/service (competitors, agents, vendors advertising themselves).` : "",
    "CRITICAL — MATCH THE DIRECTION of intent to what the salesperson wants:",
    "• If they want BUYERS, include ONLY people who want to BUY / purchase / are shopping for it. EXCLUDE anyone trying to SELL, list, rent out, or asking for advice on selling their own property/item — a seller is the OPPOSITE side and is NOT a lead.",
    "• If they want SELLERS/owners, do the reverse (exclude buyers).",
    "Read each post's actual intent, not just keywords. 'Looking for advice on selling my house' is a SELLER — exclude it when buyers are wanted, even though it says 'looking for'.",
    "Each source whose intent is on the SAME side the salesperson wants is ONE lead — e.g. (for buyers) a person asking for recommendations, saying they're 'looking to buy' / 'want to buy' / 'need a', or a company that would be a customer.",
    `Return up to ${target} distinct leads.`,
    "For each lead:",
    "- name: WHO to reach out to — the poster's real name or username. Use a 'u/<username>' handle ONLY if an actual Reddit username is written in the snippet; NEVER invent one, and NEVER turn a subreddit (the 'r/...' part of the URL) into a 'u/...' handle — a subreddit is not a person. If no real poster name/username is visible, use a source label: 'Reddit user · r/<subreddit>' (take the subreddit from the SOURCE_URL) or 'Facebook group member'. NEVER use the post's title or a paraphrase of the post as the name, and NEVER fabricate a specific personal name.",
    "- title: a one-line summary of what they're looking for (their intent).",
    "- company: '' unless clearly stated.",
    `- profileUrl: the SOURCE_URL (the post/page link — this is how the salesperson reaches them). platform: '${platformHint || "web"}' unless the URL clearly indicates another.`,
    "- email: ONLY if VISIBLY present, otherwise ''. Never invent emails.",
    "INCLUDE a lead even when the name isn't shown — the post link is the contact path.",
    "RECENCY: only include posts from the PAST MONTH. If a post visibly shows its age and it is older than ~1 month (e.g. '2mo', '3 months ago', '1y', or a date more than ~30 days back), SKIP it — a stale buying-intent post is a dead lead.",
    "EXCLUDE: posts by sellers/agents/vendors ADVERTISING their own services (competitors, not buyers); the platform/group/page itself; directories, marketplaces, news/blog/'best of' articles, and job postings. A lead is someone to PITCH to — never a seller or an article about the topic.",
    "Return ONLY JSON.",
  ].filter(Boolean).join("\n");
  const turns: Turn[] = [{ role: "user", text: corpus }];
  // Let a failure throw: swallowing it ended the job 'done' with "found 0 leads".
  let r: { prospects?: Prospect[] };
  try {
    r = await aiJSON<{ prospects: Prospect[] }>(system, turns, PROSPECTS_SCHEMA as unknown as Record<string, unknown>, { maxTokens: EXTRACT_MAX_TOKENS, temperature: 0.3 });
  } catch (e) {
    throw new Error(`Lead extraction failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  return (r.prospects ?? []).filter((p) => p && p.name).slice(0, target);
}

export async function runFirecrawlScrape(
  agent: { id: string; name: string; role: string; goal: string; task: string; capabilities?: string[] },
  target: number,
  instruction?: string,
): Promise<Prospect[]> {
  // The free-text instruction is the sole targeting (what/who/where). No ICP.
  const targetDesc = instruction?.trim() || agent.goal || "potential customers";
  const plan = instruction?.trim()
    ? await planSearch(instruction.trim(), agent.goal)
    : { query: buildQuery(agent.goal), platform: "web" };
  // Buyer-intent posts live on social/community sites — plain web returns seller
  // listings/ads. Always search Facebook first, then Reddit after.
  const sites = ["facebook.com", "reddit.com"];
  const per = Math.max(4, Math.min(target, 8));
  const seen = new Set<string>();
  const results: SearchResult[] = [];
  for (const site of sites) {
    const rs = await firecrawlSearch(`site:${site} ${plan.query}`, per);
    for (const r of rs) if (r.url && !seen.has(r.url)) { seen.add(r.url); results.push(r); }
  }
  const sells = [agent.role, agent.goal].filter(Boolean).join(" — "); // seller context, to exclude competitors
  const prospects = await extractProspects(targetDesc, sells, results, target, plan.platform);
  // normalize: derive platform from the source URL; ensure a profileUrl.
  return prospects.map((p) => ({
    name: p.name, title: p.title ?? "", company: p.company ?? "",
    profileUrl: p.profileUrl || "", platform: (p.profileUrl && platformFromUrl(p.profileUrl)) || p.platform || "web", email: p.email ?? "",
  }));
}
