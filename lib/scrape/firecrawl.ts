import "server-only";
// Public-web lead discovery for the scrape capability: Firecrawl /v2/search fetches
// public pages for an ICP query, then LLM extracts structured Prospects. Replaces
// the browser-use worker. Runs synchronously inside a Node route (Vercel Hobby-safe).
// Two modes: "intent" finds buyer posts (Facebook/Reddit), "fit" finds companies and
// decision-makers that match a target customer (public LinkedIn pages Google indexed).
import { aiJSON, isAIConfigured, type Turn } from "@/lib/ai/openrouter";
import { safeHttpUrl } from "@/lib/url/safeUrl";

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

/** Firecrawl /v2/search. Returns public SERP results (title + description snippet
 * + url). We do NOT scrape page bodies: walled sites (Facebook/Reddit/LinkedIn)
 * return empty content, and the snippet already carries the buying-intent text. */
async function firecrawlSearch(query: string, limit: number, recentOnly: boolean): Promise<SearchResult[]> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return [];
  const res = await fetch("https://api.firecrawl.dev/v2/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    // tbs: only recent results (past month). Old buying-intent posts are dead leads.
    // Not for company/profile pages: their index date says nothing about the lead.
    body: JSON.stringify(recentOnly ? { query, limit, tbs: "qdr:m" } : { query, limit }),
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

export type ScrapeMode = "intent" | "fit";

interface SearchPlan { mode: ScrapeMode; queries: string[]; roles: string[]; platform: string }

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    mode: { type: "string", enum: ["intent", "fit"] },
    queries: { type: "array", items: { type: "string" } },
    roles: { type: "array", items: { type: "string" } },
    platform: { type: "string" },
  },
  required: ["mode", "queries", "roles", "platform"],
} as const;

/** How many buyer-voice searches the planner writes. One search copied the
 *  salesperson's words ("b2b businesses need training") and matched only other
 *  sellers, so the scrape found 0 leads. */
const PLAN_QUERIES = 3;

/** Turn the user's free-text instruction into web searches. The instruction IS the
 * targeting (what/who/where). "intent" searches are in the buyer's voice and aim at
 * buyer posts. "fit" searches describe the target companies and the job titles of
 * the people who buy, and aim at LinkedIn company and profile pages. */
async function planSearch(instruction: string, agentGoal: string): Promise<SearchPlan> {
  const fallback: SearchPlan = { mode: "intent", queries: [buildQuery(agentGoal)], roles: [], platform: "web" };
  if (!isAIConfigured()) return fallback;
  const system = [
    "The instruction comes from a SALESPERSON. It says what they sell and who they want to sell to.",
    "First choose the mode:",
    "- mode 'fit': the instruction describes a TYPE OF COMPANY or a JOB ROLE to target (industry, location, company size, 'companies', 'businesses', 'firms', 'decision-makers', 'HR managers at ...'), or it names LinkedIn. Fit finds companies and people that match the target customer.",
    "- mode 'intent': the instruction is about people who NEED or WANT something now (posts asking for help or recommendations), or it names Facebook, Reddit or X.",
    "",
    "For mode 'intent':",
    "Write web searches that find PUBLIC POSTS by the people who would BUY it. Write each search in the BUYER'S OWN VOICE: the words a buyer posts when they ask for help or a recommendation ('looking for', 'recommend a', 'need a', 'any recommendations for', 'want to buy').",
    "Translate the offering into the buyer's need. Do NOT copy the salesperson's words. Example: a salesperson who 'provides training to b2b businesses' needs posts like 'recommend a corporate training provider for our team' or 'looking for leadership training for our managers'.",
    "When the buyer is a business, write as an owner, manager or HR person who speaks for the company ('our team', 'our employees', 'our staff').",
    "Do NOT use seller words like 'buyers', 'leads', 'prospects', 'b2b' or 'clients'. Buyers do not write them. roles: [].",
    "",
    "For mode 'fit':",
    "queries: words that describe the TARGET COMPANIES as they describe themselves on their LinkedIn page: industry, what they do, location, size words. Example: for 'sell training to manufacturers in Ohio', write 'manufacturing company Ohio', 'industrial manufacturer Columbus Ohio', 'precision machining Ohio'. Do NOT describe the salesperson's product.",
    `roles: 1 to ${PLAN_QUERIES} job titles of the people at those companies who decide to buy the offering (for training: 'HR Director', 'Head of Learning and Development', 'Operations Manager'). Use the role the instruction names when it names one.`,
    "",
    `Both modes: write ${PLAN_QUERIES} DIFFERENT queries. Each query looks at a different angle. Keep each query short (2 to 9 words). Use the specifics in the instruction (what, who and any location).`,
    "Do NOT add a site: filter. Do NOT use negative operators ('-word').",
    agentGoal ? `Salesperson focus (context only): ${agentGoal}.` : "",
    "platform: return a specific site ONLY if the instruction names one ('facebook'|'reddit'|'linkedin'|'x'). Otherwise return 'web'.",
    "Return JSON { mode, queries, roles, platform }.",
  ].filter(Boolean).join("\n");
  try {
    const r = await aiJSON<Partial<SearchPlan>>(system, [{ role: "user", text: instruction }], PLAN_SCHEMA as unknown as Record<string, unknown>, { maxTokens: 400, temperature: 0.15 });
    const clean = (xs: unknown) => (Array.isArray(xs) ? xs : [])
      .map((q) => String(q ?? "").trim().slice(0, 490)).filter(Boolean).slice(0, PLAN_QUERIES);
    const queries = clean(r.queries);
    const platform = (r.platform || "web").toLowerCase();
    // LinkedIn has few indexed buyer posts, so a LinkedIn scrape is always a fit scrape.
    const mode: ScrapeMode = r.mode === "fit" || platform === "linkedin" ? "fit" : "intent";
    return { mode, queries: queries.length ? queries : fallback.queries, roles: mode === "fit" ? clean(r.roles) : [], platform };
  } catch {
    return fallback;
  }
}

/** The site-filtered Firecrawl queries for a plan. Intent searches each query on
 *  the platform the instruction named, or on Facebook and Reddit. Fit searches each
 *  query on LinkedIn company pages, and pairs it with a buyer role on profile pages. */
export function buildSearches(plan: SearchPlan): string[] {
  if (plan.mode === "fit") {
    const company = plan.queries.map((q) => `site:linkedin.com/company ${q}`);
    const people = plan.roles.length
      ? plan.queries.map((q, i) => `site:linkedin.com/in "${plan.roles[i % plan.roles.length]}" ${q}`)
      : [];
    return [...company, ...people];
  }
  const named: Record<string, string> = { facebook: "facebook.com", reddit: "reddit.com", x: "x.com" };
  // Buyer-intent posts are on social/community sites. Plain web returns seller
  // listings/ads. Search Facebook first, then Reddit, for every query.
  const sites = named[plan.platform] ? [named[plan.platform]] : ["facebook.com", "reddit.com"];
  return plan.queries.flatMap((q) => sites.map((site) => `site:${site} ${q}`));
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

/** Extraction rules for a fit scrape: LinkedIn company pages and profiles of
 *  decision-makers that match the target customer. */
function fitRules(targetDesc: string, sells: string, target: number): string[] {
  return [
    "You turn PUBLIC LinkedIn search results (company pages and people's profiles) into SALES LEADS.",
    `The salesperson is looking for: ${targetDesc}.`,
    sells ? `The salesperson's focus: ${sells}. NEVER return a company or person who SELLS the same product/service (competitors, agencies, consultants, vendors).` : "",
    "A lead is a COMPANY that matches the target customer, or a PERSON who works at one in a role that decides to buy.",
    `Return up to ${target} distinct leads. Prefer people with a buying role over company pages when both are present.`,
    "For each lead:",
    "- For a profile (SOURCE_URL contains '/in/'): name = the person's name as the TITLE shows it (LinkedIn titles look like 'Name - Job Title - Company | LinkedIn'). title = their job title. company = their employer.",
    "- For a company page (SOURCE_URL contains '/company/'): name = the company name. company = the company name. title = one line on what the company does and why it fits (industry, location, size when shown).",
    "- profileUrl: the SOURCE_URL. platform: 'LinkedIn'.",
    "- email: ONLY if VISIBLY present, otherwise ''. Never invent emails.",
    "Use ONLY facts in the TITLE and SNIPPET. NEVER fabricate a name, title or company. If the result does not show who or which company it is, skip it.",
    "EXCLUDE: companies or people that do not match the target (wrong industry, wrong location when one is given, wrong role); recruiters and staffing agencies (unless they are the target); job postings; LinkedIn posts, articles, 'pulse' pages, groups and school pages; LinkedIn's own pages.",
    "Return ONLY JSON.",
  ];
}

/** Extract BUYER prospects (people showing intent / companies to sell to) from
 * public post/page content. Not vendors, competitors, directories, or articles. */
async function extractProspects(targetDesc: string, sells: string, results: SearchResult[], target: number, platformHint: string, mode: ScrapeMode): Promise<Prospect[]> {
  if (!isAIConfigured() || results.length === 0) return [];
  const corpus = results
    .map((r) => `SOURCE_URL: ${r.url ?? ""}\nTITLE: ${r.title ?? ""}\nSNIPPET: ${(r.description ?? "").slice(0, 600)}\n${(r.markdown ?? "").slice(0, 2000)}`)
    .join("\n\n---\n\n")
    .slice(0, 40000); // room for every search's snippets (up to 6 searches)
  const system = (mode === "fit" ? fitRules(targetDesc, sells, target) : [
    "You turn PUBLIC posts/listings into SALES LEADS. A lead is a person the salesperson can contact.",
    `The salesperson is looking for: ${targetDesc}.`,
    sells ? `The salesperson's focus: ${sells}. NEVER return anyone who SELLS the same product/service (competitors, agents, vendors advertising themselves).` : "",
    "CRITICAL: MATCH THE DIRECTION of intent to what the salesperson wants:",
    "• If they want BUYERS, include ONLY people who want to BUY / purchase / are shopping for it. EXCLUDE anyone trying to SELL, list, rent out, or asking for advice on selling their own property/item. A seller is the OPPOSITE side and is NOT a lead.",
    "• If they want SELLERS/owners, do the reverse (exclude buyers).",
    "Read each post's actual intent, not just keywords. 'Looking for advice on selling my house' is a SELLER. Exclude it when buyers are wanted, even though it says 'looking for'.",
    "Each source whose intent is on the SAME side the salesperson wants is ONE lead. For example (for buyers): a person asking for recommendations, saying they're 'looking to buy' / 'want to buy' / 'need a', or a company that would be a customer.",
    `Return up to ${target} distinct leads.`,
    "For each lead:",
    "- name: WHO to contact. Use the poster's real name or username. Use a 'u/<username>' handle ONLY if an actual Reddit username is written in the snippet; NEVER invent one, and NEVER turn a subreddit (the 'r/...' part of the URL) into a 'u/...' handle. A subreddit is not a person. If no real poster name/username is visible, use a source label: 'Reddit user · r/<subreddit>' (take the subreddit from the SOURCE_URL) or 'Facebook group member'. NEVER use the post's title or a paraphrase of the post as the name, and NEVER fabricate a specific personal name.",
    "- title: a one-line summary of what they're looking for (their intent).",
    "- company: '' unless clearly stated.",
    `- profileUrl: the SOURCE_URL (the post/page link. The salesperson uses it to contact them). platform: '${platformHint || "web"}' unless the URL clearly indicates another.`,
    "- email: ONLY if VISIBLY present, otherwise ''. Never invent emails.",
    "INCLUDE a lead even when the name is not shown. The post link is the contact path.",
    "RECENCY: only include posts from the PAST MONTH. If a post visibly shows its age and it is older than ~1 month (e.g. '2mo', '3 months ago', '1y', or a date more than ~30 days back), SKIP it. An old buying-intent post is a dead lead.",
    "EXCLUDE: posts by sellers/agents/vendors ADVERTISING their own services (competitors, not buyers); the platform/group/page itself; directories, marketplaces, news/blog/'best of' articles, and job postings. A lead is someone to PITCH to. A lead is never a seller or an article about the topic.",
    "Return ONLY JSON.",
  ]).filter(Boolean).join("\n");
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
  const plan: SearchPlan = instruction?.trim()
    ? await planSearch(instruction.trim(), agent.goal)
    : { mode: "intent", queries: [buildQuery(agent.goal)], roles: [], platform: "web" };
  const per = Math.max(4, Math.min(target, 8));
  const searches = buildSearches(plan);
  // Run the searches in parallel to stay inside the scrape deadline. One failed
  // search does not stop the others. When all searches fail, report the first error.
  const settled = await Promise.allSettled(searches.map((q) => firecrawlSearch(q, per, plan.mode === "intent")));
  const failed = settled.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed.length === settled.length && failed.length) throw failed[0].reason;
  const seen = new Set<string>();
  const results: SearchResult[] = [];
  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    for (const hit of r.value) if (hit.url && !seen.has(hit.url)) { seen.add(hit.url); results.push(hit); }
  }
  const sells = [agent.role, agent.goal].filter(Boolean).join(". "); // seller context, to exclude competitors
  const prospects = await extractProspects(targetDesc, sells, results, target, plan.mode === "fit" ? "linkedin" : plan.platform, plan.mode);
  return normalizeProspects(prospects, results.map((r) => r.url));
}

/** The model sometimes turns the subreddit in the URL into a fake handle
 *  ("u/Training" from r/Training), although the prompt forbids it. A subreddit is
 *  not a person, so use the source label instead. */
function subredditAsUser(name: string, url: string): string {
  const handle = name.match(/^u\/([\w-]+)$/i)?.[1];
  const sub = url.match(/reddit\.com\/r\/([\w-]+)/i)?.[1];
  return handle && sub && handle.toLowerCase() === sub.toLowerCase() ? `Reddit user · r/${sub}` : name;
}

/** Derive platform from the source URL, and keep a profileUrl only when it is one
 *  of the URLs Firecrawl returned. The LLM writes profileUrl, so a prompt
 *  injection in a post could otherwise plant a `javascript:` or phishing link. */
export function normalizeProspects(prospects: Prospect[], sourceUrls: (string | undefined)[]): Prospect[] {
  const allowed = new Set(sourceUrls.map(safeHttpUrl).filter((u): u is string => !!u));
  return prospects.map((p) => {
    const url = safeHttpUrl(p.profileUrl);
    const profileUrl = url && allowed.has(url) ? url : "";
    return {
      name: subredditAsUser(p.name, profileUrl), title: p.title ?? "", company: p.company ?? "",
      profileUrl, platform: (profileUrl && platformFromUrl(profileUrl)) || p.platform || "web", email: p.email ?? "",
    };
  });
}
