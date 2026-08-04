-- Migration 0011: asset_types catalogue table
--
-- 1. Creates asset_types — the single source of truth for layer/sub-layer →
--    asset type resolution, field templates, colors, and sort order.
-- 2. Seeds one row per existing enum value (all 21 types, including the six
--    snow types added by migration 0010).
-- 3. Converts assets.asset_type from the Postgres enum to varchar and adds an
--    FK to asset_types.key.
--
-- The original `asset_type` enum is intentionally NOT dropped — keeping it
-- makes the column revert a single one-liner (see rollback note below).
--
-- Rollback procedure:
--   1. ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_asset_type_fkey;
--   2. ALTER TABLE assets ALTER COLUMN asset_type TYPE asset_type
--         USING asset_type::asset_type;
--   3. DROP TABLE IF EXISTS asset_types;
--   The enum still exists, so step 2 is safe as long as every row value is in
--   the enum.
--
-- This migration is fully idempotent — safe to re-run.

-- ── 1. Create catalogue table ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "public"."asset_types" (
  "key"              varchar   PRIMARY KEY,
  "label"            text      NOT NULL,
  "layer_key"        text      NOT NULL,
  "sub_layer_key"    text      NOT NULL,
  "allowed_geometry" jsonb,
  "default_color"    text,
  "required_keys"    jsonb     NOT NULL DEFAULT '[]'::jsonb,
  "optional_keys"    jsonb     NOT NULL DEFAULT '[]'::jsonb,
  "sort_order"       integer   NOT NULL DEFAULT 0,
  "is_active"        boolean   NOT NULL DEFAULT true,
  "updated_at"       timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_types_layer_sub_idx"
  ON "public"."asset_types" ("layer_key", "sub_layer_key");
--> statement-breakpoint

-- ── 2. Seed all current asset types (idempotent via ON CONFLICT DO NOTHING) ───
INSERT INTO "public"."asset_types"
  ("key","label","layer_key","sub_layer_key","allowed_geometry","default_color","required_keys","optional_keys","sort_order","is_active")
VALUES
  ('bluegrass_area','Bluegrass Area','community','bluegrass_area','["polygon","point"]','#2E8B57','[]','["name","sqFt"]',0,true),
  ('native_area','Native Grass','community','native_area','["polygon","point"]','#8F9779','[]','["name","sqFt"]',1,true),
  ('landscape_bed','Landscape Bed','community','landscape_bed','["polygon","point"]','#8B5A2B','[]','["name","sqFt"]',2,true),
  ('pet_station','Pet Station','community','pet_station','["point"]','#1ABC9C','[]','["serviceFrequency"]',3,true),
  ('backflow','Backflow','irrigation','backflow','["point"]','#00BFFF','["brand","serialNumber","size"]','[]',0,true),
  ('controller','Controller','irrigation','controller','["point"]','#25C1AC','["brand"]','["installDate","seasonalAdjustment","controllerKey","controllerColor"]',1,true),
  ('zone','Zone','irrigation','zone','["polygon","point"]','#3498db','["zoneNumber","runTime"]','["controllerFeatureRef","controllerLabel","zoneType","zoneLabelShort","valveBoxRef","valveBoxLabel"]',2,true),
  ('master_valve','Master Valve','irrigation','master_valve','["point"]','#1F4E79','[]','["brand","size"]',3,true),
  ('flow_meter','Flow Meter','irrigation','flow_meter','["point"]','#00CED1','[]','["brand","size"]',4,true),
  ('pump','Pump','irrigation','pump','["point"]','#5B9BD5','[]','["brand","model"]',5,true),
  ('quick_connect','Quick Connect','irrigation','quick_connect','["point"]','#E67E22','[]','["size"]',6,true),
  ('isolation_valve','Isolation Valve','irrigation','isolation_valve','["point"]','#F39C12','[]','["size"]',7,true),
  ('splice','Wire Splice','irrigation','wire_splice','["point"]','#9B59B6','[]','["notes"]',8,true),
  ('tree','Tree','trees','tree','["point"]','#006400','["species"]','["plantedDate"]',0,true),
  ('plow','Truck Plow','snow','plow','["polygon","line","point"]','#4A90E2','[]','["surface","priority","equipment","notes"]',0,true),
  ('atv','ATV','snow','atv','["polygon","line","point"]','#6A5ACD','[]','["surface","priority","equipment","notes"]',1,true),
  ('hand_shovel','Hand Shovel','snow','hand_shovel','["polygon","line","point"]','#E83E8C','[]','["surface","priority","equipment","notes"]',2,true),
  ('ice_melt','Ice Melt','snow','ice_melt','["polygon","line","point"]','#FF8C00','[]','["surface","priority","equipment","notes"]',3,true),
  ('slicer','Slicer','snow','slicer','["polygon","line","point"]','#D62828','[]','["surface","priority","equipment","notes"]',4,true),
  ('storage_area','Storage Area','snow','storage_area','["polygon","point"]','#708090','[]','["surface","priority","equipment","notes"]',5,true),
  ('snow_area','Snow Area','snow','snow_area','["polygon","point"]','#B0C4DE','[]','["name","sqFt"]',6,true)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint

-- ── 3. Convert assets.asset_type from enum → varchar (idempotent) ─────────────
DO $$ BEGIN
  IF (
    SELECT udt_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'assets'
      AND column_name  = 'asset_type'
  ) = 'asset_type' THEN
    ALTER TABLE "public"."assets"
      ALTER COLUMN "asset_type" TYPE varchar USING "asset_type"::text;
  END IF;
END $$;
--> statement-breakpoint

-- ── 4. Add FK from assets.asset_type → asset_types.key (idempotent) ──────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'assets_asset_type_fkey'
      AND table_name      = 'assets'
      AND table_schema    = 'public'
  ) THEN
    ALTER TABLE "public"."assets"
      ADD CONSTRAINT "assets_asset_type_fkey"
        FOREIGN KEY ("asset_type")
        REFERENCES "public"."asset_types"("key")
        ON UPDATE CASCADE;
  END IF;
END $$;
