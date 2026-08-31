CREATE TABLE "payment_milestones" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"amount" real NOT NULL,
	"due_date" timestamp,
	"sequence_order" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_records" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"client_id" text NOT NULL,
	"milestone_id" text,
	"amount" real NOT NULL,
	"paid_date" timestamp NOT NULL,
	"mode" text DEFAULT 'bank_transfer' NOT NULL,
	"reference" text,
	"receipt_file_id" text,
	"notes" text,
	"recorded_by_user_id" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_payment_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"client_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"total_fee_amount" real,
	"currency" text DEFAULT 'INR' NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "project_payment_settings_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
ALTER TABLE "payment_milestones" ADD CONSTRAINT "payment_milestones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_milestones" ADD CONSTRAINT "payment_milestones_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_milestone_id_payment_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."payment_milestones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_receipt_file_id_files_id_fk" FOREIGN KEY ("receipt_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_payment_settings" ADD CONSTRAINT "project_payment_settings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_payment_settings" ADD CONSTRAINT "project_payment_settings_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;