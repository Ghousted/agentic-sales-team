// What a failed job stores as its `error`. The column is returned to the browser
// (getJob), so a raw `String(e)` could leak database or upstream details. Only an
// error thrown on purpose as a UserFacingError keeps its message; anything else
// becomes a generic line for the job's kind, and the caller logs the real error.

/** An error whose message is safe and meant to be shown to the user. */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

const KIND_LABEL: Record<string, string> = {
  scrape: "The search",
  outreach: "Drafting outreach",
  research: "Research",
  qualify: "Qualifying",
  proposal: "Drafting proposals",
  match: "Matching",
  assess: "Assessing leads",
};

/** The message to store on a failed job of this kind. */
export function jobErrorMessage(kind: string, e: unknown): string {
  if (e instanceof UserFacingError || (e instanceof Error && e.name === "UserFacingError")) return e.message.slice(0, 500);
  return `${KIND_LABEL[kind] ?? "This run"} failed. Please try again.`;
}
