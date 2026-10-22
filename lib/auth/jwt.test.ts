import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { encodeSession, verifySession } from "./jwt";

const devSecret = () => new TextEncoder().encode("dev-insecure-secret-change-me");
const alice = { userId: "u1", email: "alice@example.com", name: "Alice", sessionVersion: 3 };

describe("session JWT", () => {
  it("round-trips the payload, including the session version", async () => {
    expect(await verifySession(await encodeSession(alice))).toEqual(alice);
  });

  it("reads a token issued before session versions existed as version 0", async () => {
    const legacy = await new SignJWT({ userId: "u1", email: "alice@example.com", name: "Alice" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(devSecret());
    expect(await verifySession(legacy)).toEqual({ ...alice, sessionVersion: 0 });
  });

  it("rejects a token signed with another secret", async () => {
    const forged = await new SignJWT({ ...alice })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("someone-elses-secret"));
    expect(await verifySession(forged)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const expired = await new SignJWT({ ...alice })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(devSecret());
    expect(await verifySession(expired)).toBeNull();
  });

  it("rejects garbage", async () => {
    expect(await verifySession("not-a-jwt")).toBeNull();
  });
});
