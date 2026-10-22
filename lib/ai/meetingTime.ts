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

/** The UTC instant of wall-clock `date` (yyyy-mm-dd) at `minutes` past midnight in `tz`. */
function zonedInstant(date: string, minutes: number, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d, 0, minutes);
  const offsetMs = (at: number) => {
    const o = utcOffset(new Date(at), tz).match(/([+-])(\d\d):(\d\d)/);
    return o ? (o[1] === "-" ? -1 : 1) * (Number(o[2]) * 60 + Number(o[3])) * 60_000 : 0;
  };
  // Look the offset up twice: the first guess can sit on the other side of a DST change.
  const guess = wall - offsetMs(wall);
  return new Date(wall - offsetMs(guess));
}

/** yyyy-mm-dd `n` days after yyyy-mm-dd `date`. */
function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";

/** Read a meeting phrase without AI: a day ("today", "tomorrow", "friday",
 *  "next tue", "oct 23", "23 october", "10/23", "2026-10-23") and/or a clock time
 *  ("2pm", "2:30 pm", "14:00", "at 3", "noon"). Days are wall-clock dates in
 *  `tz`; a bare hour 1–7 with no am/pm is read as afternoon (business hours).
 *  Returns null when the phrase names neither. */
export function parseMeetingPhrase(text: string, now: Date, tz: string): { date: string | null; minutes: number | null } | null {
  const t = text.toLowerCase();
  const today = zoned(now, tz);

  let minutes: number | null = null;
  const clock = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/) ?? t.match(/\b(\d{1,2}):(\d{2})\b/) ?? t.match(/\bat\s+(\d{1,2})\b(?!\s*[/-])/);
  if (/\b(noon|midday)\b/.test(t)) minutes = 12 * 60;
  else if (clock) {
    let h = Number(clock[1]);
    const min = Number(clock[2] ?? 0);
    const half = clock[3]?.[0];
    if (half === "p" && h < 12) h += 12;
    else if (half === "a" && h === 12) h = 0;
    else if (!half && h >= 1 && h <= 7) h += 12;
    if (h <= 23 && min <= 59) minutes = h * 60 + min;
  }

  let date: string | null = null;
  const iso = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  const named = t.match(new RegExp(`\\b${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?!:)`)) ?? t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}`));
  const slash = t.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  const weekday = t.match(/\b(sun|mon|tue|wed|thu|fri|sat)(?:day|s|sday|nesday|rs|rsday|urday)?\b/);
  const pad = (n: number) => String(n).padStart(2, "0");
  // A month/day with no year: this year, or next year once it has passed.
  const upcoming = (month: number, day: number) => {
    const y = Number(today.date.slice(0, 4));
    const d = `${y}-${pad(month)}-${pad(day)}`;
    return d < today.date ? `${y + 1}-${pad(month)}-${pad(day)}` : d;
  };
  if (iso) date = `${iso[1]}-${iso[2]}-${iso[3]}`;
  else if (/\btoday\b/.test(t)) date = today.date;
  else if (/\b(tomorrow|tmrw|tmr)\b/.test(t)) date = addDays(today.date, 1);
  else if (named) {
    const [mon, day] = isNaN(Number(named[1])) ? [named[1], named[2]] : [named[2], named[1]];
    date = upcoming(MONTHS.indexOf(mon.slice(0, 3)) + 1, Number(day));
  } else if (slash) date = upcoming(Number(slash[1]), Number(slash[2]));
  else if (weekday) {
    // The coming one; today only if the time (if given) hasn't passed yet.
    let n = (WEEKDAYS.indexOf(weekday[1]) - WEEKDAYS.indexOf(today.weekday.toLowerCase()) + 7) % 7;
    if (n === 0 && (/\bnext\b/.test(t) || (minutes !== null && minutes <= today.minutes))) n = 7;
    date = addDays(today.date, n);
  } else if (/\bnext week\b/.test(t)) {
    date = addDays(today.date, ((1 - WEEKDAYS.indexOf(today.weekday.toLowerCase()) + 7) % 7) || 7);
  }
  if (date && isNaN(Date.parse(`${date}T00:00:00Z`))) date = null;
  if (date === null && minutes === null) return null;
  return { date, minutes };
}

/** The AI reading of `text`: the model's iso + hasTime, or null when it fails. */
async function aiMeetingTime(text: string, now: Date, tz: string, ws: number, we: number, wk: boolean, dur: number): Promise<{ iso: string; hasTime: boolean } | null> {
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
    if (iso && isNaN(new Date(iso).getTime())) return null;
    return { iso, hasTime: r.hasTime === true };
  } catch (e) {
    console.error("[meetingTime] AI call failed, using the built-in parser:", e);
    return null;
  }
}

/** The built-in reading of `text`, in the same shape as the AI's. A clock time
 *  with no day is the soonest day it's still ahead on (a weekday if required). */
function plainMeetingTime(text: string, now: Date, tz: string, ws: number, wk: boolean): { iso: string; hasTime: boolean } {
  const p = parseMeetingPhrase(text, now, tz);
  if (!p) return { iso: "", hasTime: false };
  if (p.minutes === null) return { iso: zonedInstant(p.date!, ws * 60, tz).toISOString(), hasTime: false };
  let date = p.date;
  if (date === null) {
    date = zoned(now, tz).date;
    const ok = (d: string) => zonedInstant(d, p.minutes!, tz).getTime() > now.getTime()
      && !(wk && ["Sat", "Sun"].includes(zoned(zonedInstant(d, 12 * 60, tz), tz).weekday));
    for (let i = 0; i < 7 && !ok(date); i++) date = addDays(date, 1);
  }
  return { iso: zonedInstant(date, p.minutes, tz).toISOString(), hasTime: true };
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
  if (!text.trim()) return none;
  const now = new Date();
  const tz = safeTimeZone(opts?.timeZone);
  const ws = opts?.windowStart ?? 9, we = opts?.windowEnd ?? 17, wk = opts?.weekdaysOnly !== false, dur = opts?.duration ?? 30;
  // The model when it's configured and answers; the built-in parser otherwise,
  // so a booking never stalls on "when?" just because AI is off or down.
  const r = (isAIConfigured() ? await aiMeetingTime(text, now, tz, ws, we, wk, dur) : null) ?? plainMeetingTime(text, now, tz, ws, wk);
  const at = new Date(r.iso);
  if (!r.iso) return none;
  // The model is told the window; check it here too, in the user's timezone,
  // and never book a time (or a day) that has already passed.
  if (!inBookingWindow(r.iso, tz, r.hasTime, { windowStart: ws, windowEnd: we, weekdaysOnly: wk, duration: dur })) return none;
  if (r.hasTime && at.getTime() <= now.getTime()) return none;
  if (!r.hasTime && zonedDate(r.iso, tz) < zoned(now, tz).date) return none;
  return { iso: at.toISOString(), label: meetingLabel(r.iso, tz, dur), hasTime: r.hasTime };
}
