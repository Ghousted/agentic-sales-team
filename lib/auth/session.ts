// Cookie-backed session helpers (Node/server-action context).
import "server-only";
import { cookies } from "next/headers";
import { eq, sql } from "drizzle-orm";
import { getDb, isDbConfigured, users } from "@/lib/db";
import { encodeSession, verifySession, SESSION_COOKIE, SESSION_MAX_AGE, type SessionPayload } from "./jwt";

export type { SessionPayload };

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
 *  user deleted) is treated as no session. */
export async function getSession(): Promise<SessionPayload | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await verifySession(token);
  if (!session || !isDbConfigured()) return session;
  const [user] = await getDb()
    .select({ sessionVersion: users.sessionVersion })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);
  if (!user || user.sessionVersion !== session.sessionVersion) return null;
  return session;
}
