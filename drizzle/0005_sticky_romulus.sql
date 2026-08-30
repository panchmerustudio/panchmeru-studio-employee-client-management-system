CREATE TABLE "cad_entities" (
	"id" text PRIMARY KEY NOT NULL,
	"model_id" text NOT NULL,
	"type" text NOT NULL,
	"layer_name" text NOT NULL,
	"label" text,
	"geometry" jsonb NOT NULL,
	"width_mm" real,
	"depth_mm" real,
	"height_mm" real,
	"rotation_deg" real DEFAULT 0,
	"locked" boolean DEFAULT true NOT NULL,
	"source_handle" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cad_missing_inputs" (
	"id" text PRIMARY KEY NOT NULL,
	"model_id" text NOT NULL,
	"kind" text NOT NULL,
	"question" text NOT NULL,
	"resolved_value_mm" real,
	"resolved_by" text,
	"resolved_at" timestamp,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cad_models" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"source_file_id" text NOT NULL,
	"units" text DEFAULT 'mm' NOT NULL,
	"status" text DEFAULT 'parsing' NOT NULL,
	"parse_error" text,
	"floor_height_mm" real,
	"door_height_mm" real,
	"window_height_mm" real,
	"window_sill_mm" real,
	"wall_default_thickness_mm" real,
	"entity_counts" jsonb,
	"unclassified_count" integer DEFAULT 0 NOT NULL,
	"ignored_annotation_count" integer DEFAULT 0 NOT NULL,
	"approved_by" text,
	"approved_at" timestamp,
	"created_by" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cad_entities" ADD CONSTRAINT "cad_entities_model_id_cad_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."cad_models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cad_missing_inputs" ADD CONSTRAINT "cad_missing_inputs_model_id_cad_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."cad_models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cad_missing_inputs" ADD CONSTRAINT "cad_missing_inputs_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cad_models" ADD CONSTRAINT "cad_models_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cad_models" ADD CONSTRAINT "cad_models_source_file_id_files_id_fk" FOREIGN KEY ("source_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cad_models" ADD CONSTRAINT "cad_models_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cad_models" ADD CONSTRAINT "cad_models_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;