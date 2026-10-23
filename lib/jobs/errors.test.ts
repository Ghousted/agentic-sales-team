import { describe, expect, it } from "vitest";
import { UserFacingError, jobErrorMessage } from "./errors";
import { withDeadline } from "./runtime";

describe("jobErrorMessage", () => {
  it("keeps the message of an error thrown on purpose for the user", () => {
    expect(jobErrorMessage("scrape", new UserFacingError("Firecrawl 402"))).toBe("Firecrawl 402");
  });

  it("hides any other error behind a line for the job's kind", () => {
    const db = new Error('duplicate key value violates unique constraint "drafts_pkey"');
    expect(jobErrorMessage("outreach", db)).toBe("Drafting outreach failed. Please try again.");
    expect(jobErrorMessage("scrape", "boom")).toBe("The search failed. Please try again.");
    expect(jobErrorMessage("mystery", db)).toBe("This run failed. Please try again.");
  });

  it("keeps a deadline timeout readable", async () => {
    const err = await withDeadline(new Promise(() => {}), 1, "Search").catch((e) => e);
    expect(jobErrorMessage("scrape", err)).toBe("Search timed out after 0s");
  });
});
