-- Add 'splice' to asset_type enum for wire splice assets imported from irrigation KML
-- Uses ADD VALUE IF NOT EXISTS (Postgres 9.6+) to be idempotent.

ALTER TYPE "public"."asset_type" ADD VALUE IF NOT EXISTS 'splice';
