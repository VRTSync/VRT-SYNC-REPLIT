CREATE TYPE "public"."asset_type" AS ENUM('controller', 'backflow', 'zone', 'tree', 'pet_station', 'landscape_bed', 'bluegrass_area', 'native_area', 'snow_area');--> statement-breakpoint
CREATE TYPE "public"."export_status" AS ENUM('queued', 'running', 'complete', 'failed');--> statement-breakpoint
CREATE TYPE "public"."geometry_type" AS ENUM('point', 'polygon', 'line');--> statement-breakpoint
CREATE TYPE "public"."link_type" AS ENUM('asset', 'pin');--> statement-breakpoint
CREATE TYPE "public"."schedule_frequency" AS ENUM('weekly', 'monthly', 'once');--> statement-breakpoint
CREATE TYPE "public"."schedule_run_status" AS ENUM('success', 'failure');--> statement-breakpoint
CREATE TYPE "public"."service_type" AS ENUM('mowing_visit');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('low', 'medium', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('pending', 'in_progress', 'completed', 'submitted', 'acknowledged');--> statement-breakpoint
CREATE TYPE "public"."template_target_type" AS ENUM('none', 'asset_type', 'map_layer', 'specific_asset');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('contractor', 'admin', 'hoa_admin', 'hoa_member', 'property_manager');--> statement-breakpoint
CREATE TABLE "asset_notes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" varchar NOT NULL,
	"community_id" varchar NOT NULL,
	"created_by" varchar NOT NULL,
	"note_text" text NOT NULL,
	"idempotency_key" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "asset_notes_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "asset_properties" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" varchar NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" varchar NOT NULL,
	"asset_type" "asset_type" NOT NULL,
	"label" text NOT NULL,
	"feature_ref" text,
	"map_layer_id" varchar,
	"geometry_type" geometry_type,
	"latitude" double precision,
	"longitude" double precision,
	"is_archived" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp,
	"source_updated_at" timestamp,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_by" varchar,
	"updated_by" varchar,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_completion_id" varchar,
	"task_id" varchar,
	"file_ref" text NOT NULL,
	"url" text NOT NULL,
	"uploaded_by" varchar NOT NULL,
	"idempotency_key" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "communities" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_members" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" varchar NOT NULL,
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
CREATE TABLE "contracts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" varchar NOT NULL,
	"contractor_user_id" varchar NOT NULL,
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
CREATE TABLE "drive_files" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" varchar NOT NULL,
	"folder_id" varchar,
	"name" text NOT NULL,
	"file_ref" text NOT NULL,
	"mime_type" text,
	"size_bytes" integer,
	"uploaded_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drive_folders" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" varchar NOT NULL,
	"parent_id" varchar,
	"name" text NOT NULL,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exports" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" varchar NOT NULL,
	"created_by" varchar NOT NULL,
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
CREATE TABLE "invoices" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" varchar NOT NULL,
	"contractor" text NOT NULL,
	"completion_date" date NOT NULL,
	"service_type" text NOT NULL,
	"cost" double precision NOT NULL,
	"notes" text,
	"pdf_object_key" text,
	"attachment_label" text,
	"attachment_layer_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "map_layers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" varchar NOT NULL,
	"layer_key" text NOT NULL,
	"sub_layer_key" text NOT NULL,
	"display_name" text NOT NULL,
	"source_format" text DEFAULT 'geojson' NOT NULL,
	"geojson_data" text,
	"color" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" varchar NOT NULL,
	"recipient_user_id" varchar NOT NULL,
	"type" varchar NOT NULL,
	"title" varchar NOT NULL,
	"body" text NOT NULL,
	"related_task_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"read_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "offline_packs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" varchar NOT NULL,
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
CREATE TABLE "push_tokens" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"token" text NOT NULL,
	"platform" text NOT NULL,
	"device_id" text DEFAULT 'unknown' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_run_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" varchar NOT NULL,
	"task_id" varchar NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_runs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" varchar NOT NULL,
	"run_at" timestamp DEFAULT now() NOT NULL,
	"window_start" timestamp NOT NULL,
	"window_end" timestamp NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"status" "schedule_run_status" DEFAULT 'success' NOT NULL,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "service_schedules" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" varchar NOT NULL,
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
CREATE TABLE "service_visits" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" varchar NOT NULL,
	"community_id" varchar NOT NULL,
	"service_date" date NOT NULL,
	"completed_at" timestamp,
	"completed_by" varchar,
	"employee_sign_off_name" text DEFAULT '' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_completions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" varchar NOT NULL,
	"completed_by" varchar NOT NULL,
	"notes" text,
	"employee_sign_off_name" text DEFAULT '' NOT NULL,
	"time_spent_minutes" integer,
	"materials_used" text,
	"follow_up_needed" text,
	"completed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_links" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" varchar NOT NULL,
	"link_type" "link_type" NOT NULL,
	"asset_id" varchar,
	"latitude" double precision,
	"longitude" double precision,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_schedules" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" varchar NOT NULL,
	"template_id" varchar NOT NULL,
	"frequency" "schedule_frequency" DEFAULT 'weekly' NOT NULL,
	"days_of_week" text,
	"day_of_month" integer,
	"timezone" text DEFAULT 'America/Denver' NOT NULL,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp,
	"next_run_at" timestamp,
	"assign_to_user_id" varchar,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_templates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"priority" "task_priority" DEFAULT 'medium' NOT NULL,
	"default_status" "task_status" DEFAULT 'pending' NOT NULL,
	"due_days_offset" integer,
	"target_type" "template_target_type" DEFAULT 'none' NOT NULL,
	"target_asset_type" text,
	"target_map_layer_id" varchar,
	"target_asset_id" varchar,
	"require_sign_off_name" boolean DEFAULT true NOT NULL,
	"allow_photos" boolean DEFAULT true NOT NULL,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" varchar NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"priority" "task_priority" DEFAULT 'medium' NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"address" text,
	"assigned_to" varchar,
	"created_by" varchar NOT NULL,
	"start_date" timestamp,
	"due_date" timestamp,
	"ticket_type" text,
	"window_start" date,
	"window_end" date,
	"version" integer DEFAULT 1 NOT NULL,
	"schedule_instance_key" varchar,
	"import_fingerprint" varchar,
	"origin" varchar,
	"asset_id" varchar,
	"category" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_runs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" varchar NOT NULL,
	"community_id" varchar NOT NULL,
	"created_by" varchar NOT NULL,
	"run_at" timestamp DEFAULT now() NOT NULL,
	"task_count_created" integer DEFAULT 0 NOT NULL,
	"assignment_user_id" varchar
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"display_name" text NOT NULL,
	"role" "user_role" DEFAULT 'contractor' NOT NULL,
	"hoa_community_id" varchar,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "water_usage" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" varchar NOT NULL,
	"month" integer NOT NULL,
	"year" integer NOT NULL,
	"usage_amount" double precision NOT NULL,
	"unit" text DEFAULT 'gallons' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_notes" ADD CONSTRAINT "asset_notes_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_notes" ADD CONSTRAINT "asset_notes_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_notes" ADD CONSTRAINT "asset_notes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_properties" ADD CONSTRAINT "asset_properties_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_map_layer_id_map_layers_id_fk" FOREIGN KEY ("map_layer_id") REFERENCES "public"."map_layers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_task_completion_id_task_completions_id_fk" FOREIGN KEY ("task_completion_id") REFERENCES "public"."task_completions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_members" ADD CONSTRAINT "community_members_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_members" ADD CONSTRAINT "community_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_contractor_user_id_users_id_fk" FOREIGN KEY ("contractor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_files" ADD CONSTRAINT "drive_files_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_files" ADD CONSTRAINT "drive_files_folder_id_drive_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."drive_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_files" ADD CONSTRAINT "drive_files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_folders" ADD CONSTRAINT "drive_folders_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_folders" ADD CONSTRAINT "drive_folders_parent_id_drive_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."drive_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_folders" ADD CONSTRAINT "drive_folders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_attachment_layer_id_map_layers_id_fk" FOREIGN KEY ("attachment_layer_id") REFERENCES "public"."map_layers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_layers" ADD CONSTRAINT "map_layers_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_related_task_id_tasks_id_fk" FOREIGN KEY ("related_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_packs" ADD CONSTRAINT "offline_packs_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_run_items" ADD CONSTRAINT "schedule_run_items_run_id_schedule_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."schedule_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_run_items" ADD CONSTRAINT "schedule_run_items_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_runs" ADD CONSTRAINT "schedule_runs_schedule_id_task_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."task_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_schedules" ADD CONSTRAINT "service_schedules_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_visits" ADD CONSTRAINT "service_visits_schedule_id_service_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."service_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_visits" ADD CONSTRAINT "service_visits_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_visits" ADD CONSTRAINT "service_visits_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_completions" ADD CONSTRAINT "task_completions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_completions" ADD CONSTRAINT "task_completions_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_links" ADD CONSTRAINT "task_links_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_links" ADD CONSTRAINT "task_links_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_schedules" ADD CONSTRAINT "task_schedules_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_schedules" ADD CONSTRAINT "task_schedules_template_id_task_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."task_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_schedules" ADD CONSTRAINT "task_schedules_assign_to_user_id_users_id_fk" FOREIGN KEY ("assign_to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_schedules" ADD CONSTRAINT "task_schedules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_target_map_layer_id_map_layers_id_fk" FOREIGN KEY ("target_map_layer_id") REFERENCES "public"."map_layers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_target_asset_id_assets_id_fk" FOREIGN KEY ("target_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_runs" ADD CONSTRAINT "template_runs_template_id_task_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."task_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_runs" ADD CONSTRAINT "template_runs_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_runs" ADD CONSTRAINT "template_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_runs" ADD CONSTRAINT "template_runs_assignment_user_id_users_id_fk" FOREIGN KEY ("assignment_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_hoa_community_id_communities_id_fk" FOREIGN KEY ("hoa_community_id") REFERENCES "public"."communities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_usage" ADD CONSTRAINT "water_usage_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_notes_asset_idx" ON "asset_notes" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "asset_notes_community_idx" ON "asset_notes" USING btree ("community_id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_properties_asset_key_idx" ON "asset_properties" USING btree ("asset_id","key");--> statement-breakpoint
CREATE INDEX "assets_community_type_idx" ON "assets" USING btree ("community_id","asset_type");--> statement-breakpoint
CREATE INDEX "assets_community_feature_idx" ON "assets" USING btree ("community_id","feature_ref");--> statement-breakpoint
CREATE INDEX "assets_community_type_archived_idx" ON "assets" USING btree ("community_id","asset_type","is_archived");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_community_layer_feature_idx" ON "assets" USING btree ("community_id","map_layer_id","feature_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_completion_idempotency_idx" ON "attachments" USING btree ("task_completion_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "community_members_community_user_idx" ON "community_members" USING btree ("community_id","user_id");--> statement-breakpoint
CREATE INDEX "contacts_community_idx" ON "contacts" USING btree ("community_id");--> statement-breakpoint
CREATE INDEX "contacts_type_idx" ON "contacts" USING btree ("contact_type");--> statement-breakpoint
CREATE INDEX "contracts_community_idx" ON "contracts" USING btree ("community_id");--> statement-breakpoint
CREATE INDEX "contracts_contractor_idx" ON "contracts" USING btree ("contractor_user_id");--> statement-breakpoint
CREATE INDEX "exports_community_created_idx" ON "exports" USING btree ("community_id","created_at");--> statement-breakpoint
CREATE INDEX "invoices_community_idx" ON "invoices" USING btree ("community_id");--> statement-breakpoint
CREATE INDEX "invoices_completion_date_idx" ON "invoices" USING btree ("completion_date");--> statement-breakpoint
CREATE INDEX "map_layers_community_layer_idx" ON "map_layers" USING btree ("community_id","layer_key");--> statement-breakpoint
CREATE UNIQUE INDEX "map_layers_community_layer_sub_idx" ON "map_layers" USING btree ("community_id","layer_key","sub_layer_key");--> statement-breakpoint
CREATE INDEX "notifications_recipient_idx" ON "notifications" USING btree ("recipient_user_id");--> statement-breakpoint
CREATE INDEX "notifications_created_at_idx" ON "notifications" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "offline_packs_community_version_idx" ON "offline_packs" USING btree ("community_id","pack_version");--> statement-breakpoint
CREATE UNIQUE INDEX "push_tokens_user_device_idx" ON "push_tokens" USING btree ("user_id","device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_visits_schedule_date_idx" ON "service_visits" USING btree ("schedule_id","service_date");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_schedule_instance_key_idx" ON "tasks" USING btree ("schedule_instance_key");--> statement-breakpoint
CREATE INDEX "tasks_import_fingerprint_idx" ON "tasks" USING btree ("import_fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "water_usage_community_month_year_idx" ON "water_usage" USING btree ("community_id","month","year");--> statement-breakpoint
CREATE INDEX "water_usage_community_idx" ON "water_usage" USING btree ("community_id");