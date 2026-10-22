import { describe, expect, it } from "vitest";
import { clampInt, jobQuotaError, limitJobSize, DAILY_JOB_QUOTA, DAILY_SCRAPE_QUOTA, MAX_BATCH_SIZE, MAX_SCRAPE_TARGET } from "./limits";

describe("clampInt", () => {
  it("keeps a whole number inside the range", () => {
    expect(clampInt(7.9, 1, 25, 5)).toBe(7);
    expect(clampInt(-3, 1, 25, 5)).toBe(1);
    expect(clampInt(1e9, 1, 25, 5)).toBe(25);
  });

  it("uses the fallback for anything that isn't a finite number", () => {
    for (const v of [undefined, null, "10", NaN, Infinity, {}]) expect(clampInt(v, 1, 25, 5)).toBe(5);
  });
});

describe("limitJobSize", () => {
  it("fills defaults", () => {
    expect(limitJobSize({})).toEqual({ leadIds: null, batchSize: 5, target: 10, instruction: null });
  });

  it("clamps the numbers", () => {
    expect(limitJobSize({ batchSize: 0, target: 1e6 })).toMatchObject({ batchSize: 1, target: MAX_SCRAPE_TARGET });
    expect(limitJobSize({ batchSize: 1e6 })).toMatchObject({ batchSize: MAX_BATCH_SIZE });
  });

  it("refuses lead lists and instructions of the wrong type", () => {
    expect(limitJobSize({ leadIds: "lead-1" })).toHaveProperty("error");
    expect(limitJobSize({ leadIds: [1, 2] })).toHaveProperty("error");
    expect(limitJobSize({ instruction: { $gt: "" } })).toHaveProperty("error");
  });

  it("trims the instruction", () => {
    expect(limitJobSize({ instruction: "  founders  " })).toMatchObject({ instruction: "founders" });
    expect(limitJobSize({ instruction: "   " })).toMatchObject({ instruction: null });
  });
});

describe("jobQuotaError", () => {
  it("allows a job under both quotas", () => {
    expect(jobQuotaError("scrape", { total: DAILY_JOB_QUOTA - 1, scrapes: DAILY_SCRAPE_QUOTA - 1 })).toBeNull();
  });

  it("applies the scrape quota to scrapes only", () => {
    expect(jobQuotaError("scrape", { total: DAILY_SCRAPE_QUOTA, scrapes: DAILY_SCRAPE_QUOTA })).toMatch(/lead searches/);
    expect(jobQuotaError("research", { total: DAILY_SCRAPE_QUOTA, scrapes: DAILY_SCRAPE_QUOTA })).toBeNull();
  });

  it("applies the job quota to every kind", () => {
    expect(jobQuotaError("research", { total: DAILY_JOB_QUOTA, scrapes: 0 })).toMatch(/runs/);
  });
});
