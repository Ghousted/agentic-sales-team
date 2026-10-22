import { describe, expect, it, vi } from "vitest";
import { callAction, ACTION_FAILED } from "@/lib/auth/call-action";

describe("callAction", () => {
  it("clears loading and reports an error when the action throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const loading: boolean[] = [];
    const onError = vi.fn();
    const res = await callAction(() => Promise.reject(new Error("fetch failed")), onError, (on) => loading.push(on));
    expect(res).toBeUndefined();
    expect(onError).toHaveBeenCalledWith(ACTION_FAILED);
    expect(loading).toEqual([true, false]);
  });

  it("returns the action's result and clears loading on success", async () => {
    const loading: boolean[] = [];
    const onError = vi.fn();
    const res = await callAction(async () => ({ ok: false, error: "Wrong password" }), onError, (on) => loading.push(on));
    expect(res).toEqual({ ok: false, error: "Wrong password" });
    expect(onError).not.toHaveBeenCalled();
    expect(loading).toEqual([true, false]);
  });
});
