// Spend limits. Every job and chat message costs OpenRouter and/or Firecrawl
// credit, and sign-up is open, so the server caps what one user can ask for.
// The client's numbers are never trusted: they are clamped or refused here.

/** Most leads one job may work on (outreach, research, qualify, …). The pod uses 20. */
export const MAX_BATCH_SIZE = 25;
/** Most leads one scrape may ask for. */
export const MAX_SCRAPE_TARGET = 25;
/** Longest scrape instruction (it goes into the search plan and extraction prompts). */
export const MAX_INSTRUCTION_CHARS = 500;
/** Longest chat message (each one is sent to the intent model). */
export const MAX_CHAT_MESSAGE_CHARS = 2000;

/** Jobs of any kind one user may create in a rolling 24 hours. */
export const DAILY_JOB_QUOTA = 100;
/** Scrape jobs (the costly Firecrawl ones) one user may create in a rolling 24 hours. */
export const DAILY_SCRAPE_QUOTA = 20;
/** Chat messages one user may send in a rolling 24 hours. */
export const DAILY_CHAT_MESSAGE_QUOTA = 300;

export const QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;

const DEFAULT_BATCH_SIZE = 5;
const DEFAULT_SCRAPE_TARGET = 10;

/** A whole number in [min, max]; anything that isn't a finite number gets `fallback`. */
export function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(v)));
}

export interface JobSizeInput { leadIds?: unknown; batchSize?: unknown; target?: unknown; instruction?: unknown }
export interface JobSize { leadIds: string[] | null; batchSize: number; target: number; instruction: string | null }

/** The job's size params, made safe to store. Refuses (rather than cuts) a lead
 *  list or instruction that is too long, since cutting would change what runs. */
export function limitJobSize(input: JobSizeInput): JobSize | { error: string } {
  let leadIds: string[] | null = null;
  if (input.leadIds != null) {
    if (!Array.isArray(input.leadIds) || !input.leadIds.every((id) => typeof id === "string")) return { error: "Invalid lead list." };
    if (input.leadIds.length > MAX_BATCH_SIZE) return { error: `Pick at most ${MAX_BATCH_SIZE} leads at a time.` };
    leadIds = input.leadIds.length ? (input.leadIds as string[]) : null;
  }
  let instruction: string | null = null;
  if (input.instruction != null) {
    if (typeof input.instruction !== "string") return { error: "Invalid instruction." };
    const t = input.instruction.trim();
    if (t.length > MAX_INSTRUCTION_CHARS) return { error: `Keep the search request under ${MAX_INSTRUCTION_CHARS} characters.` };
    instruction = t || null;
  }
  return {
    leadIds,
    batchSize: clampInt(input.batchSize, 1, MAX_BATCH_SIZE, DEFAULT_BATCH_SIZE),
    target: clampInt(input.target, 1, MAX_SCRAPE_TARGET, DEFAULT_SCRAPE_TARGET),
    instruction,
  };
}

/** The refusal for a user who has used up a daily quota, or null when there's room. */
export function jobQuotaError(kind: string, recent: { total: number; scrapes: number }): string | null {
  if (recent.total >= DAILY_JOB_QUOTA) return `You've reached today's limit of ${DAILY_JOB_QUOTA} runs. Try again tomorrow.`;
  if (kind === "scrape" && recent.scrapes >= DAILY_SCRAPE_QUOTA) return `You've reached today's limit of ${DAILY_SCRAPE_QUOTA} lead searches. Try again tomorrow.`;
  return null;
}
