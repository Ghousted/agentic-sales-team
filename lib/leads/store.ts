import "server-only";
// All persistence for the leads/outreach domain. Plain async functions so the
// job runner (a route handler) can call them directly; the `use server`
// wrappers in ./actions.ts expose the client-facing subset.
import { randomUUID } from "node:crypto";
import { and, count, desc, eq, exists, inArray, asc, isNull, ne, sql, type SQL } from "drizzle-orm";
import { getDb, isDbConfigured, leads, outreachDrafts, activity, jobs } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { LEAD_STAGES, type LeadDTO, type DraftDTO, type OutreachResult, type ResearchBrief, type QualifyResult, type AssessResult, type LiveWorkDTO, type TeamLeadPick } from "./types";
import { teammatesOf, membersOfTeam } from "@/lib/teams/membership";
import type { Prospect } from "@/lib/scrape/firecrawl";
import { safeHttpUrl } from "@/lib/url/safeUrl";

type LeadRow = typeof leads.$inferSelect;

async function uid(): Promise<string | null> {
  const s = await getSession();
  return s?.userId ?? null;
}

function toLeadDTO(r: LeadRow): LeadDTO {
  return {
    id: r.id, agentId: r.agentId, name: r.name, title: r.title, company: r.company,
    email: r.email, status: r.status, score: r.score, source: r.source, review: r.review, profileUrl: safeHttpUrl(r.profileUrl), platform: r.platform, research: r.research ?? null, fitReason: r.fitReason ?? "",
    workedBy: [],
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  };
}

/** Map rows to DTOs, attaching each lead's `workedBy` (distinct agents that have
 *  acted on it, most-recent first) from the activity log in one query. */
async function toLeadDTOs(userId: string, rows: LeadRow[]): Promise<LeadDTO[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const acts = await getDb().select({ leadId: activity.leadId, agentId: activity.agentId })
    .from(activity)
    .where(and(eq(activity.userId, userId), inArray(activity.leadId, ids)))
    .orderBy(desc(activity.createdAt));
  const byLead: Record<string, string[]> = {};
  for (const a of acts) {
    if (!a.leadId) continue;
    const list = (byLead[a.leadId] ??= []);
    if (!list.includes(a.agentId)) list.push(a.agentId);
  }
  return rows.map((r) => ({ ...toLeadDTO(r), workedBy: byLead[r.id] ?? [] }));
}

export async function addLead(input: { agentId: string; name: string; title?: string; company?: string; email: string }): Promise<LeadDTO | null> {
  if (!isDbConfigured()) return null;
  const userId = await uid();
  if (!userId) return null;
  const db = getDb();
  // The id is made here so the lead and its activity row go in one transaction.
  const id = randomUUID();
  const name = input.name.trim(), company = (input.company ?? "").trim();
  const [[row]] = await db.batch([
    db.insert(leads).values({
      id, userId, agentId: input.agentId, name,
      title: (input.title ?? "").trim(), company,
      email: input.email.trim(),
    }).returning(),
    db.insert(activity).values({
      userId, agentId: input.agentId, type: "lead_added", leadId: id,
      text: `Added lead ${name}${company ? " · " + company : ""}`,
    }),
  ]);
  return toLeadDTO(row);
}

/** Insert scraped prospects as PENDING leads (the approval gate), deduped against
 *  the agent's existing leads by profileUrl or email. Returns how many were added. */
/** Save new scraped prospects as pending leads, skipping ones already in the book.
 *  Returns the new lead ids, so the chat can show the results. */
export async function addScrapedLeads(userId: string, agentId: string, prospects: Prospect[]): Promise<string[]> {
  if (!isDbConfigured() || prospects.length === 0) return [];
  const db = getDb();
  const existing = await db.select({ profileUrl: leads.profileUrl, email: leads.email })
    .from(leads).where(and(eq(leads.userId, userId), eq(leads.agentId, agentId)));
  const seenUrl = new Set(existing.map((e) => safeHttpUrl(e.profileUrl)).filter(Boolean));
  const seenEmail = new Set(existing.map((e) => (e.email ?? "").trim().toLowerCase()).filter(Boolean));
  const rows: (typeof leads.$inferInsert & { id: string })[] = [];
  for (const p of prospects) {
    const url = safeHttpUrl(p.profileUrl) ?? "";
    const email = (p.email ?? "").trim();
    if (url && seenUrl.has(url)) continue;
    if (email && seenEmail.has(email.toLowerCase())) continue;
    rows.push({
      id: randomUUID(), userId, agentId, name: p.name, title: p.title ?? "", company: p.company ?? "",
      email, status: "new", score: 0, source: "scrape", review: "pending",
      profileUrl: url || null, platform: p.platform || null, fitReason: (p.fit ?? "").trim().slice(0, 300),
    });
    if (url) seenUrl.add(url);
    if (email) seenEmail.add(email.toLowerCase());
  }
  if (!rows.length) return [];
  // All leads and their activity rows in one transaction: no lead without its log line.
  await db.batch([
    db.insert(leads).values(rows),
    db.insert(activity).values(rows.map((r) => ({
      userId, agentId, type: "lead_added", leadId: r.id,
      text: `Scraped ${r.name}${r.company ? " · " + r.company : ""}`,
    }))),
  ]);
  return rows.map((r) => r.id);
}

/** The user's leads with these ids, in the order given. For the scrape results
 *  card in the chat. Ids that are not the user's are left out. */
export async function listLeadsByIds(ids: string[]): Promise<LeadDTO[]> {
  if (!isDbConfigured()) return [];
  const userId = await uid();
  if (!userId) return [];
  const clean = [...new Set(ids)].filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 50);
  if (!clean.length) return [];
  const rows = await getDb().select().from(leads).where(and(eq(leads.userId, userId), inArray(leads.id, clean)));
  const dtos = await toLeadDTOs(userId, rows);
  return clean.map((id) => dtos.find((d) => d.id === id)).filter((d): d is LeadDTO => !!d);
}

// Minimal RFC-4180-ish CSV parser → array of rows keyed by lowercased header.
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "", row: string[] = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(field); field = ""; if (row.some((f) => f !== "")) rows.push(row); row = []; }
    else field += c;
  }
  if (field !== "" || row.length) { row.push(field); if (row.some((f) => f !== "")) rows.push(row); }
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

const LEAD_ALIASES: Record<string, "name" | "email" | "title" | "company"> = {
  name: "name", "full name": "name", fullname: "name", "full_name": "name", contact: "name", "contact name": "name", lead: "name",
  email: "email", "e-mail": "email", "email address": "email", "email_address": "email", mail: "email",
  title: "title", "job title": "title", "job_title": "title", role: "title", position: "title", headline: "title",
  company: "company", organization: "company", organisation: "company", org: "company", account: "company", employer: "company",
};

/** Import leads from a CSV (name/email/title/company + common header aliases).
 *  Imported leads land review='accepted' (they are the user's own contacts) and
 *  are deduped by email against the agent's existing book. Bounded to 500 rows. */
export async function importLeadsCsv(csvText: string, agentId: string): Promise<{ added: number; error?: string }> {
  if (!isDbConfigured()) return { added: 0, error: "Server not configured." };
  const userId = await uid();
  if (!userId) return { added: 0, error: "Not signed in." };
  const rows = parseCsv(csvText).slice(0, 500).map((row) => {
    const f = { name: "", email: "", title: "", company: "" };
    for (const [key, val] of Object.entries(row)) {
      if (!val) continue;
      const field = LEAD_ALIASES[key];
      if (field) f[field] = f[field] || val;
    }
    if (!f.name.trim() && f.email.trim()) f.name = f.email.split("@")[0]; // display name from email
    return f;
  }).filter((f) => f.name.trim() || f.email.trim());
  if (rows.length === 0) return { added: 0, error: "No rows with a name or email column found." };
  const db = getDb();
  const existing = await db.select({ email: leads.email }).from(leads).where(and(eq(leads.userId, userId), eq(leads.agentId, agentId)));
  const seen = new Set(existing.map((e) => (e.email ?? "").trim().toLowerCase()).filter(Boolean));
  const values: (typeof leads.$inferInsert & { id: string })[] = [];
  for (const r of rows) {
    const email = r.email.trim();
    if (email && seen.has(email.toLowerCase())) continue; // skip duplicate emails
    values.push({ id: randomUUID(), userId, agentId, name: r.name.trim(), title: r.title.trim(), company: r.company.trim(), email, status: "new", score: 0, source: "import", review: "accepted" });
    if (email) seen.add(email.toLowerCase());
  }
  if (values.length === 0) return { added: 0 };
  await db.batch([
    db.insert(leads).values(values),
    db.insert(activity).values(values.map((l) => ({ userId, agentId, type: "lead_added", leadId: l.id, text: `Imported ${l.name}${l.company ? " · " + l.company : ""}` }))),
  ]);
  return { added: values.length };
}

export async function listLeads(filter?: { agentId?: string; status?: string; source?: string; review?: string }): Promise<LeadDTO[]> {
  if (!isDbConfigured()) return [];
  const userId = await uid();
  if (!userId) return [];
  const conds = [eq(leads.userId, userId), eq(leads.review, filter?.review ?? "accepted")];
  if (filter?.agentId) conds.push(eq(leads.agentId, filter.agentId));
  if (filter?.status) conds.push(eq(leads.status, filter.status));
  if (filter?.source) conds.push(eq(leads.source, filter.source));
  const rows = await getDb().select().from(leads).where(and(...conds)).orderBy(desc(leads.createdAt));
  return toLeadDTOs(userId, rows);
}

/** The agent's working book: leads assigned to any teammate (its shared team
 *  book), accepted-only, newest first. */
export async function listWorkbook(agentId: string): Promise<LeadDTO[]> {
  if (!isDbConfigured()) return [];
  const userId = await uid();
  if (!userId) return [];
  const mates = await teammatesOf(userId, agentId);
  const rows = await getDb().select().from(leads)
    .where(and(eq(leads.userId, userId), inArray(leads.agentId, mates), eq(leads.review, "accepted")))
    .orderBy(desc(leads.createdAt));
  return toLeadDTOs(userId, rows);
}

/** Accepted leads assigned to any of the given agents (a team's book). */
export async function listLeadsForAgents(agentIds: string[]): Promise<LeadDTO[]> {
  if (!isDbConfigured() || agentIds.length === 0) return [];
  const userId = await uid();
  if (!userId) return [];
  const rows = await getDb().select().from(leads)
    .where(and(eq(leads.userId, userId), inArray(leads.agentId, agentIds), eq(leads.review, "accepted")))
    .orderBy(desc(leads.createdAt));
  return toLeadDTOs(userId, rows);
}

/** Scraped candidates awaiting human review (review='pending'). */
export async function listCandidates(filter?: { agentId?: string }): Promise<LeadDTO[]> {
  if (!isDbConfigured()) return [];
  const userId = await uid();
  if (!userId) return [];
  const conds = [eq(leads.userId, userId), eq(leads.review, "pending")];
  if (filter?.agentId) conds.push(eq(leads.agentId, filter.agentId));
  const rows = await getDb().select().from(leads).where(and(...conds)).orderBy(desc(leads.createdAt));
  return toLeadDTOs(userId, rows);
}

/** Leads for the team-chat /lead picker: every non-dismissed lead (pending +
 *  accepted) owned by any member of the team, newest first. Session-scoped. */
export async function listTeamLeadsForPicker(teamId: string): Promise<TeamLeadPick[]> {
  if (!isDbConfigured()) return [];
  const userId = await uid();
  if (!userId) return [];
  const memberIds = await membersOfTeam(userId, teamId);
  if (memberIds.length === 0) return [];
  const rows = await getDb().select().from(leads)
    .where(and(eq(leads.userId, userId), inArray(leads.agentId, memberIds), inArray(leads.review, ["pending", "accepted"])))
    .orderBy(desc(leads.createdAt));
  return rows.map((r) => ({ id: r.id, name: r.name, title: r.title, company: r.company, platform: r.platform, review: r.review }));
}

/** Accept or dismiss candidate leads (bulk). Dismiss is a soft 'dismissed'. */
export async function setLeadReview(ids: string[], review: "accepted" | "dismissed"): Promise<void> {
  if (!isDbConfigured() || ids.length === 0) return;
  const userId = await uid();
  if (!userId) return;
  await getDb().update(leads).set({ review, updatedAt: new Date() })
    .where(and(eq(leads.userId, userId), inArray(leads.id, ids)));
}

/** Hard-delete leads (bulk). FK cascades take their drafts, proposals, meetings,
 *  and matches with them; the activity log has no FK so it survives as immutable
 *  history. Scoped to the user so one can only delete their own leads. */
export async function deleteLeads(ids: string[]): Promise<void> {
  if (!isDbConfigured() || ids.length === 0) return;
  const userId = await uid();
  if (!userId) return;
  await getDb().delete(leads).where(and(eq(leads.userId, userId), inArray(leads.id, ids)));
}

export async function getLead(id: string): Promise<LeadDTO | null> {
  if (!isDbConfigured()) return null;
  const userId = await uid();
  if (!userId) return null;
  const [row] = await getDb().select().from(leads).where(and(eq(leads.id, id), eq(leads.userId, userId))).limit(1);
  return row ? toLeadDTO(row) : null;
}

export async function setStage(id: string, status: string): Promise<void> {
  if (!isDbConfigured()) return;
  const userId = await uid();
  if (!userId) return;
  if (!LEAD_STAGES.includes(status as (typeof LEAD_STAGES)[number])) return;
  await getDb().update(leads).set({ status, updatedAt: new Date() })
    .where(and(eq(leads.id, id), eq(leads.userId, userId)));
}

export async function listDraftsForAgent(agentId: string): Promise<DraftDTO[]> {
  if (!isDbConfigured()) return [];
  const userId = await uid();
  if (!userId) return [];
  const rows = await getDb().select({
    d: outreachDrafts, leadName: leads.name, leadCompany: leads.company, leadEmail: leads.email,
    leadProfileUrl: leads.profileUrl, leadPlatform: leads.platform,
  }).from(outreachDrafts)
    .innerJoin(leads, eq(outreachDrafts.leadId, leads.id))
    .where(and(eq(outreachDrafts.userId, userId), eq(outreachDrafts.agentId, agentId)))
    .orderBy(desc(outreachDrafts.createdAt));
  return rows.map(({ d, leadName, leadCompany, leadEmail, leadProfileUrl, leadPlatform }) => ({
    id: d.id, agentId: d.agentId, leadId: d.leadId, subject: d.subject, body: d.body,
    rationale: d.rationale, status: d.status, createdAt: d.createdAt.toISOString(),
    sentAt: d.sentAt ? d.sentAt.toISOString() : null, leadName, leadCompany, leadEmail, leadProfileUrl: safeHttpUrl(leadProfileUrl), leadPlatform,
  }));
}

/** Every outreach draft the user has, across all agents, newest first. Powers
 *  the Emails page. */
export async function listAllDrafts(): Promise<DraftDTO[]> {
  if (!isDbConfigured()) return [];
  const userId = await uid();
  if (!userId) return [];
  const rows = await getDb().select({
    d: outreachDrafts, leadName: leads.name, leadCompany: leads.company, leadEmail: leads.email,
    leadProfileUrl: leads.profileUrl, leadPlatform: leads.platform,
  }).from(outreachDrafts)
    .innerJoin(leads, eq(outreachDrafts.leadId, leads.id))
    .where(and(eq(outreachDrafts.userId, userId), eq(outreachDrafts.dismissed, false)))
    .orderBy(desc(outreachDrafts.createdAt));
  return rows.map(({ d, leadName, leadCompany, leadEmail, leadProfileUrl, leadPlatform }) => ({
    id: d.id, agentId: d.agentId, leadId: d.leadId, subject: d.subject, body: d.body,
    rationale: d.rationale, status: d.status, createdAt: d.createdAt.toISOString(),
    sentAt: d.sentAt ? d.sentAt.toISOString() : null, leadName, leadCompany, leadEmail, leadProfileUrl: safeHttpUrl(leadProfileUrl), leadPlatform,
  }));
}

/** All outreach drafts for a single lead (newest first). For the lead detail modal. */
export async function listDraftsForLead(leadId: string): Promise<DraftDTO[]> {
  if (!isDbConfigured()) return [];
  const userId = await uid();
  if (!userId) return [];
  const rows = await getDb().select({
    d: outreachDrafts, leadName: leads.name, leadCompany: leads.company, leadEmail: leads.email,
    leadProfileUrl: leads.profileUrl, leadPlatform: leads.platform,
  }).from(outreachDrafts)
    .innerJoin(leads, eq(outreachDrafts.leadId, leads.id))
    .where(and(eq(outreachDrafts.userId, userId), eq(outreachDrafts.leadId, leadId), eq(outreachDrafts.dismissed, false)))
    .orderBy(desc(outreachDrafts.createdAt));
  return rows.map(({ d, leadName, leadCompany, leadEmail, leadProfileUrl, leadPlatform }) => ({
    id: d.id, agentId: d.agentId, leadId: d.leadId, subject: d.subject, body: d.body,
    rationale: d.rationale, status: d.status, createdAt: d.createdAt.toISOString(),
    sentAt: d.sentAt ? d.sentAt.toISOString() : null, leadName, leadCompany, leadEmail, leadProfileUrl: safeHttpUrl(leadProfileUrl), leadPlatform,
  }));
}

/** An activity insert that copies user, agent and lead from the drafts matching
 *  `where`, as INSERT ... SELECT. It writes a row only if such a draft exists,
 *  which lets a batch make the log line depend on an earlier write in it.
 *  Drizzle wants every column, in table order. */
function activityForDraft(where: SQL | undefined, type: string, text: string) {
  const db = getDb();
  return db.insert(activity).select(db.select({
    id: sql<string>`gen_random_uuid()`.as("id"),
    userId: outreachDrafts.userId, agentId: outreachDrafts.agentId,
    type: sql<string>`${type}`.as("type"), leadId: outreachDrafts.leadId,
    text: sql<string>`${text}`.as("text"),
    dismissed: sql<boolean>`false`.as("dismissed"), createdAt: sql<Date>`now()`.as("created_at"),
  }).from(outreachDrafts).where(where));
}

export async function markDraftSent(draftId: string): Promise<void> {
  if (!isDbConfigured()) return;
  const userId = await uid();
  if (!userId) return;
  const db = getDb();
  const [d] = await db.select().from(outreachDrafts)
    .where(and(eq(outreachDrafts.id, draftId), eq(outreachDrafts.userId, userId))).limit(1);
  if (!d || d.status === "sent") return;
  // One transaction. The draft update stamps this exact sentAt and skips a draft
  // that is already sent, so the lead and activity writes run only when this
  // call is the one that sent it (a double click logs one "Sent").
  const sentAt = new Date();
  const sentNow = and(eq(outreachDrafts.id, draftId), eq(outreachDrafts.sentAt, sentAt));
  await db.batch([
    db.update(outreachDrafts).set({ status: "sent", sentAt })
      .where(and(eq(outreachDrafts.id, draftId), eq(outreachDrafts.userId, userId), ne(outreachDrafts.status, "sent"))),
    // Advance the lead new → contacted (only if still 'new', so we never rewind a stage).
    db.update(leads).set({ status: "contacted", updatedAt: sentAt })
      .where(and(eq(leads.id, d.leadId), eq(leads.userId, userId), eq(leads.status, "new"),
        exists(db.select({ id: outreachDrafts.id }).from(outreachDrafts).where(sentNow)))),
    activityForDraft(sentNow, "email_sent", `Sent "${d.subject}"`),
  ]);
}

/** Hide a single draft from the Emails page (soft-hide, not a delete. The row
 *  stays in the table so analytics counts are unaffected). Used for "Discard". */
export async function discardDraft(draftId: string): Promise<void> {
  if (!isDbConfigured()) return;
  const userId = await uid();
  if (!userId) return;
  await getDb().update(outreachDrafts).set({ dismissed: true })
    .where(and(eq(outreachDrafts.id, draftId), eq(outreachDrafts.userId, userId)));
}

/** Hide every already-sent draft from the inbox in one shot ("Clear sent").
 *  Returns how many were cleared so the caller can toast a count. */
export async function clearSentDrafts(): Promise<number> {
  if (!isDbConfigured()) return 0;
  const userId = await uid();
  if (!userId) return 0;
  const rows = await getDb().update(outreachDrafts).set({ dismissed: true })
    .where(and(eq(outreachDrafts.userId, userId), eq(outreachDrafts.status, "sent"), eq(outreachDrafts.dismissed, false)))
    .returning({ id: outreachDrafts.id });
  return rows.length;
}

/** Counts for the sidebar badges: leads waiting for review (Leads) and drafts
 *  waiting to be sent (Emails). */
export async function navCounts(): Promise<{ leads: number; emails: number }> {
  if (!isDbConfigured()) return { leads: 0, emails: 0 };
  const userId = await uid();
  if (!userId) return { leads: 0, emails: 0 };
  const db = getDb();
  const [[l], [e]] = await Promise.all([
    db.select({ n: count() }).from(leads).where(and(eq(leads.userId, userId), eq(leads.review, "pending"))),
    db.select({ n: count() }).from(outreachDrafts)
      .where(and(eq(outreachDrafts.userId, userId), eq(outreachDrafts.dismissed, false), ne(outreachDrafts.status, "sent"))),
  ]);
  return { leads: l?.n ?? 0, emails: e?.n ?? 0 };
}

/** Hide every draft for a single lead ("Clear all" in the lead detail modal).
 *  Soft-hide only, so analytics drafted/sent counts are unaffected. Returns how
 *  many were cleared so the caller can toast a count. */
export async function clearDraftsForLead(leadId: string): Promise<number> {
  if (!isDbConfigured()) return 0;
  const userId = await uid();
  if (!userId) return 0;
  const rows = await getDb().update(outreachDrafts).set({ dismissed: true })
    .where(and(eq(outreachDrafts.userId, userId), eq(outreachDrafts.leadId, leadId), eq(outreachDrafts.dismissed, false)))
    .returning({ id: outreachDrafts.id });
  return rows.length;
}

// ── Runner helpers (called by /api/jobs/run) ────────────────────────────────

/** Pick the leads a run should process: the given ids, or the agent's leads
 *  that don't yet have a draft (idempotent re-runs), oldest first, capped. */
export async function pickLeadsForRun(userId: string, agentId: string, leadIds: string[] | undefined, batchSize: number): Promise<LeadRow[]> {
  const db = getDb();
  const mates = await teammatesOf(userId, agentId);
  if (leadIds && leadIds.length) {
    return db.select().from(leads)
      .where(and(eq(leads.userId, userId), inArray(leads.id, leadIds), eq(leads.review, "accepted")))
      .limit(batchSize);
  }
  const pool = await db.select().from(leads)
    .where(and(eq(leads.userId, userId), inArray(leads.agentId, mates), eq(leads.review, "accepted"))).orderBy(asc(leads.createdAt));
  if (!pool.length) return [];
  const poolIds = pool.map((l) => l.id);
  const drafted = await db.select({ leadId: outreachDrafts.leadId }).from(outreachDrafts)
    .where(and(eq(outreachDrafts.userId, userId), inArray(outreachDrafts.leadId, poolIds)));
  const draftedIds = new Set(drafted.map((r) => r.leadId));
  return pool.filter((l) => !draftedIds.has(l.id)).slice(0, batchSize);
}

/** Persist one engine result: the draft, the lead's new score, and activity.
 *  The lead's stage is left alone: a draft isn't contact yet, and the engine's
 *  guess could rewind a lead (e.g. 'meeting' -> 'contacted'). markDraftSent
 *  advances it when the draft actually goes out.
 *  Returns false, writing nothing, when the lead already has a live draft (a
 *  concurrent run got there first; see outreach_drafts_live_lead_idx).
 *
 *  All three writes go in one transaction. The draft id is made here, and the
 *  lead update and activity insert only match when a draft with that id exists.
 *  So when ON CONFLICT DO NOTHING skips the draft, the other two write nothing. */
export async function applyOutreachResult(userId: string, agentId: string, lead: LeadRow, result: OutreachResult): Promise<boolean> {
  const db = getDb();
  const draftId = randomUUID();
  const ours = eq(outreachDrafts.id, draftId);
  const [inserted] = await db.batch([
    db.insert(outreachDrafts).values({
      id: draftId, userId, agentId, leadId: lead.id, subject: result.subject, body: result.body, rationale: result.rationale,
    }).onConflictDoNothing().returning({ id: outreachDrafts.id }),
    db.update(leads).set({
      score: Math.max(0, Math.min(100, Math.round(result.score || 0))), updatedAt: new Date(),
    }).where(and(eq(leads.id, lead.id), eq(leads.userId, userId),
      exists(db.select({ id: outreachDrafts.id }).from(outreachDrafts).where(ours)))),
    activityForDraft(ours, "email_drafted", `Drafted "${result.subject}" for ${lead.name}`),
  ]);
  return inserted.length > 0;
}

/** Pick the agent's leads that don't have a research brief yet (or the given
 *  ids), oldest first, capped. */
export async function pickLeadsForResearch(userId: string, agentId: string, leadIds: string[] | undefined, batchSize: number): Promise<LeadRow[]> {
  const db = getDb();
  const mates = await teammatesOf(userId, agentId);
  if (leadIds && leadIds.length) {
    return db.select().from(leads)
      .where(and(eq(leads.userId, userId), inArray(leads.id, leadIds), eq(leads.review, "accepted")))
      .limit(batchSize);
  }
  const pool = await db.select().from(leads)
    .where(and(eq(leads.userId, userId), inArray(leads.agentId, mates), eq(leads.review, "accepted"))).orderBy(asc(leads.createdAt));
  return pool.filter((l) => !l.research).slice(0, batchSize);
}

/** Persist one research brief onto the lead + log activity. */
export async function applyResearchResult(userId: string, agentId: string, lead: LeadRow, brief: ResearchBrief): Promise<void> {
  const db = getDb();
  await db.batch([
    db.update(leads).set({ research: brief, updatedAt: new Date() })
      .where(and(eq(leads.id, lead.id), eq(leads.userId, userId))),
    db.insert(activity).values({ userId, agentId, type: "lead_researched", leadId: lead.id, text: `Researched ${lead.name}` }),
  ]);
}

/** Pick the agent's teammate-book leads not yet qualified (no qualifiedAt), or the
 *  given ids, oldest first, capped. Standalone (not layered on
 *  pickLeadsForResearch) because that helper's null-research filter would
 *  wrongly exclude leads that were researched but never scored. */
export async function pickLeadsForQualify(userId: string, agentId: string, leadIds: string[] | undefined, batchSize: number): Promise<LeadRow[]> {
  const db = getDb();
  const mates = await teammatesOf(userId, agentId);
  if (leadIds && leadIds.length) {
    return db.select().from(leads)
      .where(and(eq(leads.userId, userId), inArray(leads.id, leadIds), eq(leads.review, "accepted")))
      .limit(batchSize);
  }
  return db.select().from(leads)
    .where(and(eq(leads.userId, userId), inArray(leads.agentId, mates), eq(leads.review, "accepted"), isNull(leads.qualifiedAt)))
    .orderBy(asc(leads.createdAt))
    .limit(batchSize);
}

/** Persist one qualification score onto the lead + log activity. */
export async function applyQualifyResult(userId: string, agentId: string, lead: LeadRow, result: QualifyResult): Promise<void> {
  const db = getDb();
  const score = Math.max(1, Math.min(100, Math.round(result.score)));
  const now = new Date();
  await db.batch([
    db.update(leads).set({ score, qualifiedAt: now, updatedAt: now })
      .where(and(eq(leads.id, lead.id), eq(leads.userId, userId))),
    db.insert(activity).values({ userId, agentId, type: "lead_qualified", leadId: lead.id, text: `Qualified ${lead.name}: ${result.tier} (${score}): ${result.reason}`.slice(0, 400) }),
  ]);
}

/** Pick PENDING (freshly-scraped) teammate-book leads for the Assessor to review,
 *  or the given ids, oldest first, capped. */
export async function pickLeadsForAssess(userId: string, agentId: string, leadIds: string[] | undefined, batchSize: number): Promise<LeadRow[]> {
  const db = getDb();
  const mates = await teammatesOf(userId, agentId);
  if (leadIds && leadIds.length) {
    return db.select().from(leads)
      .where(and(eq(leads.userId, userId), inArray(leads.agentId, mates), inArray(leads.id, leadIds), eq(leads.review, "pending")))
      .limit(batchSize);
  }
  return db.select().from(leads)
    .where(and(eq(leads.userId, userId), inArray(leads.agentId, mates), eq(leads.review, "pending")))
    .orderBy(asc(leads.createdAt))
    .limit(batchSize);
}

/** Apply one assessment: accept (→ review 'accepted' + fit score) or dismiss, + activity. */
export async function applyAssessResult(userId: string, agentId: string, lead: LeadRow, result: AssessResult): Promise<void> {
  const db = getDb();
  const review = result.accept ? "accepted" : "dismissed";
  const set: { review: string; updatedAt: Date; score?: number; fitReason?: string } = { review, updatedAt: new Date() };
  if (result.accept) set.score = Math.max(1, Math.min(100, Math.round(result.score || 0)));
  // The Assessor's reason replaces the scraper's line. Its fail-open notes say nothing about fit.
  const reason = (result.reason ?? "").trim();
  if (reason && !/^Auto-accepted\b/.test(reason)) set.fitReason = reason.slice(0, 300);
  await db.batch([
    db.update(leads).set(set).where(and(eq(leads.id, lead.id), eq(leads.userId, userId))),
    db.insert(activity).values({ userId, agentId, type: "lead_assessed", leadId: lead.id, text: `Assessed ${lead.name}: ${result.accept ? "accepted" : "passed"}: ${result.reason}`.slice(0, 400) }),
  ]);
}

/** Running research/outreach jobs → who is actively working which leads now
 *  (the job's remaining pool). Renders nothing when idle. */
export async function getLiveWork(): Promise<LiveWorkDTO[]> {
  if (!isDbConfigured()) return [];
  const userId = await uid();
  if (!userId) return [];
  const running = await getDb().select().from(jobs)
    .where(and(eq(jobs.userId, userId), eq(jobs.status, "running"), inArray(jobs.kind, ["research", "outreach"])));
  const out: LiveWorkDTO[] = [];
  for (const j of running) {
    const p = j.params as { agent?: { id?: string; name?: string }; leadIds?: string[] | null; batchSize?: number };
    const agentId = p.agent?.id ?? j.agentId;
    const pick = j.kind === "research" ? pickLeadsForResearch : pickLeadsForRun;
    const pool = await pick(userId, agentId, p.leadIds ?? undefined, p.batchSize ?? 5);
    out.push({ agentId, agentName: p.agent?.name ?? "Agent", capability: j.kind, leadIds: pool.map((l) => l.id) });
  }
  return out;
}
