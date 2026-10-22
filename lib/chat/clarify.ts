// Pure helpers for the team-chat "ask for a missing detail" clarifications.
// A scrape needs a target (what/who/where); a bare "find leads" has none, so the
// agent asks before it runs a weak search. No I/O, so unit tests can check it.

// Generic scrape verbs/nouns/platforms that carry no targeting on their own.
const SCRAPE_STOPWORDS = new Set([
  "find", "finds", "get", "gets", "grab", "pull", "scrape", "scrapes", "search", "source", "sourced", "fetch", "look", "looking", "lookup",
  "me", "us", "my", "some", "any", "a", "an", "the", "for", "of", "to", "and", "on", "in", "new", "more", "please", "can", "could", "would", "you", "go", "ahead", "now", "start", "started", "run", "do", "give",
  "lead", "leads", "prospect", "prospects", "customer", "customers", "buyer", "buyers", "seller", "sellers", "client", "clients", "people", "person", "contact", "contacts", "folks",
  "facebook", "fb", "reddit", "linkedin", "twitter", "instagram", "ig", "online", "web", "internet", "social", "media", "posts", "post",
]);

// The country, told apart from the pronoun "us" ("find us leads") by its capitals.
const US_PLACE = /(^|[^A-Za-z])(US|USA|U\.S\.(A\.?)?)(?![A-Za-z])/;

/** Does a scrape request name a target (what/who/where), or is it a bare command?
 *  A count alone ("find me 50 leads") is not a target. */
export function scrapeHasTarget(message: string): boolean {
  const text = (message || "").replace(/@[\w'-]+/g, " ");
  if (US_PLACE.test(text)) return true;
  const meaningful = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !/^\d+$/.test(t) && !SCRAPE_STOPWORDS.has(t));
  return meaningful.length > 0;
}

/** The clarifying question shown when a scrape request has no target. Kept as a
 *  stable, exact string so isAskScrapePrompt can detect the pending state. */
export function askScrapeText(): string {
  return `What should I look for? Tell me who or what to find, and where.`;
}

/** True if `text` is the scrape-target clarifying prompt (i.e. the agent is still
 *  waiting for the user to say what to search for). Threads from before the
 *  scrape brief still carry this exact text. */
export function isAskScrapePrompt(text: string): boolean {
  return text === askScrapeText();
}

/** What a scrape needs before it runs: who to find, where, and how many. Built up
 *  over the user's first message and their answers to the agent's questions. */
export interface ScrapeBrief {
  what?: string;
  /** A place, or "anywhere" when the user says location does not matter. */
  where?: string;
  count?: number;
  /** How many times the agent has asked. */
  asked?: number;
}

export type BriefField = "what" | "where" | "count";

/** Ask at most this many times. After that a missing place becomes "anywhere"
 *  and a missing count the default, so a vague user is never stuck in a loop. */
export const MAX_SCRAPE_ASKS = 2;
export const DEFAULT_SCRAPE_COUNT = 10;

export function missingBriefFields(b: ScrapeBrief): BriefField[] {
  const out: BriefField[] = [];
  if (!b.what?.trim()) out.push("what");
  if (!b.where?.trim()) out.push("where");
  if (!b.count || b.count < 1) out.push("count");
  return out;
}

/** Fill in the place and the count once the agent has asked enough. Who to find
 *  is never guessed. */
export function settleBrief(b: ScrapeBrief): ScrapeBrief {
  if ((b.asked ?? 0) < MAX_SCRAPE_ASKS) return b;
  return { ...b, where: b.where?.trim() || "anywhere", count: b.count && b.count > 0 ? b.count : DEFAULT_SCRAPE_COUNT };
}

/** Later values win, but an empty value never erases a known one. */
export function mergeBrief(base: ScrapeBrief, add: ScrapeBrief): ScrapeBrief {
  return {
    what: add.what?.trim() || base.what,
    where: add.where?.trim() || base.where,
    count: add.count && add.count > 0 ? add.count : base.count,
    asked: base.asked,
  };
}

/** Short labels and quick picks for the question card in the chat. */
export const BRIEF_LABEL: Record<BriefField, string> = {
  what: "Who should I look for?",
  where: "Where should I look?",
  count: "How many leads?",
};
export const BRIEF_OPTIONS: Record<BriefField, string[]> = {
  what: [],
  where: ["Anywhere", "United States", "United Kingdom", "Europe"],
  count: ["5", "10", "25"],
};

const BRIEF_QUESTION: Record<BriefField, string> = {
  what: "Who should I look for? Describe the buyer or the kind of company.",
  where: 'Where? A city, a country or a region. Say "anywhere" if location does not matter.',
  count: "How many leads do you want? Up to 25.",
};

/** One message that asks only for the missing details. The hidden ⟦scrape:…⟧
 *  marker (stripped in the chat UI) carries what is already known. */
export function askScrapeDetailsText(b: ScrapeBrief, missing: BriefField[], maxCount: number): string {
  const lead = `Before I start, I need ${missing.length === 1 ? (b.asked ? "one more detail" : "one detail") : "a few details"}.`;
  const qs = missing.map((f, i) => `${missing.length > 1 ? `${i + 1}. ` : ""}${BRIEF_QUESTION[f].replace("25", String(maxCount))}`);
  const state = encodeURIComponent(JSON.stringify({ ...b, asked: (b.asked ?? 0) + 1 }));
  return `${lead}\n${qs.join("\n")} ⟦scrape:${state}⟧`;
}

/** The brief in a ⟦scrape:…⟧ marker, or null. */
export function pendingScrapeBrief(text: string): ScrapeBrief | null {
  const m = text.match(/⟦scrape:([^⟧]*)⟧/);
  if (!m) return null;
  try {
    const raw = JSON.parse(decodeURIComponent(m[1])) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 300) : undefined);
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : undefined);
    return { what: str(raw.what), where: str(raw.where), count: num(raw.count), asked: num(raw.asked) ?? 1 };
  } catch {
    return null;
  }
}

/** The fields a ⟦scrape:…⟧ question asks for, or [] when `text` is not one. */
export function askedBriefFields(text: string): BriefField[] {
  const b = pendingScrapeBrief(text);
  return b ? missingBriefFields(b) : [];
}

/** The reply the question card sends: readable text plus a hidden ⟦answer:…⟧
 *  marker with the exact values, so the server needs no parsing. */
export function scrapeAnswerText(a: Partial<Record<BriefField, string>>): string {
  const parts = [a.what?.trim(), a.where?.trim(), a.count?.trim() ? `${a.count.trim()} leads` : ""].filter(Boolean);
  const state = encodeURIComponent(JSON.stringify({ what: a.what?.trim(), where: a.where?.trim(), count: Number(a.count) || undefined }));
  return `${parts.join(" · ")} ⟦answer:${state}⟧`;
}

/** The values in a ⟦answer:…⟧ marker, or null. The user writes this message, so
 *  every value is checked. It only changes the user's own scrape. */
export function scrapeAnswerFrom(text: string): ScrapeBrief | null {
  const m = text.match(/⟦answer:([^⟧]*)⟧/);
  if (!m) return null;
  try {
    const raw = JSON.parse(decodeURIComponent(m[1])) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 300) : undefined);
    const where = str(raw.where);
    const n = typeof raw.count === "number" && Number.isFinite(raw.count) ? Math.floor(raw.count) : 0;
    return { what: str(raw.what), where: where && /^any ?where$/i.test(where) ? "anywhere" : where, count: n > 0 ? n : undefined };
  } catch {
    return null;
  }
}

/** The agent's reply when a scrape starts: one line per detail, so nothing repeats. */
export function scrapeStartText(b: ScrapeBrief, count: number, maxCount: number): string {
  const what = (b.what ?? "").trim();
  const where = b.where?.trim();
  return [
    "Understood. I am starting the search:",
    `• Looking for: ${what.length > 160 ? what.slice(0, 157).trimEnd() + "…" : what}`,
    `• Where: ${!where || where.toLowerCase() === "anywhere" ? "Anywhere" : where}`,
    `• How many: ${count} lead${count === 1 ? "" : "s"}${b.count && b.count > maxCount ? ` (${maxCount} is the most per search)` : ""}`,
    "I will post the results here.",
  ].join("\n");
}

/** The search instruction for a complete brief. */
export function briefInstruction(b: ScrapeBrief): string {
  const where = b.where?.trim();
  return [b.what?.trim(), where && where.toLowerCase() !== "anywhere" ? `Location: ${where}.` : ""].filter(Boolean).join(". ").replace(/\.\./g, ".");
}

/** The "when?" clarifying prompt for a meeting. Carries the picked lead ids in a
 *  hidden ⟦meet:…⟧ marker (stripped in the chat UI) so the next reply can book. */
export function askWhenText(leadLabel: string, leadIds: string[]): string {
  return `When should I set the meeting with ${leadLabel}? ⟦meet:${leadIds.join(",")}⟧`;
}

/** The "what time?" prompt. It shows when a day is set but the user gave no clock time.
 *  The marker also carries the resolved date (ISO yyyy-mm-dd) so a bare time reply
 *  ("2pm") lands on the right day. */
export function askWhatTimeText(leadLabel: string, dayLabel: string, leadIds: string[], isoDate: string): string {
  return `What time on ${dayLabel} should I set the meeting with ${leadLabel}? ⟦meet:${leadIds.join(",")}|${isoDate}⟧`;
}

/** Extract the pending-meeting state from a ⟦meet:ids|date⟧ marker, or null.
 *  `date` (ISO yyyy-mm-dd) is present only once a day is chosen and we're waiting
 *  on the time; absent when we're still waiting on the day ("when?"). */
export function pendingMeeting(text: string): { leadIds: string[]; date?: string } | null {
  const m = text.match(/⟦meet:([^⟧]*)⟧/);
  if (!m) return null;
  const [idsPart, datePart] = m[1].split("|");
  const leadIds = (idsPart ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!leadIds.length) return null;
  const date = (datePart ?? "").trim();
  return { leadIds, date: date || undefined };
}

/** The "who?" clarifying prompt for a meeting, shown when a book-meeting request
 *  names no lead. Kept as a stable, exact string so isAskMeetingWhoPrompt can
 *  detect the pending state and treat the next reply as the lead answer. */
export function askMeetingWhoText(): string {
  return `Who should I set the meeting with?`;
}

/** True if `text` is the meeting "who?" prompt (the agent is still waiting for the
 *  user to say which lead to book). */
export function isAskMeetingWhoPrompt(text: string): boolean {
  return text === askMeetingWhoText();
}
