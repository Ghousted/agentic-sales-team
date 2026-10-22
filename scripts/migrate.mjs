// Non-interactive migration runner: applies any *.sql files in lib/db/migrations
// that haven't been applied yet (tracked in a _migrations table). Idempotent.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";

config({ path: ".env.local" });
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (add it to .env.local).");
  process.exit(1);
}
const sql = neon(url); // use sql.query(text, params?) for raw strings; sql`...` for tagged templates

await sql.query(`CREATE TABLE IF NOT EXISTS "_migrations" (
  "name" text PRIMARY KEY,
  "applied_at" timestamptz NOT NULL DEFAULT now()
)`);

const dir = join(process.cwd(), "lib/db/migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const done = new Set((await sql.query(`SELECT name FROM "_migrations"`)).map((r) => r.name));

let applied = 0;
for (const file of files) {
  if (done.has(file)) { console.log("· skip (already applied):", file); continue; }
  const raw = readFileSync(join(dir, file), "utf8");
  const statements = raw.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
  // The statements and the _migrations row go in one transaction, so a failed
  // migration leaves nothing half-applied and is retried whole on the next run.
  await sql.transaction([
    ...statements.map((stmt) => sql.query(stmt)),
    sql.query(`INSERT INTO "_migrations" (name) VALUES ($1)`, [file]),
  ]);
  console.log("✓ applied:", file, `(${statements.length} statement(s))`);
  applied++;
}
console.log(`\nDone. ${applied} migration(s) applied, ${files.length - applied} already up to date.`);
