import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A tiny in-memory stand-in for the Drizzle client: enough of select/insert/update/delete
// for the auth actions, recording every write so tests can assert none happened.
const h = vi.hoisted(() => {
  const users = { _: "users", id: "users.id", email: "users.email", sessionVersion: "users.sessionVersion" };
  // The mocked sql`...` tags its result as an increment; update() applies it as one,
  // and execute() reads the rate-limit statements from its text and values.
  type Sql = { increment: true; text: string; values: unknown[] };
  const isIncrement = (v: unknown): v is Sql => typeof v === "object" && v !== null && "increment" in v;
  const passwordResetTokens = { _: "password_reset_tokens", token: "prt.token", userId: "prt.userId", expiresAt: "prt.expiresAt" };
  const workspaces = { _: "workspaces", id: "workspaces.id", ownerId: "workspaces.ownerId", name: "workspaces.name" };
  const state = {
    users: [] as Array<Record<string, unknown>>,
    tokens: [] as Array<Record<string, unknown>>,
    workspaces: [] as Array<Record<string, unknown>>,
    writes: [] as string[],
    // auth_rate_limits rows: key -> fixed-window counter.
    limits: new Map<string, { count: number; start: number }>(),
  };
  type Cond = { col: string; value: unknown };
  const rowsFor = (table: { _: string }) => (table._ === "users" ? state.users : table._ === "workspaces" ? state.workspaces : state.tokens);
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
        if (table._ === "users") v = { id: "u-new", workspaceName: "My Workspace", ...v };
        // users.email is unique: with onConflictDoNothing a taken email inserts nothing.
        const taken = table._ === "users" && state.users.some((r) => r.email === v.email);
        if (!taken) rowsFor(table).push(v);
        const rows = taken ? [] : [v];
        return {
          returning: async () => {
            if (taken) throw new Error("duplicate key value violates unique constraint");
            return rows;
          },
          onConflictDoNothing: () => ({ returning: async () => rows }),
        };
      },
    }),
    update: (table: { _: string }) => ({
      set: (v: Record<string, unknown>) => ({
        where: async (cond: Cond) => {
          state.writes.push("update:" + table._);
          rowsFor(table)
            .filter(match(cond))
            .forEach((r) => {
              for (const [k, val] of Object.entries(v)) r[k] = isIncrement(val) ? Number(r[k]) + 1 : val;
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
    // Mirrors the upsert in rateLimit.ts: reset the window once it has passed, else count up.
    execute: async (q: Sql) => {
      const key = q.values[0] as string;
      if (q.text.trim().startsWith("DELETE")) {
        state.limits.delete(key);
        return { rows: [] };
      }
      const windowMs = Number(q.values[1]) * 1000;
      const now = Date.now();
      const cur = state.limits.get(key);
      const next = !cur || cur.start <= now - windowMs ? { count: 1, start: now } : { count: cur.count + 1, start: cur.start };
      state.limits.set(key, next);
      return { rows: [{ count: next.count, retry_after: Math.ceil((next.start + windowMs - now) / 1000) }] };
    },
  };
  return { users, passwordResetTokens, workspaces, state, db, isIncrement, ip: { value: "203.0.113.7" } };
});

vi.mock("drizzle-orm", () => ({
  eq: (col: string, value: unknown) => ({ col, value }),
  and: (...conds: unknown[]) => conds[0],
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ increment: true, text: strings.join("?"), values }),
}));
vi.mock("next/headers", () => ({ headers: () => new Headers({ "x-forwarded-for": `${h.ip.value}, 10.0.0.1` }), cookies: () => ({ delete: () => {} }) }));
vi.mock("@/lib/db", () => ({
  getDb: () => h.db,
  isDbConfigured: () => true,
  users: h.users,
  passwordResetTokens: h.passwordResetTokens,
  workspaces: h.workspaces,
}));
vi.mock("./session", () => ({ createSession: vi.fn(), destroySession: vi.fn(), getSession: vi.fn(), revokeSessions: vi.fn(), WORKSPACE_COOKIE: "ws" }));

import { currentUser, requestPasswordReset, resetPassword, signIn, signOut, signUp, validateResetToken } from "./actions";
import { createSession, destroySession, getSession, revokeSessions } from "./session";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const HOUR = 60 * 60 * 1000;

beforeEach(async () => {
  h.state.users.splice(0);
  h.state.workspaces.splice(0);
  h.state.tokens.splice(0);
  h.state.writes.splice(0);
  h.state.limits.clear();
  h.ip.value = "203.0.113.7";
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

describe("signUp workspaces", () => {
  it("creates the account's first workspace, with the account's own id", async () => {
    expect((await signUp({ email: "bea@example.com", password: "password-123" })).ok).toBe(true);
    expect(h.state.workspaces).toEqual([{ id: "u-new", ownerId: "u-new", name: "My Workspace" }]);
  });
});

describe("signUp email enumeration", () => {
  it("refuses a registered email with the same error as other failed sign-ups, and creates nothing", async () => {
    const res = await signUp({ email: "alice@example.com", password: "password-123" });
    expect(res.ok).toBe(false);
    expect(res.error).not.toMatch(/exists|registered|taken/i);
    expect(h.state.users).toHaveLength(1);
    expect(h.state.workspaces).toHaveLength(0);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("hashes the password even when the email is taken, so both paths cost the same", async () => {
    const hash = vi.spyOn(bcrypt, "hash");
    await signUp({ email: "alice@example.com", password: "password-123" });
    await signUp({ email: "bea@example.com", password: "password-123" });
    expect(hash).toHaveBeenCalledTimes(2);
    hash.mockRestore();
  });

  it("never reads the users table to check the email first", async () => {
    const select = vi.spyOn(h.db, "select");
    await signUp({ email: "alice@example.com", password: "password-123" });
    expect(select).not.toHaveBeenCalled();
    select.mockRestore();
  });

  it("is still rate limited per email", async () => {
    const results = [];
    for (let i = 0; i < 30; i++) results.push(await signUp({ email: "alice@example.com", password: "password-123" }));
    const errors = new Set(results.map((r) => r.error));
    expect(errors.size).toBe(2); // the generic refusal, then the rate-limit message
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
    // Signed in to a second workspace: the account's sessions are revoked, not the workspace id.
    vi.mocked(getSession).mockResolvedValue({ userId: "ws-2", accountId: "u1", email: "alice@example.com", name: "Alice", sessionVersion: 2 });
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

describe("rate limiting", () => {
  const TOO_MANY = /too many attempts/i;
  const wrong = (email = "alice@example.com") => signIn({ email, password: "wrong-password" });

  it("blocks the 6th sign-in for one email inside 15 minutes, even with the right password", async () => {
    for (let i = 0; i < 5; i++) expect((await wrong()).error).toBe("Incorrect email or password.");
    const sixth = await signIn({ email: "alice@example.com", password: "right-password" });
    expect(sixth.ok).toBe(false);
    expect(sixth.error).toMatch(TOO_MANY);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("blocks an unknown email exactly like a real one", async () => {
    for (let i = 0; i < 5; i++) {
      await wrong("alice@example.com");
      await wrong("nobody@example.com");
    }
    const real = await wrong("alice@example.com");
    const ghost = await wrong("nobody@example.com");
    expect(real.error).toMatch(TOO_MANY);
    expect(ghost).toEqual(real);
  });

  it("blocks one IP after 20 sign-ins across many emails", async () => {
    for (let i = 0; i < 20; i++) expect((await wrong(`user${i}@example.com`)).error).not.toMatch(TOO_MANY);
    expect((await wrong("fresh@example.com")).error).toMatch(TOO_MANY);
    h.ip.value = "198.51.100.9";
    expect((await wrong("fresh@example.com")).error).not.toMatch(TOO_MANY);
  });

  it("lets the email try again once the window has passed", async () => {
    vi.useFakeTimers();
    try {
      for (let i = 0; i < 5; i++) await wrong();
      expect((await wrong()).error).toMatch(TOO_MANY);
      vi.advanceTimersByTime(15 * 60 * 1000 + 1);
      expect((await signIn({ email: "alice@example.com", password: "right-password" })).ok).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a successful sign-in clears that email's failed attempts", async () => {
    for (let i = 0; i < 4; i++) await wrong();
    expect((await signIn({ email: "alice@example.com", password: "right-password" })).ok).toBe(true);
    for (let i = 0; i < 5; i++) expect((await wrong()).error).not.toMatch(TOO_MANY);
  });

  it("stores emails hashed, never in plain text", async () => {
    await wrong();
    const keys = [...h.state.limits.keys()].join(" ");
    expect(keys).not.toContain("alice");
    expect(keys).toContain("signIn:ip:203.0.113.7");
  });

  it("blocks the 6th sign-up from one IP inside an hour", async () => {
    for (let i = 0; i < 5; i++) expect((await signUp({ email: `new${i}@example.com`, password: "password-123" })).ok).toBe(true);
    const sixth = await signUp({ email: "new6@example.com", password: "password-123" });
    expect(sixth.error).toMatch(TOO_MANY);
    expect(h.state.users.some((u) => u.email === "new6@example.com")).toBe(false);
  });

  it("blocks the 4th reset request for one email inside an hour", async () => {
    for (let i = 0; i < 3; i++) expect((await requestPasswordReset({ email: "alice@example.com" })).ok).toBe(true);
    expect((await requestPasswordReset({ email: "alice@example.com" })).error).toMatch(TOO_MANY);
  });

  it("blocks the 11th reset-token attempt from one IP inside an hour", async () => {
    for (let i = 0; i < 10; i++) expect((await resetPassword({ token: `guess-${i}`, password: "new-password-1" })).error).not.toMatch(TOO_MANY);
    expect((await resetPassword({ token: "guess-x", password: "new-password-1" })).error).toMatch(TOO_MANY);
  });
});

describe("currentUser", () => {
  it("rethrows Next's dynamic-usage signal instead of logging it as a failure", async () => {
    const dynamic = Object.assign(new Error("Dynamic server usage: cookies"), { digest: "DYNAMIC_SERVER_USAGE" });
    vi.mocked(getSession).mockRejectedValue(dynamic);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(currentUser()).rejects.toBe(dynamic);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("treats a real session read failure as logged-out", async () => {
    vi.mocked(getSession).mockRejectedValue(new Error("db down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await currentUser()).toBeNull();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
