import { describe, it, expect } from "vitest";
import { confirmStep } from "./useConfirmClick";

describe("confirmStep", () => {
  it("arms on the first click and does not fire", () => {
    expect(confirmStep(null, "a")).toEqual({ armed: "a", fire: false });
  });
  it("fires on a second click on the same key and disarms", () => {
    expect(confirmStep("a", "a")).toEqual({ armed: null, fire: true });
  });
  it("re-arms instead of firing when another key is clicked", () => {
    expect(confirmStep("a", "b")).toEqual({ armed: "b", fire: false });
  });
});
