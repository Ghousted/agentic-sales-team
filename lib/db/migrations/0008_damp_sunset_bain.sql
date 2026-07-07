ALTER TABLE "agent_config" ADD COLUMN "settings" jsonb;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "type" text DEFAULT 'custom' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "template" text DEFAULT 'custom' NOT NULL;