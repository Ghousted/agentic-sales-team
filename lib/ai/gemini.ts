// Google Gemini text generation via the REST generateContent endpoint.
// No SDK — a single fetch keeps it dependency-free and edge/node friendly.
import "server-only";

const DEFAULT_MODEL = "gemini-2.5-flash";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// The key goes in a header, never the URL, so it stays out of proxy and access logs.
const authHeaders = (key: string) => ({ "Content-Type": "application/json", "x-goog-api-key": key });

export function isGeminiConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

export interface Turn {
  role: "user" | "model";
  text: string;
}

const GEN_TIMEOUT_MS = 30_000;

/** Call Gemini with a system instruction + prior turns. Returns the reply text. Throws on failure. */
export async function geminiGenerate(system: string, turns: Turn[], opts?: { maxTokens?: number; temperature?: number }): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set.");
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const url = `${API_BASE}/${model}:generateContent`;

  const body = {
    system_instruction: { parts: [{ text: system }] },
    contents: turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
    generationConfig: {
      temperature: opts?.temperature ?? 0.7,
      maxOutputTokens: opts?.maxTokens ?? 400,
      // Gemini 2.5 "thinking" counts against the output budget and can truncate
      // short chat replies — disable it for fast, complete answers.
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: authHeaders(key),
    body: JSON.stringify(body),
    cache: "no-store",
    // Never leave a chat hanging on a stalled request.
    signal: AbortSignal.timeout(GEN_TIMEOUT_MS),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gemini ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  const text: string | undefined = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("");
  if (!text) throw new Error("Gemini returned no text.");
  return text.trim();
}

/** Call Gemini in JSON mode against a response schema. Returns the parsed object. Throws on failure. */
export async function geminiJSON<T>(system: string, turns: Turn[], schema: Record<string, unknown>, opts?: { maxTokens?: number; temperature?: number }): Promise<T> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set.");
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const url = `${API_BASE}/${model}:generateContent`;

  const body = {
    system_instruction: { parts: [{ text: system }] },
    contents: turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
    generationConfig: {
      temperature: opts?.temperature ?? 0.6,
      maxOutputTokens: opts?.maxTokens ?? 700,
      thinkingConfig: { thinkingBudget: 0 },
      responseMimeType: "application/json",
      responseSchema: schema,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: authHeaders(key),
    body: JSON.stringify(body),
    cache: "no-store",
    // Never leave a chat hanging on a stalled request.
    signal: AbortSignal.timeout(GEN_TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gemini ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  const text: string | undefined = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("");
  if (!text) throw new Error("Gemini returned no JSON text.");
  return JSON.parse(text) as T;
}

// text-embedding-004 was shut down on 2026-01-14. gemini-embedding-001 defaults
// to 3072 dims; we ask for 768 to fit the products.embedding vector(768) column.
// Below 3072 its output is not unit length, so we normalize it ourselves.
export const EMBED_MODEL = "gemini-embedding-001";
export const EMBED_DIMS = 768;
const EMBED_TIMEOUT_MS = 20_000;
const EMBED_MAX_CHARS = 8000;

export type EmbedTask = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

const embedRequest = (text: string, taskType: EmbedTask) => ({
  model: `models/${EMBED_MODEL}`,
  taskType,
  outputDimensionality: EMBED_DIMS,
  content: { parts: [{ text: text.slice(0, EMBED_MAX_CHARS) }] },
});

/** Validate dims and scale to unit length. Throws on a missing or wrong-sized vector. */
function toUnitVector(values: unknown): number[] {
  if (!Array.isArray(values) || values.length !== EMBED_DIMS) {
    throw new Error(`Gemini embedding has ${Array.isArray(values) ? values.length : 0} dims, expected ${EMBED_DIMS}.`);
  }
  const norm = Math.hypot(...(values as number[]));
  if (!norm) throw new Error("Gemini returned an all-zero embedding.");
  return (values as number[]).map((v) => v / norm);
}

async function embedFetch(method: "embedContent" | "batchEmbedContents", body: unknown) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set.");
  const res = await fetch(`${API_BASE}/${EMBED_MODEL}:${method}`, {
    method: "POST",
    headers: authHeaders(key),
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gemini embed ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res.json();
}

/** Embed one text (768-dim, unit length). Throws on failure or when unconfigured. */
export async function geminiEmbed(text: string, taskType: EmbedTask = "RETRIEVAL_DOCUMENT"): Promise<number[]> {
  const data = await embedFetch("embedContent", embedRequest(text, taskType));
  return toUnitVector(data?.embedding?.values);
}

export interface EmbedBatchResult {
  /** Aligned to the input; null where that text could not be embedded. */
  vectors: (number[] | null)[];
  /** First failure seen, if any text failed. */
  error?: string;
}

/** Embed many document texts in chunks of 100. Never throws; failures are reported in `error`. */
export async function geminiEmbedBatch(texts: string[]): Promise<EmbedBatchResult> {
  const vectors: (number[] | null)[] = [];
  let error: string | undefined;
  for (let i = 0; i < texts.length; i += 100) {
    const chunk = texts.slice(i, i + 100);
    try {
      const data = await embedFetch("batchEmbedContents", { requests: chunk.map((t) => embedRequest(t, "RETRIEVAL_DOCUMENT")) });
      for (let j = 0; j < chunk.length; j++) {
        try { vectors.push(toUnitVector(data?.embeddings?.[j]?.values)); }
        catch (e) { vectors.push(null); error ??= (e as Error).message; }
      }
    } catch (e) {
      for (let j = 0; j < chunk.length; j++) vectors.push(null);
      error ??= (e as Error).message;
    }
  }
  return { vectors, error };
}
