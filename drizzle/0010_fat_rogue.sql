ALTER TABLE "cad_models" ADD COLUMN "primary_level_title" text;--> statement-breakpoint
ALTER TABLE "cad_models" ADD COLUMN "other_level_titles" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "cad_models" ADD COLUMN "other_level_entity_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cad_models" ADD COLUMN "declared_type" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "cad_models" ADD COLUMN "preferred_level_keyword" text;