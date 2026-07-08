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

/** Build a web search query from the ICP (falls back to the agent's goal). */
function buildQuery(icp: { industry?: string; titles?: string; geo?: string } | null, agentGoal: string): string {
  const parts = [icp?.titles, icp?.industry, icp?.geo].filter(Boolean) as string[];
  const base = parts.length ? parts.join(" ") : agentGoal;
  // Bias toward finding real people/companies with contactable profiles.
  return `${base} companies OR founders OR decision makers contact`.slice(0, 490);
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

/** Extract Prospects from the search results' page content via Gemini JSON mode. */
async function extractProspects(icpText: string, results: SearchResult[], target: number): Promise<Prospect[]> {
  if (!isGeminiConfigured() || results.length === 0) return [];
  const corpus = results
    .map((r) => `SOURCE_URL: ${r.url ?? ""}\nTITLE: ${r.title ?? ""}\n${(r.markdown ?? r.description ?? "").slice(0, 3000)}`)
    .join("\n\n---\n\n")
    .slice(0, 22000);
  const system = [
    `You extract B2B sales prospects (people or companies) matching this ICP: ${icpText}.`,
    "From the provided public web page contents, return up to " + target + " distinct prospects that plausibly match.",
    "For each: name (person or company), title (role, '' if unknown), company ('' if unknown),",
    "profileUrl (the SOURCE_URL the prospect came from), platform (e.g. 'web', or 'linkedin'/'facebook' if the URL is that site),",
    "and email — ONLY if an email address is VISIBLY present in the content, otherwise ''. Never invent emails.",
    "Skip navigation/listicles that aren't real prospects. Return ONLY JSON.",
  ].join("\n");
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
  const prospects = await extractProspects(icpText, results, target);
  // normalize: ensure a profileUrl/platform even if the model omitted them
  return prospects.map((p) => ({
    name: p.name, title: p.title ?? "", company: p.company ?? "",
    profileUrl: p.profileUrl || "", platform: p.platform || "web", email: p.email ?? "",
  }));
}
