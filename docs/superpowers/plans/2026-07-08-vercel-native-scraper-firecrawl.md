# Vercel-Native Scraper (Firecrawl) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the persistent Python/browser-use scrape worker with a synchronous Node route that discovers public prospects via the **Firecrawl `/v2/search` API** and extracts them with the existing Gemini JSON helper — so scraping runs on Vercel (Hobby, no Pro), multi-user, with no browser and no second host.

**Architecture:** `enqueueJob({kind:"scrape"})` still creates the job (unchanged). A new **`/api/scrape`** Node route claims the job, calls Firecrawl `/v2/search` (query built from the ICP, markdown formats), passes the returned page markdown to `geminiJSON` to extract `Prospect`s against a schema, writes them as `leads` (`review='pending'`, `source='scrape'`), and finishes the job — **all synchronously in one ≤60s invocation**. Results flow through the existing Leads → Pending approval gate.

**Tech Stack:** Next.js 14 route handler (TypeScript, `runtime="nodejs"`, `maxDuration=60`) · Firecrawl `/v2/search` (raw `fetch`, Bearer auth) · existing `lib/ai/gemini.ts` (`geminiJSON`) · Drizzle/Neon.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-08-vercel-native-scraper-design.md`.
- **Refinement vs spec (intentional, allowed by the spec's "plan picks based on verified behavior"):** the spec described an async submit+poll model with a `/api/scrape/status` route and Firecrawl doing the extraction. Verified fact: **`/v2/search` is synchronous** and returns page markdown in one call. So this plan uses **one synchronous `/api/scrape` route** (no status route) and reuses the app's **`geminiJSON`** for extraction (cheaper than Firecrawl extract credits, and already integrated). Everything else in the spec holds.
- **Git identity:** commit as the user only — `Ghousted <clydepadua091@gmail.com>`. **Never** a `Co-Authored-By: Claude` / AI-attribution line.
- **No push.** `.env.local` gitignored.
- **No unit-test framework, no migration.** Verification is `npx tsc --noEmit` (from `agentic-salesforce/`) clean + code review + manual (needs `FIRECRAWL_API_KEY` set to exercise end-to-end).
- **User-scoping:** every DB read/write filters by session `userId`.
- **Public sources only.** Results pass through the human Pending gate. `FIRECRAWL_API_KEY` unset → scrape returns a clear "not configured" error; the rest of the app runs.
- **Hobby-safe:** keep the Firecrawl search `limit` small (default 6) so search + one Gemini call finish under `maxDuration=60`.
- **Deferred:** the async/cron finalizer for very long scrapes; an in-app progress view; per-user rate limits; retiring the `worker/` code (left in place, just no longer run/needed).

---

## File Structure

- `lib/scrape/firecrawl.ts` — CREATE (`server-only`): ICP→query builder, Firecrawl `/v2/search` call, Gemini prospect extraction, the `Prospect` type. One responsibility: turn an ICP into a `Prospect[]` from public web results.
- `lib/leads/store.ts` — MODIFY: add `addScrapedLeads(userId, agentId, prospects)` (dedup + insert `pending`/`scrape` leads + activity).
- `app/api/scrape/route.ts` — CREATE: the Node route (auth → claim job → scrape → write leads → finish).
- `lib/store.tsx` — MODIFY: `sendTeamChat` scrape branch POSTs `/api/scrape` and awaits the result.
- `app/agents/[id]/page.tsx` — MODIFY: `runScrape` POSTs `/api/scrape` and awaits (replaces the worker-poll flow).
- `.env.example` — MODIFY: add `FIRECRAWL_API_KEY`.

---

## Task 1: Firecrawl scrape module

**Files:** Create `lib/scrape/firecrawl.ts`.

**Interfaces:**
- Consumes: `geminiJSON`, `isGeminiConfigured` from `@/lib/ai/gemini`.
- Produces: `Prospect` (type), `isFirecrawlConfigured(): boolean`, `runFirecrawlScrape(agent: {id;name;role;goal;task;capabilities?}, icp: {industry?;titles?;geo?} | null, target: number): Promise<Prospect[]>`.

- [ ] **Step 1: Write `lib/scrape/firecrawl.ts`.**

```ts
import "server-only";
// Public-web lead discovery for the scrape capability: Firecrawl /v2/search fetches
// public pages for an ICP query, then Gemini extracts structured Prospects. Replaces
// the browser-use worker. Runs synchronously inside a Node route (Vercel Hobby-safe).
import { geminiJSON, isGeminiConfigured, type Turn } from "@/lib/ai/gemini";

export interface Prospect {
  name: string;
  title: string;
  company: string;
  profileUrl: string;
  platform: string;
  email: string;
}

export function isFirecrawlConfigured(): boolean {
  return !!process.env.FIRECRAWL_API_KEY;
}

interface SearchResult { title?: string; description?: string; url?: string; markdown?: string }

/** Build a web search query from the ICP (falls back to the agent's goal). */
function buildQuery(icp: { industry?: string; titles?: string; geo?: string } | null, agentGoal: string): string {
  const parts = [icp?.titles, icp?.industry, icp?.geo].filter(Boolean) as string[];
  const base = parts.length ? parts.join(" ") : agentGoal;
  // Bias toward finding real people/companies with contactable profiles.
  return `${base} companies OR founders OR decision makers contact`.slice(0, 490);
}

/** Firecrawl /v2/search — returns public web results with markdown. Synchronous. */
async function firecrawlSearch(query: string, limit: number): Promise<SearchResult[]> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return [];
  const res = await fetch("https://api.firecrawl.dev/v2/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, limit, scrapeOptions: { formats: [{ type: "markdown" }] } }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Firecrawl ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  const data = await res.json();
  const web = data?.data?.web;
  return Array.isArray(web) ? (web as SearchResult[]) : [];
}

const PROSPECTS_SCHEMA = {
  type: "object",
  properties: {
    prospects: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" }, title: { type: "string" }, company: { type: "string" },
          profileUrl: { type: "string" }, platform: { type: "string" }, email: { type: "string" },
        },
        required: ["name", "title", "company", "profileUrl", "platform", "email"],
      },
    },
  },
  required: ["prospects"],
} as const;

/** Extract Prospects from the search results' page content via Gemini JSON mode. */
async function extractProspects(icpText: string, results: SearchResult[], target: number): Promise<Prospect[]> {
  if (!isGeminiConfigured() || results.length === 0) return [];
  const corpus = results
    .map((r) => `SOURCE_URL: ${r.url ?? ""}\nTITLE: ${r.title ?? ""}\n${(r.markdown ?? r.description ?? "").slice(0, 3000)}`)
    .join("\n\n---\n\n")
    .slice(0, 22000);
  const system = [
    `You extract B2B sales prospects (people or companies) matching this ICP: ${icpText}.`,
    "From the provided public web page contents, return up to " + target + " distinct prospects that plausibly match.",
    "For each: name (person or company), title (role, '' if unknown), company ('' if unknown),",
    "profileUrl (the SOURCE_URL the prospect came from), platform (e.g. 'web', or 'linkedin'/'facebook' if the URL is that site),",
    "and email — ONLY if an email address is VISIBLY present in the content, otherwise ''. Never invent emails.",
    "Skip navigation/listicles that aren't real prospects. Return ONLY JSON.",
  ].join("\n");
  const turns: Turn[] = [{ role: "user", text: corpus }];
  try {
    const r = await geminiJSON<{ prospects: Prospect[] }>(system, turns, PROSPECTS_SCHEMA as unknown as Record<string, unknown>, { maxTokens: 1500, temperature: 0.3 });
    return (r.prospects ?? []).filter((p) => p && p.name).slice(0, target);
  } catch {
    return [];
  }
}

export async function runFirecrawlScrape(
  agent: { id: string; name: string; role: string; goal: string; task: string; capabilities?: string[] },
  icp: { industry?: string; titles?: string; geo?: string } | null,
  target: number,
): Promise<Prospect[]> {
  const query = buildQuery(icp, agent.goal);
  const limit = Math.max(3, Math.min(target, 6)); // keep small so search + extract fit maxDuration=60
  const results = await firecrawlSearch(query, limit);
  const icpText = [icp?.titles, icp?.industry, icp?.geo].filter(Boolean).join(", ") || agent.goal;
  const prospects = await extractProspects(icpText, results, target);
  // normalize: ensure a profileUrl/platform even if the model omitted them
  return prospects.map((p) => ({
    name: p.name, title: p.title ?? "", company: p.company ?? "",
    profileUrl: p.profileUrl || "", platform: p.platform || "web", email: p.email ?? "",
  }));
}
```

- [ ] **Step 2: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors. (Nothing consumes it yet.)

- [ ] **Step 3: Commit.**

```bash
git add agentic-salesforce/lib/scrape/firecrawl.ts
git commit -m "Add Firecrawl scrape module: /v2/search + Gemini prospect extraction"
```

---

## Task 2: `addScrapedLeads` in the leads store

**Files:** Modify `lib/leads/store.ts`.

**Interfaces:**
- Consumes: the existing `getDb`/`isDbConfigured`, `leads`, `activity` imports already in the file; the `Prospect` type from `@/lib/scrape/firecrawl`.
- Produces: `addScrapedLeads(userId: string, agentId: string, prospects: Prospect[]): Promise<number>` (returns count inserted).

- [ ] **Step 1: Read `lib/leads/store.ts`** to match its import style and how `addLead` inserts a lead + writes an `activity` row (mirror that pattern — column names, the `uid()`/scoping style).

- [ ] **Step 2: Add the import + function.** Near the other imports add:

```ts
import type { Prospect } from "@/lib/scrape/firecrawl";
```

Add this exported function (place it beside `addLead`; adjust to match the file's exact `db`/insert idiom seen in Step 1):

```ts
// Insert scraped prospects as PENDING leads (the approval gate), deduped against
// the agent's existing leads by profileUrl or email. Returns how many were added.
export async function addScrapedLeads(userId: string, agentId: string, prospects: Prospect[]): Promise<number> {
  if (!isDbConfigured() || prospects.length === 0) return 0;
  const db = getDb();
  const existing = await db.select({ profileUrl: leads.profileUrl, email: leads.email })
    .from(leads).where(and(eq(leads.userId, userId), eq(leads.agentId, agentId)));
  const seenUrl = new Set(existing.map((e) => (e.profileUrl ?? "").trim()).filter(Boolean));
  const seenEmail = new Set(existing.map((e) => (e.email ?? "").trim().toLowerCase()).filter(Boolean));
  let added = 0;
  for (const p of prospects) {
    const url = (p.profileUrl ?? "").trim();
    const email = (p.email ?? "").trim();
    if (url && seenUrl.has(url)) continue;
    if (email && seenEmail.has(email.toLowerCase())) continue;
    const [row] = await db.insert(leads).values({
      userId, agentId, name: p.name, title: p.title ?? "", company: p.company ?? "",
      email, status: "new", score: 0, source: "scrape", review: "pending",
      profileUrl: url || null, platform: p.platform || null,
    }).returning({ id: leads.id });
    await db.insert(activity).values({
      userId, agentId, type: "lead_added", leadId: row.id,
      text: `Scraped ${p.name}${p.company ? " · " + p.company : ""}`,
    });
    if (url) seenUrl.add(url);
    if (email) seenEmail.add(email.toLowerCase());
    added++;
  }
  return added;
}
```

(`and`/`eq` are already imported in `store.ts`; if `activity` isn't imported there, add it to the `@/lib/db` import.)

- [ ] **Step 3: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors.

- [ ] **Step 4: Commit.**

```bash
git add agentic-salesforce/lib/leads/store.ts
git commit -m "Leads store: addScrapedLeads — insert deduped pending scraped leads + activity"
```

---

## Task 3: `/api/scrape` route

**Files:** Create `app/api/scrape/route.ts`; Modify `.env.example`.

**Interfaces:**
- Consumes: `getSession`; `getDb`/`isDbConfigured`/`jobs` from `@/lib/db`; `runFirecrawlScrape`/`isFirecrawlConfigured` (Task 1); `addScrapedLeads` (Task 2).
- Produces: `POST /api/scrape` — body `{ jobId: string }` → `{ ok: true, leadsFound: number } | { error: string }` (with an HTTP status).

- [ ] **Step 1: Write `app/api/scrape/route.ts`.**

```ts
// Synchronous scrape runner (Vercel Node route). Claims a queued scrape job, discovers
// public prospects via Firecrawl + Gemini (lib/scrape/firecrawl), writes them as PENDING
// leads, and finishes the job — all in one ≤60s invocation. Replaces the Python worker.
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, isDbConfigured, jobs } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { runFirecrawlScrape, isFirecrawlConfigured } from "@/lib/scrape/firecrawl";
import { addScrapedLeads } from "@/lib/leads/store";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Server not configured." }, { status: 500 });
  const s = await getSession();
  const userId = s?.userId;
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { jobId } = (await req.json().catch(() => ({}))) as { jobId?: string };
  if (!jobId) return NextResponse.json({ error: "Missing jobId." }, { status: 400 });

  const db = getDb();
  const [job] = await db.select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.userId, userId))).limit(1);
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  if (job.kind !== "scrape") return NextResponse.json({ error: "Not a scrape job." }, { status: 400 });

  if (!isFirecrawlConfigured()) {
    await db.update(jobs).set({ status: "failed", error: "FIRECRAWL_API_KEY not set.", finishedAt: new Date() })
      .where(and(eq(jobs.id, jobId), eq(jobs.userId, userId)));
    return NextResponse.json({ error: "Scraping isn't configured (FIRECRAWL_API_KEY)." }, { status: 400 });
  }

  // Atomic claim: only one invocation proceeds.
  const claimed = await db.update(jobs).set({ status: "running", startedAt: new Date() })
    .where(and(eq(jobs.id, jobId), eq(jobs.userId, userId), eq(jobs.status, "queued")))
    .returning({ id: jobs.id });
  if (claimed.length === 0) return NextResponse.json({ ok: true, leadsFound: 0, note: "already running" });

  const params = (job.params ?? {}) as { agent?: any; target?: number; icp?: { industry?: string; titles?: string; geo?: string } | null };
  const agent = params.agent ?? { id: job.agentId, name: "Agent", role: "", goal: "", task: "" };
  const target = typeof params.target === "number" ? params.target : 10;

  try {
    const prospects = await runFirecrawlScrape(agent, params.icp ?? null, target);
    const leadsFound = await addScrapedLeads(userId, job.agentId, prospects);
    await db.update(jobs).set({ status: "done", result: { leadsFound }, finishedAt: new Date() })
      .where(and(eq(jobs.id, jobId), eq(jobs.userId, userId)));
    return NextResponse.json({ ok: true, leadsFound });
  } catch (e) {
    await db.update(jobs).set({ status: "failed", error: String(e).slice(0, 500), finishedAt: new Date() })
      .where(and(eq(jobs.id, jobId), eq(jobs.userId, userId)));
    return NextResponse.json({ error: "Scrape failed: " + String(e).slice(0, 200) }, { status: 500 });
  }
}
```

- [ ] **Step 2: Add the env var to `.env.example`.** Append a line:

```
FIRECRAWL_API_KEY=
```

- [ ] **Step 3: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors. (If `job.params.agent` typing complains, the `any` cast above is intentional — it's the stored snapshot.)

- [ ] **Step 4: Commit.**

```bash
git add "agentic-salesforce/app/api/scrape/route.ts" agentic-salesforce/.env.example
git commit -m "Add /api/scrape route: synchronous Firecrawl scrape → pending leads (no worker)"
```

---

## Task 4: Client wiring — invoke `/api/scrape` (drop the worker-poll path)

**Files:** Modify `app/agents/[id]/page.tsx`, `lib/store.tsx`.

**Interfaces:** Consumes `POST /api/scrape` (Task 3). No new exports.

- [ ] **Step 1: Agent page `runScrape`.** In `app/agents/[id]/page.tsx`, replace the body of `runScrape` (the `enqueueJob` + `getJob`-poll block, ~lines 121-157) with an enqueue-then-invoke flow:

```ts
  const runScrape = useCallback(async () => {
    if (!sel) return;
    setRunningScrape(true);
    setScrapeNote("Finding leads…");
    const res = await enqueueJob({
      agent: { id: sel.id, name: sel.name, role: sel.role, goal: sel.goal, task: sel.task },
      kind: "scrape", capabilities: sel.capabilities, target: 10,
    });
    if ("error" in res) { setScrapeNote(res.error); setRunningScrape(false); return; }
    try {
      const r = await fetch("/api/scrape", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: res.jobId }) });
      const data = (await r.json().catch(() => ({}))) as { leadsFound?: number; error?: string };
      if (!r.ok || data.error) setScrapeNote(data.error ?? "Scrape failed.");
      else setScrapeNote(`Found ${data.leadsFound ?? 0} lead${data.leadsFound === 1 ? "" : "s"} to review — open the Leads module’s Pending tab.`);
    } catch { setScrapeNote("Scrape failed — please try again."); }
    setRunningScrape(false);
    listWorkbook(sel.id).then(setAgentLeads);
  }, [sel]);
```

(`getJob` may now be an unused import in this file — remove it from the import if so; `tsc` won't error either way since `noUnusedLocals` is off, but prefer removing it.)

- [ ] **Step 2: Store `sendTeamChat` scrape branch.** In `lib/store.tsx`, the `sendTeamChat` job handling currently kicks `/api/jobs/run` only for non-scrape kinds and then polls `getJob`. Change the scrape case to invoke `/api/scrape` and await its result instead of polling. Locate the block after `if (!res.job) return;` and replace the kick + poll with:

```ts
      const job = res.job;
      if (job.kind === "scrape") {
        try {
          const r = await fetch("/api/scrape", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: job.id }) });
          const data = (await r.json().catch(() => ({}))) as { leadsFound?: number; error?: string };
          if (!r.ok || data.error) append(job.agentId, "That scrape didn't run: " + (data.error ?? "unknown error"));
          else append(job.agentId, `Found ${data.leadsFound ?? 0} lead${data.leadsFound === 1 ? "" : "s"} — in Leads → Pending to accept.`);
        } catch { append(job.agentId, "That scrape failed — please try again."); }
        return;
      }
      // research / outreach: run in the Node runner, then poll getJob (unchanged below)
      try { await fetch("/api/jobs/run", { method: "POST" }); } catch { /* best-effort */ }
```

Keep the existing research/outreach poll loop (the `getJob` polling that appends the "Researched N / Drafted N" lines) exactly as-is for the non-scrape path. (Match the existing variable names — `append`, `res.job` — from the current `sendTeamChat`.)

- [ ] **Step 3: Type-check.** `cd agentic-salesforce && npx tsc --noEmit` → no errors.

- [ ] **Step 4: Manual check (needs `FIRECRAWL_API_KEY` + `GEMINI_API_KEY`).** With `pnpm dev`, **no Python worker running**: from a scrape agent's Leads section click **Find leads**, and from a team chat send `@<scraper> find <industry> <titles> in <geo>`. Expect: a short wait, then "Found N leads…" and the leads appearing in **Leads → Pending** (`review='pending'`, `source='scrape'`). Accept some → they enter the book.

- [ ] **Step 5: Commit.**

```bash
git add "agentic-salesforce/app/agents/[id]/page.tsx" agentic-salesforce/lib/store.tsx
git commit -m "Client: run scrape via /api/scrape (drop Python-worker poll path)"
```

---

## Self-Review

**Spec coverage:**
- Part A (scrape as a Node route, ICP→discovery, leads→Pending) → Tasks 1+3. Part B (Firecrawl call, Prospect shape, dedup, lifecycle, auth) → Tasks 1 (Firecrawl+extract), 2 (dedup/insert), 3 (auth/claim/lifecycle). Part C (client invokes; new env key; drop worker; `FIRECRAWL_API_KEY` unset → clear error) → Tasks 3 (env + not-configured error) + 4 (client). The spec's async `/api/scrape/status` + screenshots + `job_steps.screenshot` migration are **intentionally not built** — documented in Global Constraints as the sync refinement (verified `/v2/search` is synchronous). No migration needed.

**Placeholder scan:** every step has complete code or an exact edit target. "~lines N" are read-anchors; the code to write is given in full.

**Type consistency:** `Prospect` (Task 1) is imported by Task 2 (`addScrapedLeads(prospects: Prospect[])`) and produced by `runFirecrawlScrape` (Task 1) which Task 3 calls then passes to `addScrapedLeads`. `POST /api/scrape {jobId}` → `{ok, leadsFound}` (Task 3) matches both client call sites (Task 4). `isFirecrawlConfigured`/`runFirecrawlScrape` names match across Tasks 1/3. The route reuses `jobs` statuses (`queued→running→done/failed`) consistent with `getJob` and the existing runner. `addScrapedLeads` uses the real `leads`/`activity` columns from `DATA-MODEL` (`source`,`review`,`profileUrl`,`platform`; activity `type='lead_added'`).

**Note for the implementer:** verify Firecrawl's response shape (`data.web[].markdown`) against a real key if available — the endpoint + fields here are from the current Firecrawl v2 docs, but confirm before relying on it. If `/v2/search` markdown scraping proves too slow for `limit=6` under 60s, drop `scrapeOptions` (search returns `title`+`description`+`url` without scraping) and extract from those snippets instead — a one-line change in `firecrawlSearch`.
