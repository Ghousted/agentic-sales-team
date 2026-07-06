"use server";
// Auth server actions called from the client login form.
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { getDb, isDbConfigured, users } from "@/lib/db";
import { createSession, destroySession, getSession } from "./session";

export interface AuthResult {
  ok: boolean;
  error?: string;
  user?: { name: string; email: string; workspaceName: string };
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
    .returning({ name: users.name, email: users.email, workspaceName: users.workspaceName, id: users.id });

  await createSession({ userId: user.id, email: user.email, name: user.name });
  return { ok: true, user: { name: user.name, email: user.email, workspaceName: user.workspaceName } };
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
  return { ok: true, user: { name: user.name, email: user.email, workspaceName: user.workspaceName } };
}

export async function signOut(): Promise<void> {
  await destroySession();
}

/** Server helper: current user for hydrating the client on load. */
export async function currentUser(): Promise<{ name: string; email: string; workspaceName: string } | null> {
  if (!isDbConfigured()) return null;
  const session = await getSession();
  if (!session) return null;
  const [user] = await getDb()
    .select({ name: users.name, email: users.email, workspaceName: users.workspaceName })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);
  return user ?? null;
}
