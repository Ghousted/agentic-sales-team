import "server-only";
// SQL helpers for limits that must hold across all of an account's workspaces,
// so making more workspaces never makes more room under a daily quota.
import { eq, inArray, type AnyColumn } from "drizzle-orm";
import { getDb, workspaces } from "@/lib/db";

/** `column IN (every workspace the account owns)`. */
export function inAccountWorkspaces(column: AnyColumn, accountId: string) {
  return inArray(column, getDb().select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.ownerId, accountId)));
}
