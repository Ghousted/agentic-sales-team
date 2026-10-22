import { beforeEach, describe, expect, it, vi } from "vitest";

// The cookies by name, the users row, and the workspaces the user owns.
const h = vi.hoisted(() => {
  const state = {
    cookies: {} as Record<string, string>,
    user: undefined as { sessionVersion: number } | undefined,
    owned: [] as string[],
    asked: undefined as string | undefined, // the workspace id getSession looked up
  };
  const db = {
    select: () => ({
      from: () => ({
        leftJoin: (_t: unknown, cond: { wsId?: string }) => ({
          where: () => ({
            limit: async () => {
              state.asked = cond.wsId;
              if (!state.user) return [];
              const ws = cond.wsId && state.owned.includes(cond.wsId) ? cond.wsId : null;
              return [{ sessionVersion: state.user.sessionVersion, workspaceId: ws }];
            },
          }),
        }),
      }),
    }),
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
    get: (name: string) => (h.state.cookies[name] ? { value: h.state.cookies[name] } : undefined),
    set: (name: string, value: string) => { h.state.cookies[name] = value; },
    delete: (name: string) => { delete h.state.cookies[name]; },
  }),
}));
// and(owner = users.id, workspaces.id = X): keep X so the fake can answer.
vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => (col === "workspaces.id" ? { wsId: val } : {}),
  and: (...parts: { wsId?: string }[]) => Object.assign({}, ...parts),
  sql: () => ({}),
}));
vi.mock("@/lib/db", () => ({ getDb: () => h.db, isDbConfigured: () => true, users: {}, workspaces: { id: "workspaces.id", ownerId: "workspaces.owner_id" } }));

import { encodeSession, SESSION_COOKIE } from "./jwt";
import { createSession, getSession, revokeSessions, setActiveWorkspace, WORKSPACE_COOKIE } from "./session";

const alice = { userId: "u1", email: "alice@example.com", name: "Alice", sessionVersion: 0 };
const WS2 = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  h.state.cookies = {};
  h.state.user = { sessionVersion: 0 };
  h.state.owned = ["u1"];
});

describe("getSession", () => {
  it("accepts a token whose version matches the user's row", async () => {
    await createSession(alice);
    expect(await getSession()).toEqual({ ...alice, accountId: "u1" });
  });

  it("rejects a token after the user's sessions are revoked", async () => {
    const stolen = await encodeSession(alice);
    await revokeSessions("u1");
    h.state.cookies[SESSION_COOKIE] = stolen;
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
    expect(await getSession()).toEqual({ ...alice, sessionVersion: 1, accountId: "u1" });
  });
});

describe("getSession workspaces", () => {
  it("makes an owned workspace the active one", async () => {
    h.state.owned = ["u1", WS2];
    await createSession(alice);
    setActiveWorkspace(WS2);
    expect(await getSession()).toMatchObject({ userId: WS2, accountId: "u1" });
  });

  it("falls back to the first workspace when the cookie names one the user does not own", async () => {
    await createSession(alice);
    setActiveWorkspace(WS2);
    expect(await getSession()).toMatchObject({ userId: "u1", accountId: "u1" });
  });

  it("ignores a cookie that is not a workspace id", async () => {
    await createSession(alice);
    h.state.cookies[WORKSPACE_COOKIE] = "'; drop table users; --";
    expect(await getSession()).toMatchObject({ userId: "u1" });
    expect(h.state.asked).toBe("u1");
  });
});
