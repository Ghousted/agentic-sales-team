// The live step log of a scrape, shown as a timeline in the team chat. The scrape
// writes each step into its job row while it runs; the chat polls the row.
// No I/O here, so the browser can import the types and unit tests can check it.

export type ScrapeStepId = "plan" | "search" | "gate" | "extract" | "save";

export interface ScrapeStepItem {
  title: string;
  meta: string;
  url?: string;
  /** "dropped" for a result the seller check removed. */
  kind?: "source" | "dropped";
}

export interface ScrapeStep {
  id: ScrapeStepId;
  status: "active" | "done";
  label: string;
  detail?: string;
  items?: ScrapeStepItem[];
  /** How many more items there are than the ones listed. */
  more?: number;
}

/** "https://www.reddit.com/r/x/1" → "reddit.com". */
export function domainOf(url: string | undefined): string {
  try {
    return new URL(url ?? "").hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** A page title without its site suffix ("… - Facebook", "… | LinkedIn"); the
 *  timeline shows the domain next to it. */
export function cleanTitle(title: string): string {
  return title.replace(/\s*[-|·–]\s*(Facebook|Reddit|LinkedIn|X|Twitter)\s*$/i, "").trim() || title.trim();
}

export function trunc(text: string, n: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
}

/** The marker that puts the live timeline of scrape job `jobId` under a message. */
export function runMarker(jobId: string): string {
  return ` ⟦run:${jobId}⟧`;
}

/** The job id in a ⟦run:…⟧ marker, or null. */
export function runIdFrom(text: string): string | null {
  const m = text.match(/⟦run:([0-9a-f-]{36})⟧/i);
  return m ? m[1] : null;
}

export interface StepLog {
  /** Add a step, or replace the step with the same id. */
  put(step: ScrapeStep): void;
  all(): ScrapeStep[];
  /** Wait until every write has finished. Call it before the final job update,
   *  so a late progress write cannot overwrite the result. */
  flush(): Promise<void>;
}

/** A step log that hands every change to `write`, one write at a time and in
 *  order. A failed write is logged and never stops the scrape. */
export function createStepLog(write?: (steps: ScrapeStep[]) => Promise<void>): StepLog {
  const steps: ScrapeStep[] = [];
  let chain: Promise<void> = Promise.resolve();
  return {
    put(step) {
      const i = steps.findIndex((s) => s.id === step.id);
      if (i >= 0) steps[i] = step; else steps.push(step);
      if (!write) return;
      const snapshot = steps.map((s) => ({ ...s, items: s.items?.map((it) => ({ ...it })) }));
      chain = chain.then(() => write(snapshot)).catch((e) => { console.error("[scrape] progress write failed:", e); });
    },
    all: () => steps.map((s) => ({ ...s })),
    flush: () => chain,
  };
}

/** One line for the finished timeline, for example
 *  "47 sources · 11 sellers dropped · 8 leads". */
export function stepSummary(steps: ScrapeStep[]): string {
  const search = steps.find((s) => s.id === "search");
  const gate = steps.find((s) => s.id === "gate");
  const save = steps.find((s) => s.id === "save");
  const extract = steps.find((s) => s.id === "extract");
  const n = (s: string | undefined) => Number(s?.match(/\d+/)?.[0] ?? NaN);
  const parts = [
    search?.status === "done" && Number.isFinite(n(search.label)) ? `${n(search.label)} sources` : "",
    gate?.status === "done" && gate.items?.length ? `${(gate.items.length + (gate.more ?? 0))} dropped` : "",
    (save ?? extract)?.status === "done" ? (save ?? extract)!.label : "",
  ];
  return parts.filter(Boolean).join(" · ");
}
