import "server-only";
// Parse a natural-language meeting time ("tomorrow 2pm", "next Tue 10am") into
// an ISO datetime + a human label, relative to now. One Gemini JSON call.
import { geminiJSON, isGeminiConfigured, type Turn } from "./gemini";

const SCHEMA = {
  type: "object",
  properties: { iso: { type: "string" }, label: { type: "string" } },
  required: ["iso", "label"],
} as const;

/** Returns { iso: "" } when the phrase has no usable date/time (→ ask again).
 *  Honors the booking window (hours + weekdays) and shows the duration in the label. */
export async function parseMeetingTime(
  text: string,
  opts?: { windowStart?: number; windowEnd?: number; weekdaysOnly?: boolean; duration?: number },
): Promise<{ iso: string; label: string }> {
  if (!isGeminiConfigured() || !text.trim()) return { iso: "", label: "" };
  const now = new Date();
  const ws = opts?.windowStart ?? 9, we = opts?.windowEnd ?? 17, wk = opts?.weekdaysOnly !== false, dur = opts?.duration ?? 30;
  const system = [
    `The current date and time is ${now.toString()} (ISO ${now.toISOString()}).`,
    "Convert the user's phrase into a single upcoming meeting time.",
    `Only schedule between ${ws}:00 and ${we}:00${wk ? " and only on weekdays (Mon-Fri)" : ""}. If the requested time is outside that window, move it to the nearest valid slot (bump an early/late time to ${ws}:00, a weekend to the next weekday).`,
    `The meeting lasts ${dur} minutes.`,
    `Return JSON { iso, label }: iso = an ISO 8601 datetime with a timezone offset (assume the current timezone; soonest sensible FUTURE match within the window; default ${ws}:00 if only a date is given); label = a short human label showing start–end, like 'Tue, Jul 15 · 2:00–2:30 PM'.`,
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
