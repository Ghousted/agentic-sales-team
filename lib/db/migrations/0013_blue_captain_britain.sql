CREATE TABLE "product_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "folder_id" uuid;--> statement-breakpoint
ALTER TABLE "product_folders" ADD CONSTRAINT "product_folders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_folder_id_product_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."product_folders"("id") ON DELETE set null ON UPDATE no action;