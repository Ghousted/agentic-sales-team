"use server";
// Auth server actions called from the client login form.
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { getDb, isDbConfigured, users, passwordResetTokens } from "@/lib/db";
import { createSession, destroySession, getSession } from "./session";

const RESET_TTL_MS = 60 * 60 * 1000; // reset links valid for 1 hour

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
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
    .returning({ name: users.name, email: users.email, workspaceName: users.workspaceName, notifications: users.notifications, id: users.id });

  await createSession({ userId: user.id, email: user.email, name: user.name });
  return { ok: true, user: { name: user.name, email: user.email, workspaceName: user.workspaceName, notifications: user.notifications } };
}

export async function signIn(input: { email: string; password: string }): Promise<AuthResult> {
  if (!isDbConfigured()) return { ok: false, error: NOT_CONFIGURED };
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email) || !input.password) return { ok: false, error: "Enter your email and password." };

  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) return { ok: false, error: "No account found with that email." };

  const valid = await bcrypt.compare(input.password, user.passwordHash);
  if (!valid) return { ok: false, error: "Incorrect password." };

  await createSession({ userId: user.id, email: user.email, name: user.name });
  return { ok: true, user: { name: user.name, email: user.email, workspaceName: user.workspaceName, notifications: user.notifications } };
}

export async function signOut(): Promise<void> {
  await destroySession();
}

export interface ResetRequestResult {
  ok: boolean;
  error?: string;
  // No email infra: when the email matches an account we surface the reset path
  // directly so the user can proceed. Absent when no account matches.
  resetPath?: string;
}

/** Start a password reset: mint a 1-hour token for the account and return its link. */
export async function requestPasswordReset(input: { email: string }): Promise<ResetRequestResult> {
  if (!isDbConfigured()) return { ok: false, error: NOT_CONFIGURED };
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { ok: false, error: "Enter a valid email address." };

  const db = getDb();
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  // Don't reveal whether the email exists; only mint a link when it does.
  if (!user) return { ok: true };

  // Invalidate any prior tokens for this user, then create a fresh one.
  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id));
  const token = randomToken();
  await db.insert(passwordResetTokens).values({ token, userId: user.id, expiresAt: new Date(Date.now() + RESET_TTL_MS) });
  return { ok: true, resetPath: "/reset?token=" + token };
}

/** Check a reset token is valid + unexpired (for the /reset page to gate its form). */
export async function validateResetToken(token: string): Promise<{ ok: boolean; email?: string }> {
  if (!isDbConfigured() || !token) return { ok: false };
  const db = getDb();
  const [row] = await db
    .select({ userId: passwordResetTokens.userId, expiresAt: passwordResetTokens.expiresAt })
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.token, token))
    .limit(1);
  if (!row || row.expiresAt.getTime() < Date.now()) return { ok: false };
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, row.userId)).limit(1);
  return user ? { ok: true, email: user.email } : { ok: false };
}

/** Consume a valid token to set a new password. */
export async function resetPassword(input: { token: string; password: string }): Promise<AuthResult> {
  if (!isDbConfigured()) return { ok: false, error: NOT_CONFIGURED };
  if (input.password.length < 8) return { ok: false, error: "Password must be at least 8 characters." };

  const db = getDb();
  const [row] = await db
    .select({ userId: passwordResetTokens.userId, expiresAt: passwordResetTokens.expiresAt })
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.token, input.token))
    .limit(1);
  if (!row || row.expiresAt.getTime() < Date.now()) {
    return { ok: false, error: "This reset link is invalid or has expired. Request a new one." };
  }

  const passwordHash = await bcrypt.hash(input.password, 10);
  await db.update(users).set({ passwordHash }).where(eq(users.id, row.userId));
  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, row.userId));
  return { ok: true };
}

export interface AccountInfo {
  name: string;
  email: string;
  workspaceName: string;
  notifications: Record<string, boolean>;
}

/** Server helper: current user for hydrating the client on load. */
export async function currentUser(): Promise<AccountInfo | null> {
  if (!isDbConfigured()) return null;
  const session = await getSession();
  if (!session) return null;
  const [user] = await getDb()
    .select({ name: users.name, email: users.email, workspaceName: users.workspaceName, notifications: users.notifications })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);
  return user ?? null;
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
