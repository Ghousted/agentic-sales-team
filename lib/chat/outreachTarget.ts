// Pure helpers for the team-chat outreach "ask who" gate. No I/O — unit-checkable.

// Matches an explicit "everyone" ask so outreach can target the whole book
// without a /lead pick. Word-boundaried so it won't fire inside "call"/"small".
const ALL_RE = /\b(all|everyone|everybody|every ?(one|lead|body))\b/i;

/** True when the message asks to outreach the entire book ("all", "everyone"). */
export function isAllRequest(message: string): boolean {
  return ALL_RE.test(message || "");
}

/** The reply that asks the user who to write to when no leads were picked. The
 *  speaker's name is shown by the UI, so the copy stays clean and in first person. */
export function askWhoText(_agentName: string): string {
  return `Who would you like me to write to? Type /lead to choose specific leads, or say "outreach all" to reach everyone in your book.`;
}

/** The re-ask used when a reply to "who?" can't be resolved to any lead. Kept as
 *  a distinct, exact string so isAskWhoPrompt still detects the pending state. */
export function askWhoAgainText(_agentName: string): string {
  return `I wasn't able to tell which lead you meant. Type /lead to choose, name them (for example, "Maria"), or say "outreach all".`;
}

/** True if `text` is one of the agent's ask-who prompts (initial or re-ask) —
 *  i.e. Outreach is still waiting for the user to say who to write to. */
export function isAskWhoPrompt(text: string, agentName: string): boolean {
  return text === askWhoText(agentName) || text === askWhoAgainText(agentName);
}
