ALTER TABLE "activity" ADD COLUMN "dismissed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach_drafts" ADD COLUMN "dismissed" boolean DEFAULT false NOT NULL;