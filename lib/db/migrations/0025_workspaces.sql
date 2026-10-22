CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Every account gets its first workspace, with the account's own id, so every
-- existing row (user_id = the account id) already points at a valid workspace.
INSERT INTO "workspaces" ("id", "owner_id", "name", "created_at")
SELECT "id", "id", "workspace_name", "created_at" FROM "users"
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "activity" DROP CONSTRAINT "activity_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_config" DROP CONSTRAINT "agent_config_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_states" DROP CONSTRAINT "agent_states_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "agents" DROP CONSTRAINT "agents_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "job_steps" DROP CONSTRAINT "job_steps_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "leads" DROP CONSTRAINT "leads_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "matches" DROP CONSTRAINT "matches_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "meetings" DROP CONSTRAINT "meetings_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "outreach_drafts" DROP CONSTRAINT "outreach_drafts_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "product_folders" DROP CONSTRAINT "product_folders_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT "products_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "proposals" DROP CONSTRAINT "proposals_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "team_members" DROP CONSTRAINT "team_members_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "teams" DROP CONSTRAINT "teams_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspaces_owner_id_idx" ON "workspaces" USING btree ("owner_id");--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_user_id_workspaces_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_config" ADD CONSTRAINT "agent_config_user_id_workspaces_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_states" ADD CONSTRAINT "agent_states_user_id_workspaces_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_user_id_workspaces_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_steps" ADD CONSTRAINT "job_steps_user_id_workspaces_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_user_id_workspaces_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_user_id_workspaces_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_user_id_workspaces_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_user_id_workspaces_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_user_id_workspaces_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_drafts" ADD CONSTRAINT "outreach_drafts_user_id_workspaces_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_folders" ADD CONSTRAINT "product_folders_user_id_workspaces_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_user_id_workspaces_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_user_id_workspaces_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_workspaces_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_user_id_workspaces_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;