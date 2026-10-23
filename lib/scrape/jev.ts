import "server-only";
// Buyer/seller gate for scrape results. The extraction LLM reads ~40 results in one
// prompt and let seller posts through ("At ZaranTech, we build corporate AI
// training..." came back as a buyer). This gate judges each result on its own,
// before extraction, on OpenRouter's Jev Router: TypeSafe's Jev picks the model for
// each request, and that model writes the JSON answer.
// Fails open: when a call fails or the time budget runs out, the result is kept.
import { aiJSON, isAIConfigured } from "@/lib/ai/openrouter";
import { untrusted, UNTRUSTED_RULE } from "@/lib/ai/untrusted";
import { AGENCY_RULE, JOB_AD_RULE } from "./rules";

export interface GateResult { title?: string; description?: string; url?: string }

export const GATE_MODEL = "typesafe/jev-router";
const GATE_TIMEOUT_MS = 8_000;
/** ~3s per call, so 16 at a time checks ~48 results inside the budget. */
const GATE_CONCURRENCY = 16;
/** The whole gate, inside the 45s scrape deadline (searches 15s, extraction after).
 *  Results not checked in time are kept. */
export const GATE_BUDGET_MS = 10_000;

type Mode = "intent" | "fit";
export interface GateAnswer { side?: string; competitor?: boolean }

const SCHEMAS: Record<Mode, Record<string, unknown>> = {
  intent: {
    type: "object",
    properties: { side: { type: "string", enum: ["buyer", "seller", "job_seeker", "other"] } },
    required: ["side"],
  },
  fit: {
    type: "object",
    properties: { competitor: { type: "boolean" } },
    required: ["competitor"],
  },
};

function systemFor(mode: Mode, sells: string, wants: string): string {
  const context = [
    sells ? `The salesperson sells: ${sells}.` : "",
    `The salesperson is looking for: ${wants}.`,
  ].filter(Boolean).join("\n");
  if (mode === "fit") {
    return [
      context,
      "You get ONE LinkedIn search result (a company page or a person's profile).",
      "competitor: true if this company or person offers, advertises or delivers the same kind of product or service as the salesperson (a competitor, agency, consultant or vendor of it). false if they would buy or use it, or are in a different business.",
      AGENCY_RULE,
      "Return JSON { competitor }.",
      UNTRUSTED_RULE,
    ].join("\n");
  }
  return [
    context,
    "You get ONE public post. Judge what its AUTHOR wants. Read the whole snippet, not just the first words.",
    "side:",
    "- buyer: the author wants to buy, hire or find this kind of product or service, or asks for a recommendation for it.",
    "- seller: the author offers, promotes or advertises their own product or service of this kind, or describes what their company provides ('At <company>, we build ...', 'DM me', 'we help teams ...').",
    "- job_seeker: the author is looking for a job, asks where the jobs are, or shares job openings they don't hire for.",
    "- other: news, an article, an opinion, a discussion, any other job post, or a question with no wish to buy.",
    JOB_AD_RULE,
    AGENCY_RULE,
    "Return JSON { side }.",
    UNTRUSTED_RULE,
  ].join("\n");
}

/** True to keep the result. Only a clear seller, job seeker or competitor is
 *  dropped. An 'other' post goes on to extraction, which has its own rules for
 *  articles. Job seekers are dropped here because extraction let them through
 *  as hiring businesses. */
export function keepByAnswer(mode: Mode, a: GateAnswer): boolean {
  return mode === "fit" ? a.competitor !== true : a.side !== "seller" && a.side !== "job_seeker";
}

/** Drop the results the gate judges to be on the wrong side: sellers in intent
 *  mode, competitors in fit mode. Keeps the input order. */
export async function gateResults<T extends GateResult>(
  results: T[],
  ctx: { mode: Mode; sells: string; wants: string },
): Promise<T[]> {
  if (!isAIConfigured() || results.length === 0) return results;
  const system = systemFor(ctx.mode, ctx.sells, ctx.wants);
  const keep = new Array<boolean>(results.length).fill(true);
  let failures = 0;
  let next = 0;
  const deadline = Date.now() + GATE_BUDGET_MS;
  const worker = async () => {
    while (next < results.length) {
      const left = deadline - Date.now();
      if (left <= 0) return;
      const i = next++;
      const r = results[i];
      const text = untrusted(`URL: ${r.url ?? ""}\nTITLE: ${r.title ?? ""}\nSNIPPET: ${(r.description ?? "").slice(0, 600)}`);
      try {
        const a = await aiJSON<GateAnswer>(system, [{ role: "user", text }], SCHEMAS[ctx.mode], {
          model: GATE_MODEL, maxTokens: 60, temperature: 0, timeoutMs: Math.min(GATE_TIMEOUT_MS, left),
        });
        keep[i] = keepByAnswer(ctx.mode, a);
      } catch { failures++; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(GATE_CONCURRENCY, results.length) }, worker));
  const unchecked = results.length - Math.min(next, results.length);
  if (failures || unchecked) console.error(`[jev] ${failures} checks failed and ${unchecked} ran out of time, of ${results.length}; kept those results`);
  return results.filter((_, i) => keep[i]);
}
