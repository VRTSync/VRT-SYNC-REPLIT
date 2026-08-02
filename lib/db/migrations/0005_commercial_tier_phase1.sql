-- Commercial Tier Phase 1: organizations, branch fields, groups, work-order fields
-- Enum value must be added outside a transaction block
ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'client_admin';--> statement-breakpoint

-- organizations table
CREATE TABLE IF NOT EXISTS "organizations" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "kind" varchar NOT NULL DEFAULT 'commercial',
  "contact_name" text,
  "contact_email" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

-- additive columns on communities
ALTER TABLE "communities" ADD COLUMN IF NOT EXISTS "organization_id" varchar REFERENCES "organizations"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN IF NOT EXISTS "code" varchar;--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN IF NOT EXISTS "address" text;--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN IF NOT EXISTS "city" text;--> statement-breakpoint

-- index on communities.organization_id
CREATE INDEX IF NOT EXISTS "communities_organization_id_idx" ON "communities" ("organization_id");--> statement-breakpoint

-- partial unique index: duplicate code forbidden within the same org, but NULL codes are ignored
CREATE UNIQUE INDEX IF NOT EXISTS "communities_org_code_unique" ON "communities" ("organization_id", "code") WHERE organization_id IS NOT NULL AND code IS NOT NULL;--> statement-breakpoint

-- branch_groups table
CREATE TABLE IF NOT EXISTS "branch_groups" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "color" varchar,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

-- branch_group_members table
CREATE TABLE IF NOT EXISTS "branch_group_members" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "group_id" varchar NOT NULL REFERENCES "branch_groups"("id") ON DELETE CASCADE,
  "community_id" varchar NOT NULL REFERENCES "communities"("id") ON DELETE CASCADE
);--> statement-breakpoint

-- unique index on branch_group_members
CREATE UNIQUE INDEX IF NOT EXISTS "branch_group_members_group_community_idx" ON "branch_group_members" ("group_id", "community_id");--> statement-breakpoint

-- additive column on users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "organization_id" varchar REFERENCES "organizations"("id") ON DELETE SET NULL;--> statement-breakpoint

-- work-order approval fields on tasks
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "estimate_cents" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "approved_at" timestamp;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "approved_by" varchar REFERENCES "users"("id") ON DELETE SET NULL;
