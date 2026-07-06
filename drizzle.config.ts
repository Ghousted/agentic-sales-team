import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Load .env.local so drizzle-kit (migrations/push) sees DATABASE_URL.
config({ path: ".env.local" });

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
