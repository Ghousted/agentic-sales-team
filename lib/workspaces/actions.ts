"use server";
// Workspaces: one per business. List the account's workspaces, make a new one,
// and switch the active one. The active workspace lives in a cookie that
// getSession checks against the owner, so a user can only ever open their own.
import { and, asc, count, eq } from "drizzle-orm";
import { getDb, isDbConfigured, workspaces } from "@/lib/db";
import { getSession, setActiveWorkspace } from "@/lib/auth/session";

export interface WorkspaceDTO {
  id: string;
  name: string;
  active: boolean;
}

/** The most workspaces one account can have. */
const MAX_WORKSPACES = 10;
const MAX_NAME = 80;

/** The account's workspaces, oldest first (the first one is the original). */
export async function listWorkspaces(): Promise<WorkspaceDTO[]> {
  if (!isDbConfigured()) return [];
  const s = await getSession();
  if (!s) return [];
  const rows = await getDb().select({ id: workspaces.id, name: workspaces.name }).from(workspaces)
    .where(eq(workspaces.ownerId, s.accountId)).orderBy(asc(workspaces.createdAt));
  return rows.map((r) => ({ ...r, active: r.id === s.userId }));
}

/** Make a new, empty workspace and switch to it. */
export async function createWorkspace(name: string): Promise<{ id: string } | { error: string }> {
  if (!isDbConfigured()) return { error: "Server not configured." };
  const s = await getSession();
  if (!s) return { error: "Not signed in." };
  const clean = (typeof name === "string" ? name : "").trim().replace(/\s+/g, " ").slice(0, MAX_NAME);
  if (!clean) return { error: "Give the workspace a name." };
  const db = getDb();
  const [{ n }] = await db.select({ n: count() }).from(workspaces).where(eq(workspaces.ownerId, s.accountId));
  if (n >= MAX_WORKSPACES) return { error: `You can have up to ${MAX_WORKSPACES} workspaces.` };
  const [row] = await db.insert(workspaces).values({ ownerId: s.accountId, name: clean }).returning({ id: workspaces.id });
  setActiveWorkspace(row.id);
  return { id: row.id };
}

/** Make one of the account's workspaces the active one. */
export async function switchWorkspace(id: string): Promise<{ ok: true } | { error: string }> {
  if (!isDbConfigured()) return { error: "Server not configured." };
  const s = await getSession();
  if (!s) return { error: "Not signed in." };
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return { error: "Workspace not found." };
  const [row] = await getDb().select({ id: workspaces.id }).from(workspaces)
    .where(and(eq(workspaces.id, id), eq(workspaces.ownerId, s.accountId))).limit(1);
  if (!row) return { error: "Workspace not found." };
  setActiveWorkspace(row.id);
  return { ok: true };
}
