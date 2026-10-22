import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("drizzle-orm", () => ({ sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ text: strings.join("?"), values }) }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ execute: h.execute }) }));
vi.mock("next/headers", () => ({ headers: () => new Headers({ "x-forwarded-for": "203.0.113.7" }) }));

import { checkAuthLimit, clientIp } from "./rateLimit";

beforeEach(() => {
  h.execute.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("clientIp", () => {
  it("takes the first x-forwarded-for hop", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": " 203.0.113.7 , 10.0.0.1" }))).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip, then 'unknown'", () => {
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.9" }))).toBe("198.51.100.9");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});

describe("checkAuthLimit", () => {
  it("allows a count at the limit and blocks one over it, with a retry time in minutes", async () => {
    h.execute.mockResolvedValue({ rows: [{ count: 5, retry_after: 600 }] });
    expect(await checkAuthLimit("signIn", "a@example.com")).toBeNull();
    h.execute.mockResolvedValueOnce({ rows: [{ count: 1, retry_after: 900 }] }).mockResolvedValueOnce({ rows: [{ count: 6, retry_after: 61 }] });
    expect(await checkAuthLimit("signIn", "a@example.com")).toBe("Too many attempts. Try again in 2 minutes.");
  });

  it("counts the IP and the email as separate keys", async () => {
    h.execute.mockResolvedValue({ rows: [{ count: 1, retry_after: 900 }] });
    await checkAuthLimit("signIn", "a@example.com");
    const keys = h.execute.mock.calls.map(([q]) => q.values[0]);
    expect(keys).toEqual(["signIn:ip:203.0.113.7", expect.stringMatching(/^signIn:email:[0-9a-f]{64}$/)]);
  });

  it("allows the attempt when the counter table can't be reached", async () => {
    h.execute.mockRejectedValue(new Error('relation "auth_rate_limits" does not exist'));
    expect(await checkAuthLimit("signIn", "a@example.com")).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });
});
