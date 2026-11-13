import { describe, expect, it } from "vitest";
import { isAllRequest } from "./outreachTarget";

describe("isAllRequest", () => {
  it("is true for an ask to reach the whole list", () => {
    for (const m of ["all", "write to all", "email everyone", "all of them", "draft outreach to all leads", "the whole list"]) expect(isAllRequest(m)).toBe(true);
  });

  it("is false when 'all' is part of a narrower ask", () => {
    for (const m of ["email all the dentists", "Maria and all her colleagues", "call Ana", "small clinics"]) expect(isAllRequest(m)).toBe(false);
  });
});
