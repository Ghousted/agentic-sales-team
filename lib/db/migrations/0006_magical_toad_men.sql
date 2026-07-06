CREATE TABLE "team_members" (
	"user_id" uuid NOT NULL,
	"team_id" text NOT NULL,
	"members" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "team_members_user_id_team_id_pk" PRIMARY KEY("user_id","team_id")
);
--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;