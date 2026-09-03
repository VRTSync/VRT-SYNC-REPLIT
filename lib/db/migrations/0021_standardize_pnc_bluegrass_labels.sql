-- Standardize PNC bluegrass labels to a uniform, largest-first convention.
-- This is intentionally label-only: geometry, properties, feature references,
-- map-layer links, and archive state are not changed.
--
-- The source audit for this correction is recorded in
-- docs/pnc-bluegrass-label-audit.md.
DO $$
DECLARE
  pnc_org_id CONSTANT varchar := 'b2d0a7c7-8a75-4874-8140-4b6ae289d85f';
  expected_target_count CONSTANT integer := 55;
  target_count integer;
  invalid_area_count integer;
  invalid_feature_ref_count integer;
  duplicate_feature_ref_count integer;
  label_mismatch_count integer;
  duplicate_label_count integer;
BEGIN
  SELECT count(*)
    INTO target_count
  FROM assets a
  JOIN communities c ON c.id = a.community_id
  WHERE c.organization_id = pnc_org_id
    AND a.asset_type = 'bluegrass_area'
    AND a.is_archived = false
    AND a.map_layer_id IS NOT NULL
    AND a.feature_ref IS NOT NULL;

  -- Development databases do not contain the production-only PNC data.
  IF target_count = 0 THEN
    RETURN;
  END IF;

  -- Do not partially relabel an unexpected production shape.
  IF target_count <> expected_target_count THEN
    RAISE EXCEPTION
      'PNC bluegrass label standardization expected % mapped active assets, found %',
      expected_target_count, target_count;
  END IF;

  -- Every target must have exactly one usable stored area.  The regular
  -- expression mirrors the resolver's accepted decimal forms while keeping
  -- the cast below safe from malformed text.
  SELECT count(*)
    INTO invalid_area_count
  FROM (
    SELECT
      a.id,
      count(ap.asset_id) AS area_property_count,
      max(trim(ap.value)) AS area_value
    FROM assets a
    JOIN communities c ON c.id = a.community_id
    LEFT JOIN asset_properties ap
      ON ap.asset_id = a.id
     AND ap.key = 'sqFt'
    WHERE c.organization_id = pnc_org_id
      AND a.asset_type = 'bluegrass_area'
      AND a.is_archived = false
      AND a.map_layer_id IS NOT NULL
      AND a.feature_ref IS NOT NULL
    GROUP BY a.id
  ) source_area
  WHERE area_property_count <> 1
     OR area_value IS NULL
     OR area_value !~ '^[+]?[0-9]+([.][0-9]*)?$|^[+]?[.][0-9]+$'
     OR (
       area_value ~ '^[+]?[0-9]+([.][0-9]*)?$|^[+]?[.][0-9]+$'
       AND area_value::numeric < 0
     );

  IF invalid_area_count > 0 THEN
    RAISE EXCEPTION
      'PNC bluegrass label standardization found % assets with missing or malformed sqFt values',
      invalid_area_count;
  END IF;

  SELECT count(*)
    INTO invalid_feature_ref_count
  FROM assets a
  JOIN communities c ON c.id = a.community_id
  WHERE c.organization_id = pnc_org_id
    AND a.asset_type = 'bluegrass_area'
    AND a.is_archived = false
    AND a.map_layer_id IS NOT NULL
    AND (a.feature_ref IS NULL OR trim(a.feature_ref) = '');

  IF invalid_feature_ref_count > 0 THEN
    RAISE EXCEPTION
      'PNC bluegrass label standardization found % assets with blank feature references',
      invalid_feature_ref_count;
  END IF;

  -- A duplicate feature reference within a location would make the required
  -- feature-reference tie-breaker ambiguous, so fail before updating anything.
  SELECT count(*)
    INTO duplicate_feature_ref_count
  FROM (
    SELECT c.id, a.feature_ref
    FROM assets a
    JOIN communities c ON c.id = a.community_id
    WHERE c.organization_id = pnc_org_id
      AND a.asset_type = 'bluegrass_area'
      AND a.is_archived = false
      AND a.map_layer_id IS NOT NULL
      AND a.feature_ref IS NOT NULL
    GROUP BY c.id, a.feature_ref
    HAVING count(*) > 1
  ) duplicate_refs;

  IF duplicate_feature_ref_count > 0 THEN
    RAISE EXCEPTION
      'PNC bluegrass label standardization found % duplicate feature-reference groups',
      duplicate_feature_ref_count;
  END IF;

  -- Recompute all labels on every execution.  This makes a direct rerun
  -- produce the same values without relying on the previous label text.
  WITH ranked AS (
    SELECT
      a.id,
      format(
        'Bluegrass Polygon %s',
        row_number() OVER (
          PARTITION BY c.id
          ORDER BY trim(ap.value)::numeric DESC,
                   a.feature_ref COLLATE "C",
                   a.id COLLATE "C"
        )
      ) AS generated_label
    FROM assets a
    JOIN communities c ON c.id = a.community_id
    JOIN asset_properties ap
      ON ap.asset_id = a.id
     AND ap.key = 'sqFt'
    WHERE c.organization_id = pnc_org_id
      AND a.asset_type = 'bluegrass_area'
      AND a.is_archived = false
      AND a.map_layer_id IS NOT NULL
      AND a.feature_ref IS NOT NULL
  )
  UPDATE assets a
  SET label = ranked.generated_label
  FROM ranked
  WHERE a.id = ranked.id
    AND a.label IS DISTINCT FROM ranked.generated_label;

  -- Verify that each location has the complete, gap-free sequence generated
  -- from the same ordering used by the update.
  SELECT count(*)
    INTO label_mismatch_count
  FROM (
    SELECT
      a.id,
      a.label,
      format(
        'Bluegrass Polygon %s',
        row_number() OVER (
          PARTITION BY c.id
          ORDER BY trim(ap.value)::numeric DESC,
                   a.feature_ref COLLATE "C",
                   a.id COLLATE "C"
        )
      ) AS expected_label
    FROM assets a
    JOIN communities c ON c.id = a.community_id
    JOIN asset_properties ap
      ON ap.asset_id = a.id
     AND ap.key = 'sqFt'
    WHERE c.organization_id = pnc_org_id
      AND a.asset_type = 'bluegrass_area'
      AND a.is_archived = false
      AND a.map_layer_id IS NOT NULL
      AND a.feature_ref IS NOT NULL
  ) verification
  WHERE label <> expected_label;

  SELECT count(*)
    INTO duplicate_label_count
  FROM (
    SELECT c.id, a.label
    FROM assets a
    JOIN communities c ON c.id = a.community_id
    WHERE c.organization_id = pnc_org_id
      AND a.asset_type = 'bluegrass_area'
      AND a.is_archived = false
      AND a.map_layer_id IS NOT NULL
      AND a.feature_ref IS NOT NULL
    GROUP BY c.id, a.label
    HAVING count(*) > 1
  ) duplicate_labels;

  IF label_mismatch_count > 0 OR duplicate_label_count > 0 THEN
    RAISE EXCEPTION
      'PNC bluegrass label standardization incomplete: mismatches=% duplicate_groups=% target=%',
      label_mismatch_count, duplicate_label_count, target_count;
  END IF;
END $$;