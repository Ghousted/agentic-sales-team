ALTER TABLE "leads" ADD COLUMN "qualified_at" timestamp with time zone;--> statement-breakpoint
-- Backfill: leads the qualify stage already scored keep their score and are not re-picked.
UPDATE "leads" SET "qualified_at" = q."at"
FROM (
  SELECT "lead_id", max("created_at") AS "at" FROM "activity"
  WHERE "type" = 'lead_qualified' AND "lead_id" IS NOT NULL
  GROUP BY "lead_id"
) q
WHERE "leads"."id" = q."lead_id";
