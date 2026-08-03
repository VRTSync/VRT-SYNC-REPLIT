-- Extend service_type enum with new visit categories (Phase 2b)
-- Uses ADD VALUE IF NOT EXISTS (Postgres 9.6+) to be idempotent.

ALTER TYPE "public"."service_type" ADD VALUE IF NOT EXISTS 'snow_clearing';--> statement-breakpoint
ALTER TYPE "public"."service_type" ADD VALUE IF NOT EXISTS 'irrigation_service';--> statement-breakpoint
ALTER TYPE "public"."service_type" ADD VALUE IF NOT EXISTS 'tree_care';--> statement-breakpoint
ALTER TYPE "public"."service_type" ADD VALUE IF NOT EXISTS 'landscape_service';--> statement-breakpoint
ALTER TYPE "public"."service_type" ADD VALUE IF NOT EXISTS 'general_service';
