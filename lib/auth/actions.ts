"use server";
// Auth server actions called from the client login form.
import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { getDb, isDbConfigured, users, passwordResetTokens } from "@/lib/db";
import { createSession, destroySession, getSession, revokeSessions } from "./session";

// Reset tokens are stored as a SHA-256 hash, never in plain text. A row holding a
// raw token from before hashing no longer matches, so old links stop working.
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface AuthResult {
  ok: boolean;
  error?: string;
  user?: { name: string; email: string; workspaceName: string; notifications: Record<string, boolean> };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NOT_CONFIGURED = "Server isn’t configured yet (missing database). Add DATABASE_URL to .env.local.";

function nameFromEmail(email: string): string {
  const local = email.split("@")[0].replace(/[._-]+/g, " ").trim();
  return local.replace(/\b\w/g, (c) => c.toUpperCase()) || "there";
}

export async function signUp(input: { email: string; password: string; name?: string }): Promise<AuthResult> {
  if (!isDbConfigured()) return { ok: false, error: NOT_CONFIGURED };
  const email = input.email.trim().toLowerCase();
  const password = input.password;
  if (!EMAIL_RE.test(email)) return { ok: false, error: "Enter a valid email address." };
  if (password.length < 8) return { ok: false, error: "Password must be at least 8 characters." };

  const db = getDb();
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing.length) return { ok: false, error: "An account with this email already exists." };

  const name = (input.name || "").trim() || nameFromEmail(email);
  const passwordHash = await bcrypt.hash(password, 10);
  const [user] = await db
    .insert(users)
    .values({ email, name, passwordHash })
    .returning({ name: users.name, email: users.email, workspaceName: users.workspaceName, notifications: users.notifications, id: users.id, sessionVersion: users.sessionVersion });

  await createSession({ userId: user.id, email: user.email, name: user.name, sessionVersion: user.sessionVersion });
  return { ok: true, user: { name: user.name, email: user.email, workspaceName: user.workspaceName, notifications: user.notifications } };
}

export async function signIn(input: { email: string; password: string }): Promise<AuthResult> {
  if (!isDbConfigured()) return { ok: false, error: NOT_CONFIGURED };
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email) || !input.password) return { ok: false, error: "Enter your email and password." };

  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  // One message for both cases so the login form doesn't reveal which emails have accounts.
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
    return { ok: false, error: "Incorrect email or password." };
  }

  await createSession({ userId: user.id, email: user.email, name: user.name, sessionVersion: user.sessionVersion });
  return { ok: true, user: { name: user.name, email: user.email, workspaceName: user.workspaceName, notifications: user.notifications } };
}

/** Sign out everywhere: the session version is bumped, so a copied or stolen
 *  token stops working too, not just this browser's cookie. */
export async function signOut(): Promise<void> {
  const session = isDbConfigured() ? await getSession() : null;
  if (session) await revokeSessions(session.userId);
  await destroySession();
}

export interface ResetRequestResult {
  ok: boolean;
  error?: string;
}

/** Self-serve reset is off until the app can email the link: a link handed to the
 *  browser lets anyone who types an email take over that account. Every valid email
 *  gets the same answer, and nothing is looked up or written. */
export async function requestPasswordReset(input: { email: string }): Promise<ResetRequestResult> {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { ok: false, error: "Enter a valid email address." };
  return { ok: true };
}

/** Check a reset token is valid + unexpired (for the /reset page to gate its form). */
export async function validateResetToken(token: string): Promise<{ ok: boolean }> {
  if (!isDbConfigured() || !token) return { ok: false };
  const [row] = await getDb()
    .select({ expiresAt: passwordResetTokens.expiresAt })
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.token, hashToken(token)))
    .limit(1);
  return { ok: !!row && row.expiresAt.getTime() >= Date.now() };
}

/** Consume a valid token to set a new password. */
export async function resetPassword(input: { token: string; password: string }): Promise<AuthResult> {
  if (!isDbConfigured()) return { ok: false, error: NOT_CONFIGURED };
  if (input.password.length < 8) return { ok: false, error: "Password must be at least 8 characters." };

  const db = getDb();
  const [row] = await db
    .select({ userId: passwordResetTokens.userId, expiresAt: passwordResetTokens.expiresAt })
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.token, hashToken(input.token)))
    .limit(1);
  if (!row || row.expiresAt.getTime() < Date.now()) {
    return { ok: false, error: "This reset link is invalid or has expired. Contact support to reset your password." };
  }

  const passwordHash = await bcrypt.hash(input.password, 10);
  // Bumping the session version signs out every device holding the old password's sessions.
  await db
    .update(users)
    .set({ passwordHash, sessionVersion: sql`${users.sessionVersion} + 1` })
    .where(eq(users.id, row.userId));
  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, row.userId));
  return { ok: true };
}

export interface AccountInfo {
  name: string;
  email: string;
  workspaceName: string;
  notifications: Record<string, boolean>;
}

/** Server helper: current user for hydrating the client on load. Runs during the
 *  root layout's SSR, so it must never throw: on a session/DB failure it logs and
 *  returns null (treated as logged-out) rather than crashing the app. */
export async function currentUser(): Promise<AccountInfo | null> {
  if (!isDbConfigured()) return null;
  try {
    const session = await getSession();
    if (!session) return null;
    const [user] = await getDb()
      .select({ name: users.name, email: users.email, workspaceName: users.workspaceName, notifications: users.notifications })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);
    return user ?? null;
  } catch (e) {
    console.error("[currentUser] session/db read failed; treating as logged-out:", e);
    return null;
  }
}

/** Update the signed-in user's profile / notification settings. */
export async function updateSettings(input: { name?: string; workspaceName?: string; notifications?: Record<string, boolean> }): Promise<void> {
  if (!isDbConfigured()) return;
  const session = await getSession();
  if (!session) return;
  const patch: Record<string, unknown> = {};
  if (typeof input.name === "string" && input.name.trim()) patch.name = input.name.trim();
  if (typeof input.workspaceName === "string" && input.workspaceName.trim()) patch.workspaceName = input.workspaceName.trim();
  if (input.notifications) patch.notifications = input.notifications;
  if (Object.keys(patch).length === 0) return;
  await getDb().update(users).set(patch).where(eq(users.id, session.userId));
}
