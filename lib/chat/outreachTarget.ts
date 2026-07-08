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
