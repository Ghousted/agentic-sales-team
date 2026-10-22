"use server";
// Auth server actions called from the client login form.
import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq, sql } from "drizzle-orm";
import { getDb, isDbConfigured, users, workspaces, passwordResetTokens } from "@/lib/db";
import { createSession, destroySession, getSession, revokeSessions, WORKSPACE_COOKIE } from "./session";
import { cookies } from "next/headers";
import { checkAuthLimit, clearAuthLimit } from "./rateLimit";

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
const SIGNUP_REFUSED = "We couldn’t create an account with these details. If you already have one, sign in instead.";
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
  const limited = await checkAuthLimit("signUp", email);
  if (limited) return { ok: false, error: limited };

  // No lookup first: the password is always hashed and the insert skips a taken email,
  // so a registered email costs the same time and gets the same refusal as any other
  // failed sign-up. Until the app can send email, the refusal itself still tells the
  // caller sign-up didn't work; it just doesn't say why.
  const db = getDb();
  const name = (input.name || "").trim() || nameFromEmail(email);
  const passwordHash = await bcrypt.hash(password, 10);
  const [user] = await db
    .insert(users)
    .values({ email, name, passwordHash })
    .onConflictDoNothing({ target: users.email })
    .returning({ name: users.name, email: users.email, workspaceName: users.workspaceName, notifications: users.notifications, id: users.id, sessionVersion: users.sessionVersion });
  if (!user) return { ok: false, error: SIGNUP_REFUSED };
  // The account's first workspace has the account's own id (see the workspaces table).
  await db.insert(workspaces).values({ id: user.id, ownerId: user.id, name: user.workspaceName });

  await createSession({ userId: user.id, email: user.email, name: user.name, sessionVersion: user.sessionVersion });
  return { ok: true, user: { name: user.name, email: user.email, workspaceName: user.workspaceName, notifications: user.notifications } };
}

export async function signIn(input: { email: string; password: string }): Promise<AuthResult> {
  if (!isDbConfigured()) return { ok: false, error: NOT_CONFIGURED };
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email) || !input.password) return { ok: false, error: "Enter your email and password." };
  // Checked before the user lookup, so a blocked attempt says nothing about whether the account exists.
  const limited = await checkAuthLimit("signIn", email);
  if (limited) return { ok: false, error: limited };

  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  // One message for both cases so the login form doesn't reveal which emails have accounts.
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
    return { ok: false, error: "Incorrect email or password." };
  }

  await clearAuthLimit("signIn", email);
  await createSession({ userId: user.id, email: user.email, name: user.name, sessionVersion: user.sessionVersion });
  // A sign-in starts in the account's first workspace.
  cookies().delete(WORKSPACE_COOKIE);
  const [ws] = await db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, user.id)).limit(1);
  return { ok: true, user: { name: user.name, email: user.email, workspaceName: ws?.name ?? user.workspaceName, notifications: user.notifications } };
}

/** Sign out everywhere: the session version is bumped, so a copied or stolen
 *  token stops working too, not just this browser's cookie. */
export async function signOut(): Promise<void> {
  const session = isDbConfigured() ? await getSession() : null;
  if (session) await revokeSessions(session.accountId);
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
  if (isDbConfigured()) {
    const limited = await checkAuthLimit("resetRequest", email);
    if (limited) return { ok: false, error: limited };
  }
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
  const limited = await checkAuthLimit("resetPassword");
  if (limited) return { ok: false, error: limited };

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
function isDynamicUsage(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { digest?: unknown }).digest === "DYNAMIC_SERVER_USAGE";
}

export async function currentUser(): Promise<AccountInfo | null> {
  if (!isDbConfigured()) return null;
  try {
    const session = await getSession();
    if (!session) return null;
    // The account's own details, and the name of the ACTIVE workspace.
    const [user] = await getDb()
      .select({ name: users.name, email: users.email, workspaceName: workspaces.name, notifications: users.notifications })
      .from(users)
      .innerJoin(workspaces, and(eq(workspaces.id, session.userId), eq(workspaces.ownerId, users.id)))
      .where(eq(users.id, session.accountId))
      .limit(1);
    return user ?? null;
  } catch (e) {
    // During a static render Next throws DYNAMIC_SERVER_USAGE from cookies() to mark the
    // route dynamic. It must reach Next, not be logged and swallowed as a failed read.
    if (isDynamicUsage(e)) throw e;
    console.error("[currentUser] session/db read failed; treating as logged-out:", e);
    return null;
  }
}

/** Update the signed-in user's profile / notification settings. */
export async function updateSettings(input: { name?: string; workspaceName?: string; notifications?: Record<string, boolean> }): Promise<void> {
  if (!isDbConfigured()) return;
  const session = await getSession();
  if (!session) return;
  // The workspace name belongs to the active workspace; the rest to the account.
  if (typeof input.workspaceName === "string" && input.workspaceName.trim()) {
    await getDb().update(workspaces).set({ name: input.workspaceName.trim().slice(0, 80) })
      .where(and(eq(workspaces.id, session.userId), eq(workspaces.ownerId, session.accountId)));
  }
  const patch: Record<string, unknown> = {};
  if (typeof input.name === "string" && input.name.trim()) patch.name = input.name.trim();
  if (input.notifications) patch.notifications = input.notifications;
  if (Object.keys(patch).length === 0) return;
  await getDb().update(users).set(patch).where(eq(users.id, session.accountId));
}
