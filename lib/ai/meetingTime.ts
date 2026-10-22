import "server-only";
// Parse a natural-language meeting time ("tomorrow 2pm", "next Tue 10am") into
// an ISO datetime + a human label, relative to now in the user's timezone. One
// LLM JSON call; the booking window and the label are then checked and built
// here, in that timezone, so neither depends on the server's clock zone.
import { aiJSON, isAIConfigured, type Turn } from "./openrouter";

const SCHEMA = {
  type: "object",
  properties: { iso: { type: "string" }, hasTime: { type: "boolean" } },
  required: ["iso", "hasTime"],
} as const;

/** `tz` when it's a timezone Intl knows (the client sends it, so it's untrusted), else "UTC". */
export function safeTimeZone(tz?: string | null): string {
  if (!tz || typeof tz !== "string" || tz.length > 64) return "UTC";
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz }).resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

/** The wall-clock parts of `d` in `tz`. */
function zoned(d: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", weekday: "short",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    weekday: get("weekday"),
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

/** `tz`'s UTC offset at `d`, like "-04:00" ("+00:00" for UTC). */
function utcOffset(d: Date, tz: string): string {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" })
    .formatToParts(d).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  return name.replace("GMT", "") || "+00:00";
}

/** The calendar date (yyyy-mm-dd) of `iso` in `tz`. */
export function zonedDate(iso: string, tz: string): string {
  return zoned(new Date(iso), tz).date;
}

/** "Tue, Jul 15" for `iso` in `tz`. */
export function dayLabel(iso: string, tz: string): string {
  return new Date(iso).toLocaleDateString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" });
}

/** "Tue, Jul 15 · 2:00–2:30 PM" for a meeting starting at `iso`, in `tz`. */
export function meetingLabel(iso: string, tz: string, duration: number): string {
  const start = new Date(iso);
  const end = new Date(start.getTime() + duration * 60_000);
  const time = (d: Date, ampm: boolean) => {
    const s = d.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
    return ampm ? s : s.replace(/\s?[AP]M$/, "");
  };
  const sameHalf = time(start, true).slice(-2) === time(end, true).slice(-2);
  return `${dayLabel(iso, tz)} · ${time(start, !sameHalf)}–${time(end, true)}`;
}

/** Whether a meeting at `iso` falls inside the booking window, judged in `tz`:
 *  on a weekday (when required) and, when a clock time was given, starting no
 *  earlier than windowStart and ending by windowEnd. */
export function inBookingWindow(
  iso: string, tz: string, hasTime: boolean,
  w: { windowStart: number; windowEnd: number; weekdaysOnly: boolean; duration: number },
): boolean {
  const z = zoned(new Date(iso), tz);
  if (w.weekdaysOnly && (z.weekday === "Sat" || z.weekday === "Sun")) return false;
  if (!hasTime) return true;
  return z.minutes >= w.windowStart * 60 && z.minutes + w.duration <= w.windowEnd * 60;
}

/** Parse a natural-language meeting time in the user's timezone `tz`.
 *  - `iso: ""`            → no usable date at all, or one outside the booking
 *    window or in the past (→ ask "when?").
 *  - `iso` set, `hasTime` false → a day was given but no clock time (iso is the
 *    day defaulted to the window start; → ask "what time?").
 *  - `iso` set, `hasTime` true  → a full date+time (→ book it).
 *  Honors the booking window (hours + weekdays); the label (start–end, in `tz`) is built here. */
export async function parseMeetingTime(
  text: string,
  opts?: { windowStart?: number; windowEnd?: number; weekdaysOnly?: boolean; duration?: number; timeZone?: string },
): Promise<{ iso: string; label: string; hasTime: boolean }> {
  const none = { iso: "", label: "", hasTime: false };
  if (!isAIConfigured() || !text.trim()) return none;
  const now = new Date();
  const tz = safeTimeZone(opts?.timeZone);
  const ws = opts?.windowStart ?? 9, we = opts?.windowEnd ?? 17, wk = opts?.weekdaysOnly !== false, dur = opts?.duration ?? 30;
  const local = now.toLocaleString("en-US", {
    timeZone: tz, weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "longOffset",
  });
  // The next two weeks spelled out, so the model looks weekdays and UTC offsets
  // (which change at DST) up instead of working them out.
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(now.getTime() + (i + 1) * 86_400_000);
    return `${zoned(d, tz).weekday} ${zoned(d, tz).date} (UTC${utcOffset(d, tz)})`;
  }).join(", ");
  const system = [
    `The user's timezone is ${tz}. Their current local date and time is ${local} (ISO ${now.toISOString()}).`,
    `The coming days in the user's timezone: ${days}.`,
    "Convert the user's phrase into a single upcoming meeting time, read in the user's timezone.",
    `Only schedule between ${ws}:00 and ${we}:00${wk ? " and only on weekdays (Mon-Fri)" : ""} in the user's timezone. If the requested time is outside that window, move it to the nearest valid slot (bump an early/late time to ${ws}:00, a weekend to the next weekday).`,
    `The meeting lasts ${dur} minutes.`,
    `Return JSON { iso, hasTime }:`,
    `- iso = an ISO 8601 datetime with the user's UTC offset for that date (e.g. 2026-07-15T14:00:00-04:00; soonest sensible FUTURE match within the window; default ${ws}:00 if only a date is given).`,
    `- hasTime = true ONLY if the phrase names a specific clock time (e.g. '2pm', '14:00', 'at 3', 'noon'). false if it gives only a day/date (e.g. 'thursday', 'next week', 'the 15th') or a vague part of day ('morning', 'afternoon').`,
    "If the phrase contains no usable date at all, return iso as an empty string and hasTime false.",
  ].join("\n");
  try {
    const r = await aiJSON<{ iso: string; hasTime: boolean }>(system, [{ role: "user", text }] as Turn[], SCHEMA as unknown as Record<string, unknown>, { maxTokens: 120, temperature: 0 });
    const iso = (r.iso ?? "").trim();
    const at = new Date(iso);
    if (!iso || isNaN(at.getTime())) return none;
    const hasTime = r.hasTime === true;
    // The model is told the window; check it here too, in the user's timezone,
    // and never book a time that has already passed.
    if (!inBookingWindow(iso, tz, hasTime, { windowStart: ws, windowEnd: we, weekdaysOnly: wk, duration: dur })) return none;
    if (hasTime && at.getTime() <= now.getTime()) return none;
    return { iso: at.toISOString(), label: meetingLabel(iso, tz, dur), hasTime };
  } catch {
    return none;
  }
}
