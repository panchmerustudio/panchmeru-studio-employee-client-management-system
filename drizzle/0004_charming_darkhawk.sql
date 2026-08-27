CREATE TABLE "plot_surveys" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"site_visit_id" text,
	"survey_number" integer NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"started_at" timestamp NOT NULL,
	"ended_at" timestamp,
	"paused_seconds" integer DEFAULT 0 NOT NULL,
	"captured_by" text NOT NULL,
	"raw_points" jsonb,
	"raw_area_sq_ft" real,
	"raw_perimeter_ft" real,
	"raw_segments" jsonb,
	"shape_type" text,
	"is_adjusted" boolean DEFAULT false NOT NULL,
	"adjusted_points" jsonb,
	"adjusted_area_sq_ft" real,
	"adjusted_perimeter_ft" real,
	"adjusted_segments" jsonb,
	"adjusted_by" text,
	"adjusted_at" timestamp,
	"adjustment_reason" text,
	"avg_accuracy_m" real,
	"point_count" integer DEFAULT 0 NOT NULL,
	"outlier_count" integer DEFAULT 0 NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp,
	"review_note" text,
	"supersedes_id" text,
	"superseded_reason" text,
	"is_professional_survey" boolean DEFAULT false NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "survey_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"survey_id" text NOT NULL,
	"author_id" text NOT NULL,
	"type" text NOT NULL,
	"text" text,
	"voice_note_id" text,
	"file_id" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "survey_pauses" (
	"id" text PRIMARY KEY NOT NULL,
	"survey_id" text NOT NULL,
	"paused_at" timestamp NOT NULL,
	"resumed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "survey_points" (
	"id" text PRIMARY KEY NOT NULL,
	"survey_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"latitude" real NOT NULL,
	"longitude" real NOT NULL,
	"accuracy" real,
	"captured_at" timestamp NOT NULL,
	"is_outlier" boolean DEFAULT false NOT NULL,
	"outlier_reason" text
);
--> statement-breakpoint
ALTER TABLE "plot_surveys" ADD CONSTRAINT "plot_surveys_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plot_surveys" ADD CONSTRAINT "plot_surveys_site_visit_id_site_visits_id_fk" FOREIGN KEY ("site_visit_id") REFERENCES "public"."site_visits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plot_surveys" ADD CONSTRAINT "plot_surveys_captured_by_users_id_fk" FOREIGN KEY ("captured_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plot_surveys" ADD CONSTRAINT "plot_surveys_adjusted_by_users_id_fk" FOREIGN KEY ("adjusted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plot_surveys" ADD CONSTRAINT "plot_surveys_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_notes" ADD CONSTRAINT "survey_notes_survey_id_plot_surveys_id_fk" FOREIGN KEY ("survey_id") REFERENCES "public"."plot_surveys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_notes" ADD CONSTRAINT "survey_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_notes" ADD CONSTRAINT "survey_notes_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_pauses" ADD CONSTRAINT "survey_pauses_survey_id_plot_surveys_id_fk" FOREIGN KEY ("survey_id") REFERENCES "public"."plot_surveys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_points" ADD CONSTRAINT "survey_points_survey_id_plot_surveys_id_fk" FOREIGN KEY ("survey_id") REFERENCES "public"."plot_surveys"("id") ON DELETE cascade ON UPDATE no action;