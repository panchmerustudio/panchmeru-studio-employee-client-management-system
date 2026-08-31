CREATE TABLE "vendor_activities" (
	"id" text PRIMARY KEY NOT NULL,
	"vendor_id" text NOT NULL,
	"project_id" text,
	"activity_type" text NOT NULL,
	"description" text NOT NULL,
	"related_entity_type" text,
	"related_entity_id" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"vendor_id" text NOT NULL,
	"project_id" text NOT NULL,
	"site_id" text,
	"assigned_by_user_id" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_category_access" (
	"id" text PRIMARY KEY NOT NULL,
	"vendor_id" text NOT NULL,
	"document_category_id" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"granted_by_user_id" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"vendor_user_id" text NOT NULL,
	"session_token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "vendor_sessions_session_token_unique" UNIQUE("session_token")
);
--> statement-breakpoint
CREATE TABLE "vendor_users" (
	"id" text PRIMARY KEY NOT NULL,
	"vendor_id" text NOT NULL,
	"contact_name" text,
	"email" text NOT NULL,
	"password_hash" text,
	"status" text DEFAULT 'invited' NOT NULL,
	"last_login_at" timestamp,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "vendor_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "vendor_activities" ADD CONSTRAINT "vendor_activities_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_activities" ADD CONSTRAINT "vendor_activities_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_assignments" ADD CONSTRAINT "vendor_assignments_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_assignments" ADD CONSTRAINT "vendor_assignments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_assignments" ADD CONSTRAINT "vendor_assignments_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_assignments" ADD CONSTRAINT "vendor_assignments_assigned_by_user_id_users_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_category_access" ADD CONSTRAINT "vendor_category_access_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_category_access" ADD CONSTRAINT "vendor_category_access_document_category_id_document_categories_id_fk" FOREIGN KEY ("document_category_id") REFERENCES "public"."document_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_category_access" ADD CONSTRAINT "vendor_category_access_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_sessions" ADD CONSTRAINT "vendor_sessions_vendor_user_id_vendor_users_id_fk" FOREIGN KEY ("vendor_user_id") REFERENCES "public"."vendor_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_users" ADD CONSTRAINT "vendor_users_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;