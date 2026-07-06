// Edge-safe JWT helpers (pure jose — no next/headers, no server-only).
// Usable from both middleware (Edge) and server actions (Node).
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export interface SessionPayload {
  userId: string;
  email: string;
  name: string;
}

function secret(): Uint8Array {
  // Falls back to a fixed dev secret in non-production so local dev works without
  // configuration; production requires a real AUTH_SECRET.
  const s = process.env.AUTH_SECRET || (process.env.NODE_ENV !== "production" ? "dev-insecure-secret-change-me" : undefined);
  if (!s) throw new Error("AUTH_SECRET is not set. Add it to .env.local (see .env.example).");
  return new TextEncoder().encode(s);
}

export async function encodeSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(secret());
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    return { userId: payload.userId as string, email: payload.email as string, name: payload.name as string };
  } catch {
    return null;
  }
}
