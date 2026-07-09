// Pure helpers for the team-chat "ask for a missing detail" clarifications.
// A scrape needs a target (what/who/where); a bare "find leads" has none, so the
// agent asks before running a weak search. No I/O — unit-checkable.

// Generic scrape verbs/nouns/platforms that carry no targeting on their own.
const SCRAPE_STOPWORDS = new Set([
  "find", "finds", "get", "gets", "grab", "pull", "scrape", "scrapes", "search", "source", "sourced", "fetch", "look", "looking", "lookup",
  "me", "us", "my", "some", "any", "a", "an", "the", "for", "of", "to", "and", "on", "in", "new", "more", "please", "can", "could", "would", "you", "go", "ahead", "now", "start", "started", "run", "do", "give",
  "lead", "leads", "prospect", "prospects", "customer", "customers", "buyer", "buyers", "seller", "sellers", "client", "clients", "people", "person", "contact", "contacts", "folks",
  "facebook", "fb", "reddit", "linkedin", "twitter", "instagram", "ig", "online", "web", "internet", "social", "media", "posts", "post",
]);

/** Does a scrape request name a target (what/who/where), or is it a bare command? */
export function scrapeHasTarget(message: string): boolean {
  const meaningful = (message || "")
    .replace(/@[\w'-]+/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !SCRAPE_STOPWORDS.has(t));
  return meaningful.length > 0;
}

/** The clarifying question shown when a scrape request has no target. Kept as a
 *  stable, exact string so isAskScrapePrompt can detect the pending state. */
export function askScrapeText(): string {
  return `What should I look for? Tell me who or what to find and where — for example, "property buyers in Makati" or "startups hiring SDRs in the US".`;
}

/** True if `text` is the scrape-target clarifying prompt (i.e. the agent is still
 *  waiting for the user to say what to search for). */
export function isAskScrapePrompt(text: string): boolean {
  return text === askScrapeText();
}
