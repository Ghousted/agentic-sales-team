import { describe, expect, it } from "vitest";
import { decideFailMsg, settleDecision } from "./decide";

describe("settleDecision", () => {
  it("passes a success through", async () => {
    expect(await settleDecision(async () => ({ ok: true, kind: "research", pod: false }), true)).toEqual({ ok: true, kind: "research", pod: false });
  });

  it("passes a refusal through", async () => {
    expect(await settleDecision(async () => ({ error: "Not signed in." }), true)).toEqual({ error: "Not signed in." });
  });

  it("turns a thrown request into an error the caller can show", async () => {
    expect(await settleDecision(() => Promise.reject(new Error("fetch failed")), true)).toEqual({ error: decideFailMsg(true) });
    expect(await settleDecision(() => Promise.reject(new Error("fetch failed")), false)).toEqual({ error: decideFailMsg(false) });
  });

  it("treats an empty response as a failure", async () => {
    expect(await settleDecision(async () => undefined as never, false)).toEqual({ error: decideFailMsg(false) });
  });
});
