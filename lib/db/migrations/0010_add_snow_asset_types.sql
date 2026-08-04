-- Add six snow asset type values to asset_type enum.
-- Uses ADD VALUE IF NOT EXISTS (Postgres 9.6+) to be idempotent.

ALTER TYPE "public"."asset_type" ADD VALUE IF NOT EXISTS 'plow';
--> statement-breakpoint
ALTER TYPE "public"."asset_type" ADD VALUE IF NOT EXISTS 'atv';
--> statement-breakpoint
ALTER TYPE "public"."asset_type" ADD VALUE IF NOT EXISTS 'hand_shovel';
--> statement-breakpoint
ALTER TYPE "public"."asset_type" ADD VALUE IF NOT EXISTS 'ice_melt';
--> statement-breakpoint
ALTER TYPE "public"."asset_type" ADD VALUE IF NOT EXISTS 'slicer';
--> statement-breakpoint
ALTER TYPE "public"."asset_type" ADD VALUE IF NOT EXISTS 'storage_area';
