// Scraped profile URLs come from LLM output over public posts, so a prompt
// injection can plant `javascript:` or `data:` links. Only http(s) may be stored
// or opened.

/** The URL as normalised by the URL parser if it is http(s), otherwise null. */
export function safeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (!u.hostname) return null;
  return u.href;
}

/** Open an external link in a new tab without giving it `window.opener`
 *  (tab-nabbing) or a Referer. Does nothing for a non-http(s) URL. */
export function openExternal(raw: unknown): void {
  const url = safeHttpUrl(raw);
  if (url) window.open(url, "_blank", "noopener,noreferrer");
}
