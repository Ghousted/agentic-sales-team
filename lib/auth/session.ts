// Cookie-backed session helpers (Node/server-action context).
import "server-only";
import { cookies } from "next/headers";
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

/** Read + verify the current session from the request cookies. */
export async function getSession(): Promise<SessionPayload | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}
