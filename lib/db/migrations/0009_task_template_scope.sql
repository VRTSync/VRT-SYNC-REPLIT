-- Add scope enum and column to task_templates to distinguish HOA vs commercial templates.

--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."template_scope" AS ENUM('all', 'hoa', 'commercial');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

--> statement-breakpoint
ALTER TABLE "task_templates"
  ADD COLUMN IF NOT EXISTS "scope" "template_scope" NOT NULL DEFAULT 'all';
