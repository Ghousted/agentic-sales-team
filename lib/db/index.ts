// Neon serverless Postgres client wired to Drizzle.
// Lazily initialized so importing this module never throws when DATABASE_URL is
// absent — callers guard on isDbConfigured() and only touch getDb() when set.
import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

let _db: NeonHttpDatabase<typeof schema> | null = null;

export function isDbConfigured(): boolean {
  return !!process.env.DATABASE_URL;
}

export function getDb(): NeonHttpDatabase<typeof schema> {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Add it to .env.local (see .env.example).");
  _db = drizzle(neon(url), { schema });
  return _db;
}

export * from "./schema";
