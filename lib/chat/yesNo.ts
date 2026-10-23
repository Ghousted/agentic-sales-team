// A typed answer to an agent's "Proceed?" ask. While the Proceed/Cancel panel is
// open, a clear yes ("yes", "go ahead", "ok do it") works as Proceed and a clear
// no ("no", "cancel", "stop") as Cancel. Anything else is a normal message. A
// fixed word list, not the AI, so the same words always do the same thing.

// Every word of the reply must come from one list, and at least one must be a
// strong word of that list, so "ok stop" or "yes, but only 5" decide nothing.
const YES_WORDS = new Set(["yes", "y", "yeah", "yea", "yep", "yup", "sure", "ok", "okay", "k", "go", "ahead", "proceed", "approve", "approved", "do", "it", "for", "please", "lets", "let's", "sounds", "good", "great", "thanks", "thank", "you", "start"]);
const YES_STRONG = new Set(["yes", "y", "yeah", "yea", "yep", "yup", "sure", "ok", "okay", "k", "go", "proceed", "approve", "approved"]);
// Clear yeses with no strong word.
const YES_PHRASES = new Set(["do it", "do it please", "please do", "please do it", "sounds good", "start it", "start"]);
const NO_WORDS = new Set(["no", "n", "nope", "nah", "cancel", "stop", "abort", "dont", "don't", "do", "not", "it", "never", "mind", "nevermind", "thanks", "thank", "you", "please"]);
const NO_STRONG = new Set(["no", "n", "nope", "nah", "cancel", "stop", "abort", "dont", "don't", "never", "nevermind"]);

/** "yes", "no", or null when the reply is not a clear answer. */
export function readDecision(text: string): "yes" | "no" | null {
  const t = (text || "").toLowerCase().replace(/[’`]/g, "'").trim();
  if (!t || t.length > 40) return null;
  const words = t.replace(/[^a-z' ]+/g, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const all = (set: Set<string>) => words.every((w) => set.has(w));
  const any = (set: Set<string>) => words.some((w) => set.has(w));
  if (YES_PHRASES.has(words.join(" "))) return "yes";
  if (all(YES_WORDS) && any(YES_STRONG) && !any(NO_STRONG)) return "yes";
  if (all(NO_WORDS) && any(NO_STRONG)) return "no";
  return null;
}
