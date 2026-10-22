import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A tiny in-memory stand-in for the Drizzle client: enough of select/insert/update/delete
// for the auth actions, recording every write so tests can assert none happened.
const h = vi.hoisted(() => {
  const users = { _: "users", id: "users.id", email: "users.email", sessionVersion: "users.sessionVersion" };
  // What the mocked sql`${col} + 1` returns; update() applies it as an increment.
  const INCREMENT = { increment: true };
  const passwordResetTokens = { _: "password_reset_tokens", token: "prt.token", userId: "prt.userId", expiresAt: "prt.expiresAt" };
  const state = {
    users: [] as Array<Record<string, unknown>>,
    tokens: [] as Array<Record<string, unknown>>,
    writes: [] as string[],
  };
  type Cond = { col: string; value: unknown };
  const rowsFor = (table: { _: string }) => (table._ === "users" ? state.users : state.tokens);
  const colKey = (col: string) => col.split(".")[1];
  const match = (cond: Cond) => (row: Record<string, unknown>) => row[colKey(cond.col)] === cond.value;
  const db = {
    select: () => ({
      from: (table: { _: string }) => ({
        where: (cond: Cond) => ({ limit: async (n: number) => rowsFor(table).filter(match(cond)).slice(0, n) }),
      }),
    }),
    insert: (table: { _: string }) => ({
      values: (v: Record<string, unknown>) => {
        state.writes.push("insert:" + table._);
        rowsFor(table).push(v);
        return { returning: async () => [v] };
      },
    }),
    update: (table: { _: string }) => ({
      set: (v: Record<string, unknown>) => ({
        where: async (cond: Cond) => {
          state.writes.push("update:" + table._);
          rowsFor(table)
            .filter(match(cond))
            .forEach((r) => {
              for (const [k, val] of Object.entries(v)) r[k] = val === INCREMENT ? Number(r[k]) + 1 : val;
            });
        },
      }),
    }),
    delete: (table: { _: string }) => ({
      where: async (cond: Cond) => {
        state.writes.push("delete:" + table._);
        const keep = rowsFor(table).filter((r) => !match(cond)(r));
        rowsFor(table).splice(0, rowsFor(table).length, ...keep);
      },
    }),
  };
  return { users, passwordResetTokens, state, db, INCREMENT };
});

vi.mock("drizzle-orm", () => ({ eq: (col: string, value: unknown) => ({ col, value }), sql: () => h.INCREMENT }));
vi.mock("@/lib/db", () => ({
  getDb: () => h.db,
  isDbConfigured: () => true,
  users: h.users,
  passwordResetTokens: h.passwordResetTokens,
}));
vi.mock("./session", () => ({ createSession: vi.fn(), destroySession: vi.fn(), getSession: vi.fn(), revokeSessions: vi.fn() }));

import { requestPasswordReset, resetPassword, signIn, signOut, validateResetToken } from "./actions";
import { createSession, destroySession, getSession, revokeSessions } from "./session";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const HOUR = 60 * 60 * 1000;

beforeEach(async () => {
  h.state.users.splice(0);
  h.state.tokens.splice(0);
  h.state.writes.splice(0);
  vi.clearAllMocks();
  h.state.users.push({ id: "u1", email: "alice@example.com", name: "Alice", workspaceName: "W", notifications: {}, sessionVersion: 2, passwordHash: await bcrypt.hash("right-password", 4) });
});

describe("requestPasswordReset", () => {
  it("never hands a reset link or token to the caller", async () => {
    const res = await requestPasswordReset({ email: "alice@example.com" });
    expect(res).toEqual({ ok: true });
    expect(JSON.stringify(res)).not.toMatch(/token|reset\?/i);
  });

  it("answers a known and an unknown email identically", async () => {
    const known = await requestPasswordReset({ email: "alice@example.com" });
    const unknown = await requestPasswordReset({ email: "nobody@example.com" });
    expect(known).toEqual(unknown);
  });

  it("writes no token while reset is disabled", async () => {
    await requestPasswordReset({ email: "alice@example.com" });
    expect(h.state.writes).toEqual([]);
    expect(h.state.tokens).toEqual([]);
  });
});

describe("signIn", () => {
  it("gives the same error for an unknown email and a wrong password", async () => {
    const unknown = await signIn({ email: "nobody@example.com", password: "whatever-1" });
    const wrong = await signIn({ email: "alice@example.com", password: "wrong-password" });
    expect(unknown.ok).toBe(false);
    expect(unknown.error).toBe(wrong.error);
  });

  it("stamps the session with the user's current session version", async () => {
    expect((await signIn({ email: "alice@example.com", password: "right-password" })).ok).toBe(true);
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1", sessionVersion: 2 }));
  });
});

describe("signOut", () => {
  it("revokes the user's sessions everywhere, then clears the cookie", async () => {
    vi.mocked(getSession).mockResolvedValue({ userId: "u1", email: "alice@example.com", name: "Alice", sessionVersion: 2 });
    await signOut();
    expect(revokeSessions).toHaveBeenCalledWith("u1");
    expect(destroySession).toHaveBeenCalled();
  });

  it("still clears the cookie when there is no valid session", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    await signOut();
    expect(revokeSessions).not.toHaveBeenCalled();
    expect(destroySession).toHaveBeenCalled();
  });
});

describe("reset tokens", () => {
  it("validateResetToken does not return the account email", async () => {
    h.state.tokens.push({ token: sha256("raw-token"), userId: "u1", expiresAt: new Date(Date.now() + HOUR) });
    const res = await validateResetToken("raw-token");
    expect(res).toEqual({ ok: true });
  });

  it("matches tokens by their SHA-256 hash, not the raw value", async () => {
    h.state.tokens.push({ token: "raw-token", userId: "u1", expiresAt: new Date(Date.now() + HOUR) });
    expect((await validateResetToken("raw-token")).ok).toBe(false);
    expect((await resetPassword({ token: "raw-token", password: "new-password-1" })).ok).toBe(false);
  });

  it("resetPassword accepts a hashed, unexpired token", async () => {
    h.state.tokens.push({ token: sha256("raw-token"), userId: "u1", expiresAt: new Date(Date.now() + HOUR) });
    expect((await resetPassword({ token: "raw-token", password: "new-password-1" })).ok).toBe(true);
    expect(h.state.tokens).toEqual([]);
  });

  it("resetPassword revokes every existing session", async () => {
    h.state.tokens.push({ token: sha256("raw-token"), userId: "u1", expiresAt: new Date(Date.now() + HOUR) });
    await resetPassword({ token: "raw-token", password: "new-password-1" });
    expect(h.state.users[0].sessionVersion).toBe(3);
  });

  it("rejects an expired token", async () => {
    h.state.tokens.push({ token: sha256("raw-token"), userId: "u1", expiresAt: new Date(Date.now() - 1) });
    expect((await validateResetToken("raw-token")).ok).toBe(false);
  });
});
