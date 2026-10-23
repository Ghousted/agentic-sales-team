// Pure helpers for a team chat thread. The DB (messages.id) is the only source
// of order: the client keeps the persisted rows sorted by id, fetches only rows
// past its cursor, and holds local-only rows (a sent message not yet back from
// the server, an error notice) after them. No I/O, so unit tests can check it.
import type { ChatMsg } from "@/lib/types";

/** A thread row. Persisted rows carry their messages.id; `local` rows exist
 *  only in this tab (an optimistic send, or a notice that is never stored). */
export type ThreadMsg = ChatMsg & { id?: number; local?: boolean };
export interface StoredMsg { id: number; who: string; text: string }

const idOf = (m: ChatMsg): number | undefined => (m as ThreadMsg).id;

/** The highest persisted id in a thread (0 when none). This is the poll cursor. */
export function threadCursor(msgs: ChatMsg[] | undefined): number {
  let max = 0;
  for (const m of msgs ?? []) { const id = idOf(m); if (id !== undefined && id > max) max = id; }
  return max;
}

/** Add persisted rows to a thread: rows are deduped by id and kept in id order,
 *  local rows follow them, and each stored "me" row replaces the oldest local
 *  "me" row with the same text (the optimistic copy of that send). */
export function mergeThread(current: ChatMsg[] | undefined, incoming: StoredMsg[]): ThreadMsg[] {
  const stored = new Map<number, ThreadMsg>();
  const local: ThreadMsg[] = [];
  for (const m of current ?? []) {
    const id = idOf(m);
    if (id !== undefined) stored.set(id, m as ThreadMsg);
    else local.push(m as ThreadMsg);
  }
  for (const r of incoming) {
    if (stored.has(r.id)) continue;
    stored.set(r.id, { id: r.id, who: r.who, text: r.text });
    if (r.who === "me") {
      const i = local.findIndex((l) => l.who === "me" && l.text === r.text);
      if (i >= 0) local.splice(i, 1);
    }
  }
  return [...stored.values()].sort((a, b) => a.id! - b.id!).concat(local);
}

/** The agent rows written since the user's last message, newest first. An open
 *  clarifying question ("who?", "when?") is one of these; narration that the pod
 *  chain posts in between doesn't hide it. */
export function sinceLastUserMessage<T extends { who: string }>(history: T[]): T[] {
  const out: T[] = [];
  for (let i = history.length - 1; i >= 0 && history[i].who !== "me"; i--) out.push(history[i]);
  return out;
}

/** Hidden ⟦…⟧ markers (approve, meet, job) are for the app, not the reader. */
export function stripMarkers(text: string): string {
  return text.replace(/⟦[^⟧]*⟧/g, "").trim();
}

/** The marker that makes a job's outcome message idempotent. */
export function jobMarker(jobId: string): string {
  return `⟦job:${jobId}⟧`;
}

/** The marker that puts a scrape results card under a message. */
export function leadsMarker(ids: string[] | undefined): string {
  return ids && ids.length ? ` ⟦leads:${ids.join(",")}⟧` : "";
}

/** The lead ids in a ⟦leads:…⟧ marker, or []. */
export function leadIdsFrom(text: string): string[] {
  const m = text.match(/⟦leads:([^⟧]*)⟧/);
  return m ? m[1].split(",").filter((id) => /^[0-9a-f-]{36}$/i.test(id)) : [];
}

/** "I'm currently …": what a job of this kind is doing. */
export function workDoing(kind: string): string {
  switch (kind) {
    case "scrape": return "finding leads";
    case "assess": return "reviewing the new leads";
    case "research": return "researching the team's leads";
    case "qualify": return "qualifying the leads";
    case "match": return "matching leads to listings";
    case "outreach": return "drafting outreach";
    case "proposal": return "drafting proposals";
    default: return kind;
  }
}

/** "I've just finished …: <this>": the result of a finished job, by kind. Each
 *  kind reads its own result count, so a qualify run never says "0 emails". */
export function workDoneSummary(kind: string, result: unknown): string {
  const r = (result ?? {}) as Record<string, number | undefined>;
  const n = (k: string) => r[k] ?? 0;
  const s = (k: string) => (n(k) === 1 ? "" : "s");
  switch (kind) {
    case "scrape": return `found ${n("leadsFound")} lead${s("leadsFound")}, waiting for your review`;
    case "assess": return `accepted ${n("accepted")} lead${s("accepted")}`;
    case "research": return `researched ${n("briefed")} lead${s("briefed")}`;
    case "qualify": return `qualified ${n("qualified")} lead${s("qualified")}`;
    case "match": return `matched ${n("matched")} lead${s("matched")} to your catalog`;
    case "outreach": return `drafted ${n("draftsCreated")} email${s("draftsCreated")}, ready for you to review and send`;
    case "proposal": return `drafted ${n("proposals")} proposal${s("proposals")}, ready for you to review`;
    default: return "completed my last task";
  }
}

/** What the agent says in the thread when a job it started from chat ends.
 *  Null when there is nothing to say: a pod scrape that finished is narrated by
 *  the chain (chainNext), so a second "found N leads" would duplicate it. */
export function jobOutcomeText(kind: string, status: string, result: unknown, pod: boolean): string | null {
  if (status === "failed") return kind === "scrape" ? "That search didn't complete. Please try again." : "That run didn't complete. Please check the agent's page.";
  if (status !== "done") return null;
  const r = (result ?? {}) as Record<string, number | undefined> & { leadIds?: string[] };
  const n = (k: string) => r[k] ?? 0;
  const s = (k: string) => (n(k) === 1 ? "" : "s");
  switch (kind) {
    case "scrape": return pod ? null : `I found ${n("leadsFound")} lead${s("leadsFound")}.${leadsMarker(r.leadIds)}`;
    case "research": return `I've researched ${n("briefed")} lead${s("briefed")}.`;
    case "match": return `I matched ${n("matched")} lead${s("matched")} to your catalog.`;
    case "qualify": return `I've qualified ${n("qualified")} lead${s("qualified")}.`;
    case "proposal": return `I've drafted ${n("proposals")} proposal${s("proposals")}, ready for you to review.`;
    case "assess": return `I've accepted ${n("accepted")} lead${s("accepted")}.`;
    case "outreach": return `I've drafted ${n("draftsCreated")} email${s("draftsCreated")}, ready for you to review and send.`;
    default: return "Done.";
  }
}
