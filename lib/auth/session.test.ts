import { beforeEach, describe, expect, it, vi } from "vitest";

// The session cookie and the users row, each a single mutable slot.
const h = vi.hoisted(() => {
  const state = { cookie: undefined as string | undefined, user: undefined as { sessionVersion: number } | undefined };
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (state.user ? [state.user] : []) }) }) }),
    update: () => ({
      set: () => ({
        where: async () => {
          if (state.user) state.user.sessionVersion += 1;
        },
      }),
    }),
  };
  return { state, db };
});

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: () => (h.state.cookie ? { value: h.state.cookie } : undefined),
    set: (_name: string, value: string) => {
      h.state.cookie = value;
    },
    delete: () => {
      h.state.cookie = undefined;
    },
  }),
}));
vi.mock("drizzle-orm", () => ({ eq: () => ({}), sql: () => ({}) }));
vi.mock("@/lib/db", () => ({ getDb: () => h.db, isDbConfigured: () => true, users: {} }));

import { encodeSession } from "./jwt";
import { createSession, getSession, revokeSessions } from "./session";

const alice = { userId: "u1", email: "alice@example.com", name: "Alice", sessionVersion: 0 };

beforeEach(() => {
  h.state.cookie = undefined;
  h.state.user = { sessionVersion: 0 };
});

describe("getSession", () => {
  it("accepts a token whose version matches the user's row", async () => {
    await createSession(alice);
    expect(await getSession()).toEqual(alice);
  });

  it("rejects a token after the user's sessions are revoked", async () => {
    const stolen = await encodeSession(alice);
    await revokeSessions("u1");
    h.state.cookie = stolen;
    expect(await getSession()).toBeNull();
  });

  it("rejects a token for a user that no longer exists", async () => {
    await createSession(alice);
    h.state.user = undefined;
    expect(await getSession()).toBeNull();
  });

  it("accepts a fresh token issued at the bumped version", async () => {
    await revokeSessions("u1");
    await createSession({ ...alice, sessionVersion: 1 });
    expect(await getSession()).toEqual({ ...alice, sessionVersion: 1 });
  });
});
