// Reply pacing for the team chat. Each agent row is revealed after REPLY_MS
// behind a typing indicator, and the first reply to the user's message waits
// until at least MIN_REPLY_MS after they pressed send, so a fast server reply
// doesn't pop in before the user has finished reading their own message.

/** Shortest time from the user's send to the first agent reply. */
export const MIN_REPLY_MS = 2000;

/** Typing time before an agent's next row when it keeps talking. */
export const REPLY_MS = 1000;

/** Typing time before a different agent speaks, e.g. answering a hand-off.
 *  The server stores a hand-off and its answer well under a second apart. */
export const NEW_SPEAKER_MS = 2000;

/** How long to show the typing indicator before revealing an agent row.
 *  sinceSendMs is the time since the user's send this row answers, or null
 *  when it answers no fresh send (a later row, or a pod-chain hand-off).
 *  newSpeaker is true when the previous agent row was another agent's. */
export function revealWait(sinceSendMs: number | null, newSpeaker = false): number {
  const base = newSpeaker ? NEW_SPEAKER_MS : REPLY_MS;
  return sinceSendMs === null ? base : Math.max(base, MIN_REPLY_MS - sinceSendMs);
}

/** Pause with no typing indicator before an agent starts typing, so the dots
 *  don't appear the moment the previous row lands. None for the first reply to
 *  a send: the waiting dots are already showing and hand straight over. */
export const NEW_SPEAKER_PAUSE_MS = 1000;
export const SAME_SPEAKER_PAUSE_MS = 400;

export function thinkPause(sinceSendMs: number | null, newSpeaker: boolean): number {
  if (sinceSendMs !== null) return 0;
  return newSpeaker ? NEW_SPEAKER_PAUSE_MS : SAME_SPEAKER_PAUSE_MS;
}

/** The agent who spoke last in a thread, or null when no agent has. */
export function lastAgent(rows: { who: string }[] | undefined): string | null {
  for (let i = (rows?.length ?? 0) - 1; i >= 0; i--) {
    const w = rows![i].who;
    if (w !== "me" && w !== "system") return w;
  }
  return null;
}

// When the user last sent in each team thread, waiting for its first reply.
const sentAt = new Map<string, number>();

/** Record a send, so the thread's next agent row is held to MIN_REPLY_MS. */
export function markSent(teamId: string, now = Date.now()): void {
  sentAt.set(teamId, now);
}

/** Time since the thread's unanswered send, and forget it: only the first
 *  reply is held. Null when there is no unanswered send. */
export function takeSinceSent(teamId: string, now = Date.now()): number | null {
  const t = sentAt.get(teamId);
  if (t === undefined) return null;
  sentAt.delete(teamId);
  return Math.max(0, now - t);
}
