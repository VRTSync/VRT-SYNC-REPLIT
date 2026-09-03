# PNC bluegrass label audit

Audit captured on 2026-09-03 before the label correction migration.

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

## Correction decision

Because the source contains no usable labels, migration `0020_distinguish_pnc_bluegrass_names.sql` assigns:

- verified positional names to the seven 104th-and-Chambers feature references;
- deterministic `Area N` names, ordered by immutable `feature_ref` within each location, everywhere else.

The migration is scoped to PNC's organization ID, active bluegrass assets with both a map-layer link and feature reference, and is safe to run more than once.