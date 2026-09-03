# PNC bluegrass label audit

Audit captured on 2026-09-03 before the label correction migrations.

## Scope and baseline

- Organization: `PNC Bank`
- Active bluegrass assets: 55
- Locations: 10
- Linked mapped assets: 55 of 55
- Current placeholder labels: 55 of 55 (`Untitled polygon`)
- Current square footage total: 193,748 ft²
- `104th and Chambers`: 7 areas, 15,572 ft²

## Source diagnosis

The audit joined each active `bluegrass_area` asset to its referenced `map_layers` feature using the immutable `featureRef`/`featureId` relationship. Every linked feature had the following raw property keys:

```text
featureId, fill, fill-opacity, icon, icon-offset, icon-offset-units,
name, stroke, stroke-opacity, stroke-width, styleUrl
```

The only candidate label found in the linked features was `name = "Untitled polygon"` for all 55 features. No linked feature exposed a useful alternate `label`, `title`, or `name`. The asset table also contained `label = "Untitled polygon"` for all 55 assets. Therefore, useful names were not discarded under another surviving property; they were never present in the imported source.

The audit also confirmed that the source features retain geometry and stable feature references. The correction must therefore update canonical asset labels only and must not rewrite GeoJSON, geometry, feature references, areas, or planner inputs.

## Naming decision

Because the source contains no usable labels, the positional/descriptive names
introduced by migration `0020_distinguish_pnc_bluegrass_names.sql` are
intentionally superseded by migration
`0021_standardize_pnc_bluegrass_labels.sql`.  The final convention is uniform
across every PNC location:

- `Bluegrass Polygon N`, restarting at `1` for each location;
- descending stored `sqFt`, with immutable `feature_ref` as the deterministic
  tie-breaker.

Descriptive or compass-based names were discarded rather than preserved because
they were not present in the imported source and would be invented labels for
only one location.  A single largest-first convention makes labels consistent
in portfolio, location, and admin planner views while preserving the source
feature identity and area ranking.

The migration is scoped to PNC's organization ID, active `bluegrass_area`
assets with both a map-layer link and feature reference, and is safe to run
more than once.  It fails closed instead of partially labeling an unexpected
scope or an asset with missing, malformed, or ambiguous ranking inputs.
