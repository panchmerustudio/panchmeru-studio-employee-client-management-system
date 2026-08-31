CREATE TABLE "location_exception_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"attendance_event_id" text NOT NULL,
	"reviewed_by_user_id" text NOT NULL,
	"note" text,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "location_exception_reviews_attendance_event_id_unique" UNIQUE("attendance_event_id")
);
--> statement-breakpoint
CREATE TABLE "location_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"retention_days" integer DEFAULT 90 NOT NULL,
	"updated_by" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "location_exception_reviews" ADD CONSTRAINT "location_exception_reviews_attendance_event_id_attendance_events_id_fk" FOREIGN KEY ("attendance_event_id") REFERENCES "public"."attendance_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_exception_reviews" ADD CONSTRAINT "location_exception_reviews_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_settings" ADD CONSTRAINT "location_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;