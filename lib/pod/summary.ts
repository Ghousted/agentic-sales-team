// Text for the team chat's human gate: the Proceed/Cancel ask an agent posts
// before every action, and the summary it posts when the user cancels the run.
// Pure (no I/O), so unit tests can check the wording.
import { runMarker } from "@/lib/scrape/steps";

/** What an agent is about to do, for the ask. n is the number of leads, or null
 *  when the step works on whatever the team has (the stage picks its own batch). */
export function actionPhrase(kind: string, n: number | null): string {
  const leads = (k: number) => `${k} lead${k === 1 ? "" : "s"}`;
  switch (kind) {
    case "scrape": return n === null ? "search for leads" : `search for ${leads(n)}`;
    case "assess": return n === null ? "review the new leads" : `review ${n} new lead${n === 1 ? "" : "s"}`;
    case "research": return n === null ? "research the team's leads" : `research ${leads(n)}`;
    case "qualify": return n === null ? "qualify the team's leads" : `qualify ${leads(n)}`;
    case "match": return n === null ? "match the team's leads to your catalog" : `match ${leads(n)} to your catalog`;
    case "outreach": return n === null ? "draft outreach to all accepted leads" : `draft outreach to ${leads(n)}`;
    case "proposal": return n === null ? "draft proposals for the team's leads" : `draft proposals for ${leads(n)}`;
    case "book-meeting": return n === null ? "book the meeting" : `book ${n === 1 ? "the meeting" : `${n} meetings`}`;
    default: return `run ${kind}`;
  }
}

/** The ask an agent posts before it acts. The ⟦approve:…⟧ marker shows the
 *  Proceed/Cancel panel under it. `mention` @-names the user (pod hand-offs). */
export function askText(kind: string, n: number | null, jobId: string, mention?: string): string {
  return `${mention ? `@${mention}, ` : ""}I'm ready to ${actionPhrase(kind, n)}. Proceed? ⟦approve:${jobId}⟧`;
}

/** The meeting ask: what will be booked, with whom and when, then Proceed/Cancel. */
export function askBookText(type: string, names: string, label: string, jobId: string): string {
  return `I'm ready to book a ${type} with ${names} on ${label}. Proceed? ⟦approve:${jobId}⟧`;
}

/** What the agent says as an approved (or Auto) step starts. A scrape's line
 *  carries the ⟦run:…⟧ marker, so its live timeline shows under it. */
export function startText(kind: string, jobId: string): string {
  return kind === "scrape" ? "Okay, starting the search now. I will post the results here." + runMarker(jobId) : "Okay, starting now.";
}

/** The status reply while a step waits for Proceed/Cancel. n as in actionPhrase. */
export function waitingText(kind: string, n: number | null): string {
  return `I'm waiting for your go-ahead to ${actionPhrase(kind, n)}.`;
}

/** One job of the cancelled run, as the summary needs it. */
export interface RunJob { kind: string; status: string; result: unknown; agentName: string }

const DOING: Record<string, string> = {
  scrape: "searching for leads", assess: "reviewing the new leads", research: "researching leads", qualify: "qualifying leads",
  match: "matching leads", outreach: "drafting outreach", proposal: "drafting proposals", "book-meeting": "booking a meeting",
};

/** What a finished job did, e.g. "found 8 leads". Reads the counts each runner stores. */
function donePhrase(kind: string, result: unknown): string {
  const r = (result ?? {}) as Record<string, unknown>;
  const n = (k: string) => (typeof r[k] === "number" ? (r[k] as number) : 0);
  const p = (k: string, noun: string) => `${n(k)} ${noun}${n(k) === 1 ? "" : "s"}`;
  switch (kind) {
    case "scrape": return `found ${p("leadsFound", "lead")}`;
    case "assess": return `accepted ${p("accepted", "lead")}`;
    case "research": return `researched ${p("briefed", "lead")}`;
    case "qualify": return `qualified ${p("qualified", "lead")}`;
    case "match": return `matched ${p("matched", "lead")} to your catalog`;
    case "outreach": return `drafted ${p("draftsCreated", "email")}`;
    case "proposal": return `drafted ${p("proposals", "proposal")}`;
    case "book-meeting": return `booked ${p("booked", "meeting")}`;
    default: return `finished a ${kind} run`;
  }
}

/** One summary line for a job, or null for a job that never ran (waiting or cancelled). */
export function summaryLine(job: RunJob): string | null {
  const who = job.agentName.split(" ")[0] || "An agent";
  if (job.status === "done") return `• ${who} ${donePhrase(job.kind, job.result)}`;
  if (job.status === "failed") return `• ${who}'s ${job.kind === "scrape" ? "search" : `${job.kind} run`} didn't finish`;
  if (job.status === "running") return `• ${who} was still ${DOING[job.kind] ?? "working"}. That step will finish, but nothing runs after it`;
  return null;
}

/** What the agent says when the user cancels: the run's steps, oldest first. */
export function cancelSummary(jobs: RunJob[]): string {
  const lines = jobs.map(summaryLine).filter((l): l is string => !!l);
  if (!lines.length) return "Okay, stopping now. We hadn't done anything yet, so nothing changed.";
  return ["Okay, stopping now. Here's a summary of what we did:", ...lines].join("\n");
}
