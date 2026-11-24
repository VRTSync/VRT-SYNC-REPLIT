CREATE INDEX IF NOT EXISTS assets_map_layer_idx ON assets (map_layer_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS community_members_user_idx ON community_members (user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS task_links_task_idx ON task_links (task_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS task_links_asset_idx ON task_links (asset_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS task_completions_task_idx ON task_completions (task_id);
--> statement-breakpoint
ALTER TABLE map_layers ADD COLUMN IF NOT EXISTS feature_count integer;
--> statement-breakpoint
DO $$
DECLARE
  layer record;
  geo json;
  backfilled integer := 0;
  left_null integer;
BEGIN
  FOR layer IN SELECT id, geojson_data FROM map_layers WHERE feature_count IS NULL LOOP
    BEGIN
      geo := layer.geojson_data::json;
      IF json_typeof(geo->'features') = 'array' THEN
        UPDATE map_layers SET feature_count = json_array_length(geo->'features') WHERE id = layer.id;
        backfilled := backfilled + 1;
      END IF;
    EXCEPTION WHEN data_exception THEN
      -- A malformed legacy row must not prevent other layers from migrating.
      CONTINUE;
    END;
  END LOOP;
  SELECT count(*) INTO left_null FROM map_layers WHERE feature_count IS NULL;
  RAISE NOTICE 'P2 counts: layers backfilled=%, layers left null=%', backfilled, left_null;
END $$;
