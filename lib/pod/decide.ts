// Proceed/Cancel (or Approve/Reject) of a step an agent asked about, as the UI
// sees it. A thrown request (network, server crash) becomes the same { error }
// a refused one returns, so callers keep the buttons and show one notice.
// Client-safe: the server action is passed in.
import type { ApprovalResult } from "./actions";

export function decideFailMsg(proceed: boolean): string {
  return proceed ? "I couldn't start that. Please try again." : "I couldn't cancel that. Please try again.";
}

export async function settleDecision(call: () => Promise<ApprovalResult>, proceed: boolean): Promise<ApprovalResult> {
  try {
    const res = await call();
    return res ?? { error: decideFailMsg(proceed) };
  } catch {
    return { error: decideFailMsg(proceed) };
  }
}
