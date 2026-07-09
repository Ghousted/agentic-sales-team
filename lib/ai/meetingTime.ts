import "server-only";
// Parse a natural-language meeting time ("tomorrow 2pm", "next Tue 10am") into
// an ISO datetime + a human label, relative to now. One Gemini JSON call.
import { geminiJSON, isGeminiConfigured, type Turn } from "./gemini";

const SCHEMA = {
  type: "object",
  properties: { iso: { type: "string" }, label: { type: "string" } },
  required: ["iso", "label"],
} as const;

/** Returns { iso: "" } when the phrase has no usable date/time (→ ask again). */
export async function parseMeetingTime(text: string): Promise<{ iso: string; label: string }> {
  if (!isGeminiConfigured() || !text.trim()) return { iso: "", label: "" };
  const now = new Date();
  const system = [
    `The current date and time is ${now.toString()} (ISO ${now.toISOString()}).`,
    "Convert the user's phrase into a single upcoming meeting time.",
    "Return JSON { iso, label }: iso = an ISO 8601 datetime with a timezone offset (assume the current timezone; choose the soonest sensible FUTURE match; default 10:00 AM if only a date is given); label = a short human label like 'Tue, Jul 15 · 2:00 PM'.",
    "If the phrase contains no usable date or time, return iso as an empty string.",
  ].join("\n");
  try {
    const r = await geminiJSON<{ iso: string; label: string }>(system, [{ role: "user", text }] as Turn[], SCHEMA as unknown as Record<string, unknown>, { maxTokens: 120, temperature: 0 });
    const iso = (r.iso ?? "").trim();
    if (!iso || isNaN(new Date(iso).getTime())) return { iso: "", label: "" };
    return { iso, label: (r.label ?? "").trim() || new Date(iso).toLocaleString() };
  } catch {
    return { iso: "", label: "" };
  }
}
