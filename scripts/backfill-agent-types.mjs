// One-time backfill: set type/capabilities on created agents that predate the
// typed-agent migration, inferring from the legacy `role` label. Unmatched rows
// stay type='custom' with empty capabilities (safe; editable in the UI).
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[m[1]] = v;
}
const sql = neon(env.DATABASE_URL);

const BY_ROLE = {
  "SDR": ["sdr", ["scrape", "outreach", "follow-up"]],
  "BDR": ["bdr", ["outreach", "follow-up"]],
  "Account Executive": ["ae", ["outreach", "book-meeting"]],
  "Sales Manager": ["manager", []],
  "Customer Success": ["csm", ["follow-up"]],
  "Recruiter": ["recruiter", ["scrape", "outreach"]],
};

let updated = 0;
for (const [role, [type, caps]] of Object.entries(BY_ROLE)) {
  const res = await sql`update agents set type = ${type}, capabilities = ${JSON.stringify(caps)}::jsonb
    where role = ${role} and type = 'custom' returning id`;
  updated += res.length;
}
console.log(`Backfilled ${updated} agent(s) by role.`);
