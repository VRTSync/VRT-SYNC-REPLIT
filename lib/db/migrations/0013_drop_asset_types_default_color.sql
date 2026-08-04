-- Migration 0013: drop default_color from asset_types
--
-- Task #442 added asset_types.default_color as a second color source alongside
-- map_layers.color (the admin Map Layers color picker). Colors must live in
-- exactly one place. The correct resolution order everywhere is:
--   map_layers.color → hardcoded per-sub-layer default → neutral grey.
-- This column is barely wired in and has no active consumers, so it is dropped.
--
-- Idempotent — safe to re-run.

ALTER TABLE "asset_types" DROP COLUMN IF EXISTS "default_color";
