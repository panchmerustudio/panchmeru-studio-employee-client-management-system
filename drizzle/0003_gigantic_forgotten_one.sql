CREATE TABLE "job_applications" (
	"id" text PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"position_applied_for" text NOT NULL,
	"experience_years" real,
	"portfolio_url" text,
	"cover_note" text,
	"resume_file_id" text,
	"portfolio_file_id" text,
	"status" text DEFAULT 'new' NOT NULL,
	"reviewed_by" text,
	"review_note" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "files" ALTER COLUMN "uploaded_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_resume_file_id_files_id_fk" FOREIGN KEY ("resume_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_portfolio_file_id_files_id_fk" FOREIGN KEY ("portfolio_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;