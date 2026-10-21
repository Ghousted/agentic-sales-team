// LLM text, JSON and embeddings via OpenRouter's OpenAI-compatible REST API.
// No SDK — a single fetch keeps it dependency-free and edge/node friendly.
import "server-only";

const DEFAULT_MODEL = "google/gemini-2.5-flash";
const DEFAULT_BASE = "https://openrouter.ai/api/v1";
// OPENROUTER_BASE_URL points calls at an OpenAI-compatible gateway in front of OpenRouter.
const apiBase = () => (process.env.OPENROUTER_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "");

const authHeaders = (key: string) => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${key}`,
  // Optional attribution headers OpenRouter shows in its dashboard.
  "X-Title": "Agentic Sales Team",
});

export function isAIConfigured(): boolean {
  return !!process.env.OPENROUTER_API_KEY;
}

function apiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set.");
  return key;
}

export interface Turn {
  role: "user" | "model";
  text: string;
}

const GEN_TIMEOUT_MS = 30_000;

const toMessages = (system: string, turns: Turn[]) => [
  { role: "system", content: system },
  ...turns.map((t) => ({ role: t.role === "model" ? "assistant" : "user", content: t.text })),
];

async function chat(body: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${apiBase()}/chat/completions`, {
    method: "POST",
    headers: authHeaders(apiKey()),
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
      // Thinking counts against max_tokens and can truncate short replies —
      // turn it off for fast, complete answers.
      reasoning: { effort: "none" },
      ...body,
    }),
    cache: "no-store",
    // Never leave a chat hanging on a stalled request.
    signal: AbortSignal.timeout(GEN_TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OpenRouter ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  // OpenRouter can answer 200 with an error object when the upstream provider fails.
  if (data?.error) throw new Error(`OpenRouter: ${data.error.message || JSON.stringify(data.error).slice(0, 300)}`);
  const text: string | undefined = data?.choices?.[0]?.message?.content;
  return text?.trim() ?? "";
}

/** Generate a reply from a system prompt + prior turns. Returns the reply text. Throws on failure. */
export async function aiGenerate(system: string, turns: Turn[], opts?: { maxTokens?: number; temperature?: number }): Promise<string> {
  const text = await chat({
    messages: toMessages(system, turns),
    temperature: opts?.temperature ?? 0.7,
    max_tokens: opts?.maxTokens ?? 400,
  });
  if (!text) throw new Error("OpenRouter returned no text.");
  return text;
}

/** Generate JSON against a JSON schema. Returns the parsed object. Throws on failure. */
export async function aiJSON<T>(system: string, turns: Turn[], schema: Record<string, unknown>, opts?: { maxTokens?: number; temperature?: number }): Promise<T> {
  const text = await chat({
    messages: toMessages(system, turns),
    temperature: opts?.temperature ?? 0.6,
    max_tokens: opts?.maxTokens ?? 700,
    response_format: { type: "json_schema", json_schema: { name: "result", strict: false, schema } },
    // Only route to providers that honour response_format.
    provider: { require_parameters: true },
  });
  if (!text) throw new Error("OpenRouter returned no JSON text.");
  // Some providers wrap JSON in a markdown fence even in JSON mode.
  return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")) as T;
}

// gemini-embedding-001 defaults to 3072 dims; we ask for 768 to fit the
// products.embedding vector(768) column. Below 3072 its output is not unit
// length, so we normalize it ourselves.
export const EMBED_MODEL = "google/gemini-embedding-001";
export const EMBED_DIMS = 768;
const EMBED_TIMEOUT_MS = 20_000;
const EMBED_MAX_CHARS = 8000;
const EMBED_BATCH = 100;

export type EmbedTask = "search_document" | "search_query";

/** Validate dims and scale to unit length. Throws on a missing or wrong-sized vector. */
function toUnitVector(values: unknown): number[] {
  if (!Array.isArray(values) || values.length !== EMBED_DIMS) {
    throw new Error(`Embedding has ${Array.isArray(values) ? values.length : 0} dims, expected ${EMBED_DIMS}.`);
  }
  const norm = Math.hypot(...(values as number[]));
  if (!norm) throw new Error("Embedding is all zeros.");
  return (values as number[]).map((v) => v / norm);
}

/** One /embeddings call. Returns the vectors' raw values in input order. */
async function embedFetch(texts: string[], inputType: EmbedTask): Promise<unknown[]> {
  const res = await fetch(`${apiBase()}/embeddings`, {
    method: "POST",
    headers: authHeaders(apiKey()),
    body: JSON.stringify({
      model: EMBED_MODEL,
      input: texts.map((t) => t.slice(0, EMBED_MAX_CHARS)),
      dimensions: EMBED_DIMS,
      input_type: inputType,
      encoding_format: "float",
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OpenRouter embed ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  if (data?.error) throw new Error(`OpenRouter embed: ${data.error.message || JSON.stringify(data.error).slice(0, 300)}`);
  const out: unknown[] = new Array(texts.length).fill(undefined);
  for (const d of data?.data ?? []) out[d.index ?? 0] = d.embedding;
  return out;
}

/** Embed one text (768-dim, unit length). Throws on failure or when unconfigured. */
export async function aiEmbed(text: string, inputType: EmbedTask = "search_document"): Promise<number[]> {
  const [values] = await embedFetch([text], inputType);
  return toUnitVector(values);
}

export interface EmbedBatchResult {
  /** Aligned to the input; null where that text could not be embedded. */
  vectors: (number[] | null)[];
  /** First failure seen, if any text failed. */
  error?: string;
}

/** Embed many document texts in chunks of 100. Never throws; failures are reported in `error`. */
export async function aiEmbedBatch(texts: string[]): Promise<EmbedBatchResult> {
  const vectors: (number[] | null)[] = [];
  let error: string | undefined;
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const chunk = texts.slice(i, i + EMBED_BATCH);
    try {
      const values = await embedFetch(chunk, "search_document");
      for (const v of values) {
        try { vectors.push(toUnitVector(v)); }
        catch (e) { vectors.push(null); error ??= (e as Error).message; }
      }
    } catch (e) {
      for (let j = 0; j < chunk.length; j++) vectors.push(null);
      error ??= (e as Error).message;
    }
  }
  return { vectors, error };
}
