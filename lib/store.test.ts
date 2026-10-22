import { createElement, type ComponentProps } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  saveAgent: vi.fn(),
  saveTeam: vi.fn(),
  saveAgentConfig: vi.fn(),
}));

vi.mock("./workspace/actions", () => ({
  saveAgent: h.saveAgent,
  saveTeam: h.saveTeam,
  saveAgentConfig: h.saveAgentConfig,
  saveTeamMeta: vi.fn(),
  deleteTeam: vi.fn(),
  setAgentRemoved: vi.fn(),
  setAgentPaused: vi.fn(),
  clearMessages: vi.fn(),
  saveTeamMembers: vi.fn(),
}));
vi.mock("./auth/actions", () => ({ signOut: vi.fn() }));
vi.mock("./chat/actions", () => ({ teamChat: vi.fn(), reportTeamJob: vi.fn() }));

import { AppProvider, persistOrRollback, selectedMembers, useApp } from "./store";

// No DOM in this repo's test setup, so render the provider once on the server
// and keep the context it hands out. The create actions read the initial state.
function grabCtx(): ReturnType<typeof useApp> {
  let ctx: ReturnType<typeof useApp> | null = null;
  const Grab = () => { ctx = useApp(); return null; };
  const props = { initialUser: null, initialWorkspace: null } as ComponentProps<typeof AppProvider>;
  renderToString(createElement(AppProvider, props, createElement(Grab)));
  if (!ctx) throw new Error("no context");
  return ctx;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.saveAgent.mockReset().mockResolvedValue(undefined);
  h.saveTeam.mockReset().mockResolvedValue(undefined);
  h.saveAgentConfig.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("persistOrRollback", () => {
  it("rolls back and reports when the save fails", async () => {
    const rollback = vi.fn();
    const onError = vi.fn();
    const err = new Error("db down");
    await expect(persistOrRollback(() => Promise.reject(err), rollback, onError)).resolves.toBe(false);
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(err);
  });

  it("leaves the change alone when the save succeeds", async () => {
    const rollback = vi.fn();
    const onError = vi.fn();
    await expect(persistOrRollback(() => Promise.resolve(), rollback, onError)).resolves.toBe(true);
    expect(rollback).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});

describe("create actions wait for the server save", () => {
  it("createTeam resolves to null when saveTeam fails, so the caller doesn't open a team that wasn't stored", async () => {
    h.saveTeam.mockRejectedValue(new Error("Not signed in."));
    const ctx = grabCtx();
    await expect(Promise.resolve(ctx.createTeam())).resolves.toBeNull();
    expect(h.saveTeam).toHaveBeenCalledTimes(1);
  });

  it("createTeam resolves to the stored team's id when saveTeam succeeds", async () => {
    const ctx = grabCtx();
    const id = await ctx.createTeam();
    expect(id).toMatch(/^tx/);
    expect(h.saveTeam.mock.calls[0][0].id).toBe(id);
  });

  it("createTeam doesn't save twice while the first save is in flight", async () => {
    let finish: () => void = () => {};
    h.saveTeam.mockImplementation(() => new Promise<void>((r) => { finish = r; }));
    const ctx = grabCtx();
    const first = ctx.createTeam();
    await expect(ctx.createTeam()).resolves.toBeNull();
    finish();
    await expect(first).resolves.toMatch(/^tx/);
    expect(h.saveTeam).toHaveBeenCalledTimes(1);
  });

  it("quickCreateAgent resolves to null when saveAgent fails, so the team modal doesn't select a ghost agent", async () => {
    h.saveAgent.mockRejectedValue(new Error("db down"));
    const ctx = grabCtx();
    await expect(Promise.resolve(ctx.quickCreateAgent("sdr", "Ava"))).resolves.toBeNull();
  });

  it("quickCreateAgent resolves to the stored agent's id when saveAgent succeeds", async () => {
    const ctx = grabCtx();
    const id = await ctx.quickCreateAgent("sdr", "Ava");
    expect(id).toMatch(/^x/);
    expect(h.saveAgent.mock.calls[0][0]).toMatchObject({ id, name: "Ava" });
  });

  it("createAgent waits for saveAgent before it finishes", async () => {
    let finish: () => void = () => {};
    h.saveAgent.mockImplementation(() => new Promise<void>((r) => { finish = r; }));
    const ctx = grabCtx();
    let done = false;
    const p = Promise.resolve(ctx.createAgent()).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    finish();
    await p;
    expect(done).toBe(true);
  });
});

describe("team modal member selection", () => {
  const agents = [{ id: "a1" }, { id: "a2" }];

  it("selectedMembers is empty when nothing is ticked", () => {
    expect(selectedMembers({}, agents)).toEqual([]);
  });

  it("selectedMembers drops ticked ids that aren't real agents", () => {
    expect(selectedMembers({ sk: true, mt: true, a2: true }, agents)).toEqual(["a2"]);
  });

  it("selectedMembers drops unticked agents", () => {
    expect(selectedMembers({ a1: false, a2: true }, agents)).toEqual(["a2"]);
  });

  it("a team created with the defaults has no members", async () => {
    const ctx = grabCtx();
    expect(ctx.s.tSel).toEqual({});
    await ctx.createTeam();
    expect(h.saveTeam.mock.calls[0][0]).toMatchObject({ members: [], desc: "0 agents · just created" });
  });
});
