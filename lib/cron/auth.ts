// Vercel Cron calls the /api/cron/* routes with `Authorization: Bearer $CRON_SECRET`.
// Middleware lets those paths through without a session, so this is their only gate;
// it refuses every call while CRON_SECRET is unset.
import "server-only";
import { timingSafeEqual } from "node:crypto";

export function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}
