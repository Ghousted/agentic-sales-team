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
 *  waiting for the user to say what to search for). */
export function isAskScrapePrompt(text: string): boolean {
  return text === askScrapeText();
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
