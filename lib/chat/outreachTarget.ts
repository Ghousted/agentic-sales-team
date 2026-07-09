// Pure helpers for the team-chat outreach "ask who" gate. No I/O — unit-checkable.

// Matches an explicit "everyone" ask so outreach can target the whole book
// without a /lead pick. Word-boundaried so it won't fire inside "call"/"small".
const ALL_RE = /\b(all|everyone|everybody|every ?(one|lead|body))\b/i;

/** True when the message asks to outreach the entire book ("all", "everyone"). */
export function isAllRequest(message: string): boolean {
  return ALL_RE.test(message || "");
}

/** The reply that asks the user who to write to when no leads were picked. */
export function askWhoText(agentName: string): string {
  const first = (agentName || "").split(" ")[0] || "I";
  return `${first} here — who should I write to? Type /lead to pick some leads, or say "outreach all" to write to everyone in your book.`;
}

/** The re-ask used when a reply to "who?" can't be resolved to any lead. Kept as
 *  a distinct, exact string so isAskWhoPrompt still detects the pending state. */
export function askWhoAgainText(agentName: string): string {
  const first = (agentName || "").split(" ")[0] || "I";
  return `${first} — I couldn't tell which lead you meant. Type /lead to pick, name them (e.g. "Maria"), or say "outreach all".`;
}

/** True if `text` is one of the agent's ask-who prompts (initial or re-ask) —
 *  i.e. Outreach is still waiting for the user to say who to write to. */
export function isAskWhoPrompt(text: string, agentName: string): boolean {
  return text === askWhoText(agentName) || text === askWhoAgainText(agentName);
}
