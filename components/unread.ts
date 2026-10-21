// Sidebar unread state. Messages carry no id or timestamp, so "read" is the
// number of messages in a conversation the user has seen. Kept per user in
// localStorage; it is a convenience, so storage failures just mean no dots.
import type { ChatMsg, Chats } from "@/lib/types";

export type ReadCounts = Record<string, number>;

const PREFIX = "ast.read:";

// True when an agent message arrived after the last one the user saw.
export function hasUnread(msgs: ChatMsg[] | undefined, read: number | undefined): boolean {
  if (!msgs || msgs.length === 0) return false;
  const seen = read === undefined || read > msgs.length ? msgs.length : read;
  return msgs.slice(seen).some((m) => m.who !== "me");
}

// Read counts after a sync: unknown or cleared conversations are taken as read
// up to now, and the open conversation (if any) is marked read.
export function syncRead(read: ReadCounts, chats: Chats, openId: string | null): ReadCounts {
  const next: ReadCounts = { ...read };
  for (const [id, msgs] of Object.entries(chats)) {
    const n = msgs?.length ?? 0;
    if (next[id] === undefined || next[id] > n || id === openId) next[id] = n;
  }
  return next;
}

export function sameRead(a: ReadCounts, b: ReadCounts): boolean {
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
}

export function loadRead(user: string): ReadCounts {
  try {
    const raw = localStorage.getItem(PREFIX + user);
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export function saveRead(user: string, read: ReadCounts): void {
  try { localStorage.setItem(PREFIX + user, JSON.stringify(read)); } catch { /* storage unavailable */ }
}
