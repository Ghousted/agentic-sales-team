// Cookie-backed session helpers (Node/server-action context).
import "server-only";
import { cookies } from "next/headers";
import { and, eq, sql } from "drizzle-orm";
import { getDb, isDbConfigured, users, workspaces } from "@/lib/db";
import { encodeSession, verifySession, SESSION_COOKIE, SESSION_MAX_AGE, type SessionPayload } from "./jwt";

export type { SessionPayload };

/** The active workspace, in its own cookie. getSession checks the user owns it. */
export const WORKSPACE_COOKIE = "ws";

/** The signed-in session. `userId` is the ACTIVE WORKSPACE: every data table keys
 *  on it, so all data reads and writes are per workspace. `accountId` is the
 *  login (the users row): use it for the account itself (name, email, password,
 *  sessions) and for limits that must hold across all of the user's workspaces. */
export type Session = SessionPayload & { accountId: string };

/** Make `workspaceId` the active workspace (call from a server action). */
export function setActiveWorkspace(workspaceId: string): void {
  cookies().set(WORKSPACE_COOKIE, workspaceId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
}

/** Set the session cookie (call from a route handler / server action). */
export async function createSession(payload: SessionPayload): Promise<void> {
  const token = await encodeSession(payload);
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
}

export async function destroySession(): Promise<void> {
  cookies().delete(SESSION_COOKIE);
  cookies().delete(WORKSPACE_COOKIE);
}

/** Invalidate every session the user holds, on every device. */
export async function revokeSessions(userId: string): Promise<void> {
  await getDb()
    .update(users)
    .set({ sessionVersion: sql`${users.sessionVersion} + 1` })
    .where(eq(users.id, userId));
}

/** Read + verify the current session from the request cookies. A token whose
 *  sessionVersion no longer matches the user's row (logged out, password reset,
 *  user deleted) is treated as no session. The workspace cookie counts only when
 *  the user owns that workspace; otherwise their first workspace (id = account id)
 *  is active. */
export async function getSession(): Promise<Session | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await verifySession(token);
  if (!session) return null;
  const accountId = session.userId;
  if (!isDbConfigured()) return { ...session, accountId };
  const wanted = cookies().get(WORKSPACE_COOKIE)?.value;
  const valid = !!wanted && /^[0-9a-f-]{36}$/i.test(wanted) && wanted !== accountId;
  const [row] = await getDb()
    .select({ sessionVersion: users.sessionVersion, workspaceId: workspaces.id })
    .from(users)
    .leftJoin(workspaces, and(eq(workspaces.ownerId, users.id), eq(workspaces.id, valid ? wanted! : accountId)))
    .where(eq(users.id, accountId))
    .limit(1);
  if (!row || row.sessionVersion !== session.sessionVersion) return null;
  return { ...session, accountId, userId: row.workspaceId ?? accountId };
}
