ALTER TABLE "teams" ALTER COLUMN "pipeline" SET DEFAULT '-';--> statement-breakpoint
UPDATE "teams" SET "pipeline" = '-' WHERE "pipeline" = '—';
