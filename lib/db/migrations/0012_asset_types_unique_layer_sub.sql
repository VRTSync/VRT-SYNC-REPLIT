-- Migration 0012: unique constraint on asset_types (layer_key, sub_layer_key)
--
-- Prevents two catalogue entries from sharing the same layer/sub-layer pair,
-- which would make resolveAssetType ambiguous.  The existing index
-- "asset_types_layer_sub_idx" is a plain index; this migration replaces it
-- with a unique index.
--
-- Idempotent — safe to re-run.

-- Drop the non-unique index added by migration 0011 (no-op if already dropped).
DROP INDEX IF EXISTS "public"."asset_types_layer_sub_idx";

-- Add the unique index (no-op if it already exists).
CREATE UNIQUE INDEX IF NOT EXISTS "asset_types_layer_sub_unique_idx"
  ON "public"."asset_types" ("layer_key", "sub_layer_key");
