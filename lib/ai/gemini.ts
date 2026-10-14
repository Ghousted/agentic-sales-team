// Google Gemini text generation via the REST generateContent endpoint.
// No SDK — a single fetch keeps it dependency-free and edge/node friendly.
import "server-only";

const DEFAULT_MODEL = "gemini-2.5-flash";

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
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

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
    headers: { "Content-Type": "application/json" },
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
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

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
    headers: { "Content-Type": "application/json" },
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

/** Embed text with Gemini text-embedding-004 (768-dim). Returns null if unconfigured or on failure. */
export async function geminiEmbed(text: string): Promise<number[] | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${key}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: { parts: [{ text: text.slice(0, 8000) }] } }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    const values = data?.embedding?.values;
    return Array.isArray(values) && values.length ? (values as number[]) : null;
  } catch {
    return null;
  }
}

/** Embed many texts with text-embedding-004. Returns an array aligned to input (null per failed item). Chunks of 100. */
export async function geminiEmbedBatch(texts: string[]): Promise<(number[] | null)[]> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return texts.map(() => null);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents?key=${key}`;
  const out: (number[] | null)[] = [];
  for (let i = 0; i < texts.length; i += 100) {
    const chunk = texts.slice(i, i + 100);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requests: chunk.map((t) => ({ model: "models/text-embedding-004", content: { parts: [{ text: t.slice(0, 8000) }] } })) }),
        cache: "no-store",
      });
      if (!res.ok) { for (let j = 0; j < chunk.length; j++) out.push(null); continue; }
      const data = await res.json();
      const embs = data?.embeddings;
      for (let j = 0; j < chunk.length; j++) { const v = embs?.[j]?.values; out.push(Array.isArray(v) && v.length ? (v as number[]) : null); }
    } catch { for (let j = 0; j < chunk.length; j++) out.push(null); }
  }
  return out;
}
