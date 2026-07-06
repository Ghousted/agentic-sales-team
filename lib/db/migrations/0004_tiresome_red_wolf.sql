CREATE TABLE "agent_config" (
	"user_id" uuid NOT NULL,
	"agent_id" text NOT NULL,
	"role" text,
	"goal" text,
	"permissions" jsonb,
	CONSTRAINT "agent_config_user_id_agent_id_pk" PRIMARY KEY("user_id","agent_id")
);
--> statement-breakpoint
ALTER TABLE "agent_config" ADD CONSTRAINT "agent_config_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;