// Pure helpers for the email drafts views (the Emails page).
// No I/O, so unit tests can check them.
import type { DraftDTO } from "./types";

export type DraftFilter = "unsent" | "sent" | "all";

export function isSent(d: Pick<DraftDTO, "status">): boolean {
  return d.status === "sent";
}

export function draftCounts(drafts: Pick<DraftDTO, "status">[]): { unsent: number; sent: number; total: number } {
  const sent = drafts.filter(isSent).length;
  return { unsent: drafts.length - sent, sent, total: drafts.length };
}

/** Drafts that match the status tab, the agent picker ("" = every agent) and the
 *  search text (lead name, company, email, subject or body). */
export function filterDrafts(drafts: DraftDTO[], opts: { status: DraftFilter; agentId?: string; q?: string }): DraftDTO[] {
  const q = (opts.q ?? "").trim().toLowerCase();
  return drafts.filter((d) => {
    if (opts.status === "sent" && !isSent(d)) return false;
    if (opts.status === "unsent" && isSent(d)) return false;
    if (opts.agentId && d.agentId !== opts.agentId) return false;
    if (!q) return true;
    return [d.leadName, d.leadCompany, d.leadEmail, d.subject, d.body].some((f) => (f ?? "").toLowerCase().includes(q));
  });
}

/** mailto: link with the draft pre-filled. The recipient stays literal (RFC 6068
 *  addr-spec); only the query params are encoded. */
export function mailtoUrl(d: Pick<DraftDTO, "leadEmail" | "subject" | "body">): string {
  return "mailto:" + d.leadEmail + "?subject=" + encodeURIComponent(d.subject) + "&body=" + encodeURIComponent(d.body);
}

export function relTime(iso: string, now = Date.now()): string {
  const m = Math.round((now - new Date(iso).getTime()) / 60000);
  if (m < 1) return "now"; if (m < 60) return m + "m"; const h = Math.round(m / 60);
  if (h < 24) return h + "h"; return Math.round(h / 24) + "d";
}
