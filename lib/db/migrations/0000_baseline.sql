-- Baseline migration capturing the full schema as of initial migration setup.
-- Generated manually for drizzle-kit compatibility with this ESM workspace.

--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."user_role" AS ENUM('contractor', 'admin', 'hoa_admin', 'hoa_member', 'property_manager');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."task_status" AS ENUM('pending', 'in_progress', 'completed', 'submitted', 'acknowledged');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."task_priority" AS ENUM('low', 'medium', 'high', 'urgent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."schedule_frequency" AS ENUM('weekly', 'monthly', 'once');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."schedule_run_status" AS ENUM('success', 'failure');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."export_status" AS ENUM('queued', 'running', 'complete', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."service_type" AS ENUM('mowing_visit');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."asset_type" AS ENUM('controller', 'backflow', 'zone', 'tree', 'pet_station', 'landscape_bed', 'bluegrass_area', 'native_area', 'snow_area');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."geometry_type" AS ENUM('point', 'polygon', 'line');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."link_type" AS ENUM('asset', 'pin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."template_target_type" AS ENUM('none', 'asset_type', 'map_layer', 'specific_asset');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."planner_record_status" AS ENUM('draft', 'reviewed', 'selected_for_estimate', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."xeriscape_packet_status" AS ENUM('draft', 'active_proposal_support', 'superseded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "communities" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "username" text NOT NULL,
  "password" text NOT NULL,
  "display_name" text NOT NULL,
  "role" "user_role" DEFAULT 'contractor' NOT NULL,
  "hoa_community_id" varchar REFERENCES "communities"("id"),
  "avatar_url" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "notification_preferences" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "users_username_unique" UNIQUE("username")
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "community_members" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "community_id" varchar NOT NULL REFERENCES "communities"("id") ON DELETE CASCADE,
  "user_id" varchar NOT NULL REFERENCES "users"("id"),
  "joined_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "community_members_community_user_idx" ON "community_members" ("community_id", "user_id");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "map_layers" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "community_id" varchar NOT NULL REFERENCES "communities"("id") ON DELETE CASCADE,
  "layer_key" text NOT NULL,
  "sub_layer_key" text NOT NULL,
  "display_name" text NOT NULL,
  "source_format" text DEFAULT 'geojson' NOT NULL,
  "geojson_data" text,
  "color" text,
  "stroke_color" text,
  "stroke_weight" integer,
  "fill_opacity" text,
  "is_enabled" boolean DEFAULT true NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "map_layers_community_layer_idx" ON "map_layers" ("community_id", "layer_key");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "map_layers_community_layer_sub_idx" ON "map_layers" ("community_id", "layer_key", "sub_layer_key");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assets" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "community_id" varchar NOT NULL REFERENCES "communities"("id") ON DELETE CASCADE,
  "asset_type" "asset_type" NOT NULL,
  "label" text NOT NULL,
  "feature_ref" text,
  "map_layer_id" varchar REFERENCES "map_layers"("id") ON DELETE CASCADE,
  "geometry_type" "geometry_type",
  "latitude" double precision,
  "longitude" double precision,
  "is_archived" boolean DEFAULT false NOT NULL,
  "archived_at" timestamp,
  "source_updated_at" timestamp,
  "tags" text[] DEFAULT '{}'::text[] NOT NULL,
  "created_by" varchar REFERENCES "users"("id"),
  "updated_by" varchar REFERENCES "users"("id"),
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_community_type_idx" ON "assets" ("community_id", "asset_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_community_feature_idx" ON "assets" ("community_id", "feature_ref");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_community_type_archived_idx" ON "assets" ("community_id", "asset_type", "is_archived");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "assets_community_layer_feature_idx" ON "assets" ("community_id", "map_layer_id", "feature_ref");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tasks" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "community_id" varchar NOT NULL REFERENCES "communities"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "description" text,
  "status" "task_status" DEFAULT 'pending' NOT NULL,
  "priority" "task_priority" DEFAULT 'medium' NOT NULL,
  "latitude" double precision,
  "longitude" double precision,
  "address" text,
  "assigned_to" varchar REFERENCES "users"("id"),
  "created_by" varchar NOT NULL REFERENCES "users"("id"),
  "start_date" timestamp,
  "due_date" timestamp,
  "ticket_type" text,
  "window_start" date,
  "window_end" date,
  "version" integer DEFAULT 1 NOT NULL,
  "schedule_instance_key" varchar,
  "import_fingerprint" varchar,
  "origin" varchar,
  "asset_id" varchar REFERENCES "assets"("id") ON DELETE SET NULL,
  "category" varchar,
  "acknowledged_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tasks_schedule_instance_key_idx" ON "tasks" ("schedule_instance_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_import_fingerprint_idx" ON "tasks" ("import_fingerprint");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_community_id_idx" ON "tasks" ("community_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_assigned_to_idx" ON "tasks" ("assigned_to");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_completions" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "task_id" varchar NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
  "completed_by" varchar NOT NULL REFERENCES "users"("id"),
  "notes" text,
  "employee_sign_off_name" text DEFAULT '' NOT NULL,
  "time_spent_minutes" integer,
  "materials_used" text,
  "follow_up_needed" text,
  "completed_at" timestamp DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "attachments" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "task_completion_id" varchar REFERENCES "task_completions"("id") ON DELETE CASCADE,
  "task_id" varchar REFERENCES "tasks"("id") ON DELETE CASCADE,
  "file_ref" text NOT NULL,
  "url" text NOT NULL,
  "uploaded_by" varchar NOT NULL REFERENCES "users"("id"),
  "idempotency_key" varchar NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "attachments_completion_idempotency_idx" ON "attachments" ("task_completion_id", "idempotency_key");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "push_tokens" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" varchar NOT NULL REFERENCES "users"("id"),
  "token" text NOT NULL,
  "platform" text NOT NULL,
  "device_id" text DEFAULT 'unknown' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "push_tokens_user_device_idx" ON "push_tokens" ("user_id", "device_id");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset_notes" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "asset_id" varchar NOT NULL REFERENCES "assets"("id") ON DELETE CASCADE,
  "community_id" varchar NOT NULL REFERENCES "communities"("id") ON DELETE CASCADE,
  "created_by" varchar NOT NULL REFERENCES "users"("id"),
  "note_text" text NOT NULL,
  "idempotency_key" varchar UNIQUE,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_notes_asset_idx" ON "asset_notes" ("asset_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_notes_community_idx" ON "asset_notes" ("community_id");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset_properties" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "asset_id" varchar NOT NULL REFERENCES "assets"("id") ON DELETE CASCADE,
  "key" text NOT NULL,
  "value" text NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "asset_properties_asset_key_idx" ON "asset_properties" ("asset_id", "key");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_links" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "task_id" varchar NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
  "link_type" "link_type" NOT NULL,
  "asset_id" varchar REFERENCES "assets"("id") ON DELETE CASCADE,
  "latitude" double precision,
  "longitude" double precision,
  "created_at" timestamp DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "offline_packs" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "community_id" varchar NOT NULL REFERENCES "communities"("id") ON DELETE CASCADE,
  "pack_version" integer DEFAULT 1 NOT NULL,
  "mbtiles_ref" text,
  "manifest_ref" text,
  "geojson_bundle_ref" text,
  "asset_index_ref" text,
  "search_index_ref" text,
  "checksum" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "offline_packs_community_version_idx" ON "offline_packs" ("community_id", "pack_version");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_templates" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "priority" "task_priority" DEFAULT 'medium' NOT NULL,
  "default_status" "task_status" DEFAULT 'pending' NOT NULL,
  "due_days_offset" integer,
  "target_type" "template_target_type" DEFAULT 'none' NOT NULL,
  "target_asset_type" text,
  "target_map_layer_id" varchar REFERENCES "map_layers"("id") ON DELETE SET NULL,
  "target_asset_id" varchar REFERENCES "assets"("id") ON DELETE SET NULL,
  "require_sign_off_name" boolean DEFAULT true NOT NULL,
  "allow_photos" boolean DEFAULT true NOT NULL,
  "created_by" varchar NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "template_runs" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "template_id" varchar NOT NULL REFERENCES "task_templates"("id") ON DELETE CASCADE,
  "community_id" varchar NOT NULL REFERENCES "communities"("id") ON DELETE CASCADE,
  "created_by" varchar NOT NULL REFERENCES "users"("id"),
  "run_at" timestamp DEFAULT now() NOT NULL,
  "task_count_created" integer DEFAULT 0 NOT NULL,
  "assignment_user_id" varchar REFERENCES "users"("id")
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_schedules" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "community_id" varchar NOT NULL REFERENCES "communities"("id") ON DELETE CASCADE,
  "template_id" varchar NOT NULL REFERENCES "task_templates"("id") ON DELETE CASCADE,
  "frequency" "schedule_frequency" DEFAULT 'weekly' NOT NULL,
  "days_of_week" text,
  "day_of_month" integer,
  "timezone" text DEFAULT 'America/Denver' NOT NULL,
  "start_date" timestamp NOT NULL,
  "end_date" timestamp,
  "next_run_at" timestamp,
  "assign_to_user_id" varchar REFERENCES "users"("id"),
  "is_enabled" boolean DEFAULT true NOT NULL,
  "created_by" varchar NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "schedule_runs" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "schedule_id" varchar NOT NULL REFERENCES "task_schedules"("id") ON DELETE CASCADE,
  "run_at" timestamp DEFAULT now() NOT NULL,
  "window_start" timestamp NOT NULL,
  "window_end" timestamp NOT NULL,
  "created_count" integer DEFAULT 0 NOT NULL,
  "skipped_count" integer DEFAULT 0 NOT NULL,
  "status" "schedule_run_status" DEFAULT 'success' NOT NULL,
  "error_message" text
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "schedule_run_items" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" varchar NOT NULL REFERENCES "schedule_runs"("id") ON DELETE CASCADE,
  "task_id" varchar NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "exports" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "community_id" varchar NOT NULL REFERENCES "communities"("id") ON DELETE CASCADE,
  "created_by" varchar NOT NULL REFERENCES "users"("id"),
  "type" text DEFAULT 'proof_of_work' NOT NULL,
  "status" "export_status" DEFAULT 'queued' NOT NULL,
  "filters" jsonb,
  "pdf_file_ref" text,
  "photos_zip_ref" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "completed_at" timestamp,
  "error_message" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "exports_community_created_idx" ON "exports" ("community_id", "created_at");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_schedules" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "community_id" varchar NOT NULL REFERENCES "communities"("id") ON DELETE CASCADE,
  "service_type" "service_type" DEFAULT 'mowing_visit' NOT NULL,
  "day_of_week" integer NOT NULL,
  "season_start" date,
  "season_end" date,
  "notes" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_visits" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "schedule_id" varchar NOT NULL REFERENCES "service_schedules"("id") ON DELETE CASCADE,
  "community_id" varchar NOT NULL REFERENCES "communities"("id") ON DELETE CASCADE,
  "service_date" date NOT NULL,
  "completed_at" timestamp,
  "completed_by" varchar REFERENCES "users"("id"),
  "employee_sign_off_name" text DEFAULT '' NOT NULL,
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "service_visits_schedule_date_idx" ON "service_visits" ("schedule_id", "service_date");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contacts" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "community_id" varchar NOT NULL REFERENCES "communities"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "title" text,
  "company" text,
  "phone" text,
  "email" text,
  "contact_type" text DEFAULT 'Other' NOT NULL,
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contacts_community_idx" ON "contacts" ("community_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contacts_type_idx" ON "contacts" ("contact_type");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "community_id" varchar NOT NULL REFERENCES "communities"("id") ON DELETE CASCADE,
  "recipient_user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "type" varchar NOT NULL,
  "title" varchar NOT NULL,
  "body" text NOT NULL,
  "related_task_id" varchar REFERENCES "tasks"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "read_at" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_recipient_idx" ON "notifications" ("recipient_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_created_at_idx" ON "notifications" ("created_at");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "drive_folders" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "community_id" varchar NOT NULL REFERENCES "communities"("id") ON DELETE CASCADE,
  "parent_id" varchar REFERENCES "drive_folders"("id") ON DELETE SET NULL,
  "name" text NOT NULL,
  "created_by" varchar NOT NULL REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "drive_files" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "community_id" varchar NOT NULL REFERENCES "communities"("id") ON DELETE CASCADE,
  "folder_id" varchar REFERENCES "drive_folders"("id") ON DELETE SET NULL,
  "name" text NOT NULL,
  "file_ref" text NOT NULL,
  "mime_type" text,
  "size_bytes" integer,
  "uploaded_by" varchar NOT NULL REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoices" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "community_id" varchar NOT NULL REFERENCES "communities"("id") ON DELETE CASCADE,
  "contractor" text NOT NULL,
  "completion_date" date NOT NULL,
  "service_type" text NOT NULL,
  "cost" double precision NOT NULL,
  "notes" text,
  "pdf_object_key" text,
  "attachment_label" text,
  "attachment_layer_id" varchar REFERENCES "map_layers"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_community_idx" ON "invoices" ("community_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_completion_date_idx" ON "invoices" ("completion_date");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contracts" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "community_id" varchar NOT NULL REFERENCES "communities"("id") ON DELETE CASCADE,
  "contractor_user_id" varchar NOT NULL REFERENCES "users"("id"),
  "contract_type" text NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "services_included" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "pdf_object_key" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contracts_community_idx" ON "contracts" ("community_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contracts_contractor_idx" ON "contracts" ("contractor_user_id");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "push_tickets" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ticket_id" text NOT NULL,
  "token" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_tickets_created_at_idx" ON "push_tickets" ("created_at");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "planner_records" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "property_id" varchar NOT NULL,
  "record_name" text NOT NULL,
  "status" "planner_record_status" DEFAULT 'draft' NOT NULL,
  "internal_notes" text,
  "assumptions_json" jsonb NOT NULL,
  "groups_json" jsonb NOT NULL,
  "total_sqft" double precision DEFAULT 0 NOT NULL,
  "total_estimated_cost" double precision DEFAULT 0 NOT NULL,
  "total_annual_savings" double precision DEFAULT 0 NOT NULL,
  "payback_years" double precision,
  "created_by" varchar REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "planner_records_property_idx" ON "planner_records" ("property_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "planner_records_status_idx" ON "planner_records" ("status");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "xeriscape_packets" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "planner_record_id" varchar NOT NULL REFERENCES "planner_records"("id") ON DELETE CASCADE,
  "packet_title" text NOT NULL,
  "packet_summary_text" text,
  "narrative_intro" text,
  "narrative_recommendation" text,
  "narrative_next_steps" text,
  "packet_status" "xeriscape_packet_status" DEFAULT 'draft' NOT NULL,
  "generated_at" timestamp DEFAULT now() NOT NULL,
  "generated_by" varchar REFERENCES "users"("id"),
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "xeriscape_packets_record_idx" ON "xeriscape_packets" ("planner_record_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "xeriscape_packets_status_idx" ON "xeriscape_packets" ("packet_status");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "water_usage" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "community_id" varchar NOT NULL REFERENCES "communities"("id") ON DELETE CASCADE,
  "month" integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  "year" integer NOT NULL,
  "usage_amount" double precision NOT NULL,
  "unit" text DEFAULT 'gallons' NOT NULL,
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "water_usage_community_month_year_idx" ON "water_usage" ("community_id", "month", "year");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "water_usage_community_idx" ON "water_usage" ("community_id");
