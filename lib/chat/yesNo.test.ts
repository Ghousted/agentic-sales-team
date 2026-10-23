import { describe, expect, it } from "vitest";
import { readDecision } from "./yesNo";

describe("readDecision", () => {
  it("reads a clear yes", () => {
    for (const t of ["yes", "Yes!", "yeah", "ok", "Okay.", "go ahead", "Yes, go ahead", "proceed", "ok do it", "do it", "yes please", "let's go", "sounds good"]) {
      expect(readDecision(t), t).toBe("yes");
    }
  });

  it("reads a clear no", () => {
    for (const t of ["no", "No.", "nope", "cancel", "stop", "Don’t do it", "no thanks", "never mind", "abort"]) {
      expect(readDecision(t), t).toBe("no");
    }
  });

  it("decides nothing for anything else", () => {
    for (const t of ["", "yes but only the first 5", "ok stop", "find leads in Manila", "who are they?", "no idea, what do you think", "it", "yes ".repeat(20)]) {
      expect(readDecision(t), t).toBeNull();
    }
  });
});
