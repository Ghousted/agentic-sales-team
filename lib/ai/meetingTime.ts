import "server-only";
// Parse a natural-language meeting time ("tomorrow 2pm", "next Tue 10am") into
// an ISO datetime + a human label, relative to now. One LLM JSON call.
import { aiJSON, isAIConfigured, type Turn } from "./openrouter";

const SCHEMA = {
  type: "object",
  properties: { iso: { type: "string" }, label: { type: "string" }, hasTime: { type: "boolean" } },
  required: ["iso", "label", "hasTime"],
} as const;

/** Parse a natural-language meeting time.
 *  - `iso: ""`            → no usable date at all (→ ask "when?").
 *  - `iso` set, `hasTime` false → a day was given but no clock time (iso is the
 *    day defaulted to the window start; → ask "what time?").
 *  - `iso` set, `hasTime` true  → a full date+time (→ book it).
 *  Honors the booking window (hours + weekdays) and shows the duration in the label. */
export async function parseMeetingTime(
  text: string,
  opts?: { windowStart?: number; windowEnd?: number; weekdaysOnly?: boolean; duration?: number },
): Promise<{ iso: string; label: string; hasTime: boolean }> {
  if (!isAIConfigured() || !text.trim()) return { iso: "", label: "", hasTime: false };
  const now = new Date();
  const ws = opts?.windowStart ?? 9, we = opts?.windowEnd ?? 17, wk = opts?.weekdaysOnly !== false, dur = opts?.duration ?? 30;
  const system = [
    `The current date and time is ${now.toString()} (ISO ${now.toISOString()}).`,
    "Convert the user's phrase into a single upcoming meeting time.",
    `Only schedule between ${ws}:00 and ${we}:00${wk ? " and only on weekdays (Mon-Fri)" : ""}. If the requested time is outside that window, move it to the nearest valid slot (bump an early/late time to ${ws}:00, a weekend to the next weekday).`,
    `The meeting lasts ${dur} minutes.`,
    `Return JSON { iso, label, hasTime }:`,
    `- iso = an ISO 8601 datetime with a timezone offset (assume the current timezone; soonest sensible FUTURE match within the window; default ${ws}:00 if only a date is given).`,
    `- label = a short human label showing start–end, like 'Tue, Jul 15 · 2:00–2:30 PM'.`,
    `- hasTime = true ONLY if the phrase names a specific clock time (e.g. '2pm', '14:00', 'at 3', 'noon'). false if it gives only a day/date (e.g. 'thursday', 'next week', 'the 15th') or a vague part of day ('morning', 'afternoon').`,
    "If the phrase contains no usable date at all, return iso as an empty string and hasTime false.",
  ].join("\n");
  try {
    const r = await aiJSON<{ iso: string; label: string; hasTime: boolean }>(system, [{ role: "user", text }] as Turn[], SCHEMA as unknown as Record<string, unknown>, { maxTokens: 120, temperature: 0 });
    const iso = (r.iso ?? "").trim();
    if (!iso || isNaN(new Date(iso).getTime())) return { iso: "", label: "", hasTime: false };
    return { iso, label: (r.label ?? "").trim() || new Date(iso).toLocaleString(), hasTime: r.hasTime === true };
  } catch {
    return { iso: "", label: "", hasTime: false };
  }
}
