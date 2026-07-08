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

/** Extract BUYER prospects (people/companies to sell to) from page content — not
 * vendors, competitors, directories, or articles. Gemini JSON mode. */
async function extractProspects(icpText: string, sells: string, results: SearchResult[], target: number): Promise<Prospect[]> {
  if (!isGeminiConfigured() || results.length === 0) return [];
  const corpus = results
    .map((r) => `SOURCE_URL: ${r.url ?? ""}\nTITLE: ${r.title ?? ""}\n${(r.markdown ?? r.description ?? "").slice(0, 3000)}`)
    .join("\n\n---\n\n")
    .slice(0, 22000);
  const system = [
    "You are building a PROSPECT LIST of potential BUYERS for a salesperson — people or companies they could SELL TO.",
    `The ideal customer (who they sell to): ${icpText}.`,
    sells ? `The salesperson's focus: ${sells}. Do NOT include companies that sell the same kind of product/service (competitors/vendors).` : "",
    `From the page contents, extract up to ${target} distinct real prospects that fit the ideal customer as a BUYER.`,
    "INCLUDE: decision-makers or companies that match the profile and could be customers. If a page lists many matching companies (a directory or 'companies in X'), extract those companies as separate prospects.",
    "EXCLUDE (never return these): vendors, agencies, consultancies, or software/tools that SELL to this market (competitors); marketplaces and directory/aggregator sites themselves; news, blog, or 'best of' articles; job postings; and generic informational pages. A prospect is someone you would PITCH to — never a website or article about the topic.",
    "For each: name (the person or company — not a page title), title (role, '' if unknown), company ('' if unknown),",
    "profileUrl (the SOURCE_URL it came from), platform ('web', or 'linkedin'/'facebook' if the URL is that site),",
    "and email — ONLY if VISIBLY present in the content, otherwise ''. Never invent names or emails.",
    "If a source yields no real buyer, skip it. Return ONLY JSON.",
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
): Promise<Prospect[]> {
  const query = buildQuery(icp, agent.goal);
  const limit = Math.max(3, Math.min(target, 4)); // small so search + extract fit maxDuration=60
  const results = await firecrawlSearch(query, limit);
  const icpText = [icp?.titles, icp?.industry, icp?.geo].filter(Boolean).join(", ") || agent.goal;
  const sells = [agent.role, agent.goal].filter(Boolean).join(" — "); // seller context, to exclude competitors
  const prospects = await extractProspects(icpText, sells, results, target);
  // normalize: ensure a profileUrl/platform even if the model omitted them
  return prospects.map((p) => ({
    name: p.name, title: p.title ?? "", company: p.company ?? "",
    profileUrl: p.profileUrl || "", platform: p.platform || "web", email: p.email ?? "",
  }));
}
