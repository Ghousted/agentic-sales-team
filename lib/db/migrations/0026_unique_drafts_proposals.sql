-- Clear duplicates left by concurrent runs before the unique indexes go on.
-- Drafts: keep each lead's newest live draft and soft-discard the others
-- (dismissed, like the Discard button), so analytics counts still see every row.
UPDATE "outreach_drafts" SET "dismissed" = true WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id", row_number() OVER (PARTITION BY "lead_id" ORDER BY "created_at" DESC, "id" DESC) AS rn
    FROM "outreach_drafts" WHERE "status" <> 'sent' AND "dismissed" = false
  ) d WHERE d.rn > 1
);--> statement-breakpoint
-- Proposals: keep one per lead (a sent one first, else the newest) and delete the rest.
DELETE FROM "proposals" WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id", row_number() OVER (PARTITION BY "lead_id" ORDER BY ("status" = 'sent') DESC, "created_at" DESC, "id" DESC) AS rn
    FROM "proposals"
  ) p WHERE p.rn > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX "outreach_drafts_live_lead_idx" ON "outreach_drafts" USING btree ("lead_id") WHERE "outreach_drafts"."status" <> 'sent' AND "outreach_drafts"."dismissed" = false;--> statement-breakpoint
CREATE UNIQUE INDEX "proposals_lead_id_idx" ON "proposals" USING btree ("lead_id");
