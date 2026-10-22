// Sidebar unread state. "Seen" is the id of the last message the user saw in
// each conversation. The server counts the agent messages after it, so the
// badges also update for messages agents post while their chat is closed.
// Kept per user in localStorage; it is a convenience, so storage failures just
// mean no badges.

export type SeenIds = Record<string, number>;
export type ChatHeads = Record<string, { lastId: number; unread: number }>;

// Ids, not counts (the old "ast.read:" key), so a new key.
const PREFIX = "ast.seen:";

/** Seen ids after a poll: a conversation seen for the first time counts as read
 *  up to now, and so does each conversation in `markRead` (open or just left). */
export function syncSeen(seen: SeenIds, heads: ChatHeads, markRead: (string | null)[]): SeenIds {
  const next: SeenIds = { ...seen };
  for (const [id, h] of Object.entries(heads)) {
    if (next[id] === undefined || markRead.includes(id)) next[id] = h.lastId;
  }
  return next;
}

/** Unread count per conversation, 0 for the ones in `markRead`. */
export function unreadCounts(heads: ChatHeads, markRead: (string | null)[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, h] of Object.entries(heads)) out[id] = markRead.includes(id) ? 0 : h.unread;
  return out;
}

/** Badge text: the count, capped so it fits. */
export function badgeText(n: number): string {
  return n > 99 ? "99+" : String(n);
}

export function sameSeen(a: SeenIds, b: SeenIds): boolean {
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
}

export function loadSeen(user: string): SeenIds {
  try {
    const raw = localStorage.getItem(PREFIX + user);
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export function saveSeen(user: string, seen: SeenIds): void {
  try { localStorage.setItem(PREFIX + user, JSON.stringify(seen)); } catch { /* storage unavailable */ }
}
