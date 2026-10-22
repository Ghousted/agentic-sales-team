ALTER TABLE "leads" ADD COLUMN "matched_at" timestamp with time zone;--> statement-breakpoint
-- Backfill: leads that already have match rows are not re-picked by the matchmaker.
UPDATE "leads" SET "matched_at" = m."at"
FROM (
  SELECT "lead_id", min("created_at") AS "at" FROM "matches"
  GROUP BY "lead_id"
) m
WHERE "leads"."id" = m."lead_id";
