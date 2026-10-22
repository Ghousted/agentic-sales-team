import "server-only";
// Throttling for the auth actions. Counters live in Postgres (auth_rate_limits),
// not memory, because each Vercel instance would otherwise keep its own count.
// One upsert per hit keeps the increment atomic, so parallel guesses can't all
// slip in under the limit.
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";

export interface Limit {
  max: number;
  windowSec: number;
}

const MIN = 60;
const HOUR = 60 * MIN;

/** Per action: attempts allowed per IP and per email inside one fixed window. */
export const AUTH_LIMITS = {
  signIn: { ip: { max: 20, windowSec: 15 * MIN }, email: { max: 5, windowSec: 15 * MIN } },
  signUp: { ip: { max: 5, windowSec: HOUR }, email: { max: 5, windowSec: HOUR } },
  resetRequest: { ip: { max: 5, windowSec: HOUR }, email: { max: 3, windowSec: HOUR } },
  resetPassword: { ip: { max: 10, windowSec: HOUR } },
} satisfies Record<string, { ip: Limit; email?: Limit }>;

export type AuthAction = keyof typeof AUTH_LIMITS;

/** First hop of x-forwarded-for (Vercel sets it), then x-real-ip. */
export function clientIp(h: { get(name: string): string | null }): string {
  const fwd = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || h.get("x-real-ip")?.trim() || "unknown";
}

// Emails go into the table hashed, so the counters hold no addresses.
function emailKey(action: AuthAction, email: string): string {
  return `${action}:email:${createHash("sha256").update(email).digest("hex")}`;
}

/** Count one attempt against `key`; false once the window's count passes `limit.max`. */
async function hit(key: string, limit: Limit): Promise<{ allowed: boolean; retryAfterSec: number }> {
  const res = await getDb().execute(sql`
    INSERT INTO auth_rate_limits (key, count, window_start) VALUES (${key}, 1, now())
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN auth_rate_limits.window_start <= now() - make_interval(secs => ${limit.windowSec})
                   THEN 1 ELSE auth_rate_limits.count + 1 END,
      window_start = CASE WHEN auth_rate_limits.window_start <= now() - make_interval(secs => ${limit.windowSec})
                   THEN now() ELSE auth_rate_limits.window_start END
    RETURNING count, ceil(extract(epoch FROM window_start + make_interval(secs => ${limit.windowSec}) - now()))::int AS retry_after`);
  const row = res.rows[0] as { count: number | string; retry_after: number | string } | undefined;
  const count = Number(row?.count ?? 0);
  return { allowed: count <= limit.max, retryAfterSec: Math.max(1, Number(row?.retry_after ?? limit.windowSec)) };
}

function tooMany(retryAfterSec: number): string {
  const mins = Math.ceil(retryAfterSec / 60);
  return `Too many attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`;
}

/**
 * Count this attempt for the caller's IP and (when given) the email. Returns an
 * error message when either is over its limit, else null. The message never
 * depends on whether the email has an account. If the counter table can't be
 * reached the attempt is allowed and the error logged, so a DB hiccup or a
 * missing migration doesn't lock everyone out.
 */
export async function checkAuthLimit(action: AuthAction, email?: string): Promise<string | null> {
  try {
    const limits: { ip: Limit; email?: Limit } = AUTH_LIMITS[action];
    const ip = clientIp(headers());
    const checks = [hit(`${action}:ip:${ip}`, limits.ip)];
    if (email && limits.email) checks.push(hit(emailKey(action, email), limits.email));
    const blocked = (await Promise.all(checks)).filter((r) => !r.allowed);
    if (!blocked.length) return null;
    return tooMany(Math.max(...blocked.map((r) => r.retryAfterSec)));
  } catch (e) {
    console.error("[rateLimit] counter unavailable; allowing attempt:", e);
    return null;
  }
}

/** After a successful sign-in, forget that email's failed attempts. */
export async function clearAuthLimit(action: AuthAction, email: string): Promise<void> {
  try {
    await getDb().execute(sql`DELETE FROM auth_rate_limits WHERE key = ${emailKey(action, email)}`);
  } catch (e) {
    console.error("[rateLimit] clear failed:", e);
  }
}
