CREATE TABLE "storage_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"cap_gb" integer DEFAULT 10 NOT NULL,
	"last_notified_threshold" integer DEFAULT 0 NOT NULL,
	"updated_by" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "storage_settings" ADD CONSTRAINT "storage_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;