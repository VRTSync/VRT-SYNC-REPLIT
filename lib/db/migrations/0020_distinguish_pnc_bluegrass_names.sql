-- PNC's imported bluegrass GeoJSON has only the placeholder name
-- "Untitled polygon".  Update canonical asset labels without touching
-- geometry, map-layer links, feature references, properties, or archive state.
--
-- The source audit for this correction is recorded in
-- docs/pnc-bluegrass-label-audit.md.
DO $$
DECLARE
  pnc_org_id CONSTANT varchar := 'b2d0a7c7-8a75-4874-8140-4b6ae289d85f';
  target_count integer;
  invalid_count integer;
  duplicate_count integer;
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

  -- These seven names are based on the verified relative positions of the
  -- referenced polygons in the 104th and Chambers map layer.
  UPDATE assets a
  SET label = named.label
  FROM communities c
  JOIN (
    VALUES
      ('00A1E203C53E09C5CDD0', 'South Turf'),
      ('0213B4E3933E09C67F40', 'Northwest Turf'),
      ('02F9D9C9FB3E141F6277', 'East Turf'),
      ('06E07771D63E09C65426', 'West Turf'),
      ('09E3E9F03F3E09C586C8', 'Center Pocket'),
      ('0A6452F13A3E141FE36F', 'North Turf'),
      ('0B1BF2B4E13E09C6238C', 'Center Spine')
  ) AS named(feature_ref, label) ON true
  WHERE c.organization_id = pnc_org_id
    AND c.name = '104th and Chambers'
    AND a.community_id = c.id
    AND a.asset_type = 'bluegrass_area'
    AND a.is_archived = false
    AND a.map_layer_id IS NOT NULL
    AND a.feature_ref = named.feature_ref
    AND lower(trim(a.label)) = 'untitled polygon';

  -- All other locations receive a stable per-location fallback.  The
  -- feature reference is the source identity and does not change on reruns.
  WITH numbered AS (
    SELECT
      a.id,
      format(
        'Area %s',
        row_number() OVER (PARTITION BY c.id ORDER BY a.feature_ref, a.id)
      ) AS generated_label
    FROM assets a
    JOIN communities c ON c.id = a.community_id
    WHERE c.organization_id = pnc_org_id
      AND a.asset_type = 'bluegrass_area'
      AND a.is_archived = false
      AND a.map_layer_id IS NOT NULL
      AND a.feature_ref IS NOT NULL
      AND lower(trim(a.label)) = 'untitled polygon'
  )
  UPDATE assets a
  SET label = numbered.generated_label
  FROM numbered
  WHERE a.id = numbered.id;

  -- Fail closed if the production shape differs from the audited scope.
  -- This prevents a partial correction from leaving ambiguous labels.
  SELECT count(*)
    INTO invalid_count
  FROM assets a
  JOIN communities c ON c.id = a.community_id
  WHERE c.organization_id = pnc_org_id
    AND a.asset_type = 'bluegrass_area'
    AND a.is_archived = false
    AND a.map_layer_id IS NOT NULL
    AND a.feature_ref IS NOT NULL
    AND (a.label IS NULL OR trim(a.label) = '' OR lower(trim(a.label)) = 'untitled polygon');

  SELECT count(*)
    INTO duplicate_count
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
  ) duplicates;

  IF invalid_count > 0 OR duplicate_count > 0 THEN
    RAISE EXCEPTION
      'PNC bluegrass label correction incomplete: invalid=% duplicate_groups=% target=%',
      invalid_count, duplicate_count, target_count;
  END IF;
END $$;