---
name: Asset Types Catalogue
description: How asset types work after the data-driven refactor (task 442). Covers DB table, server cache, mobile context, and MC icon helpers.
---

# Asset Types Catalogue

## The rule
`asset_types` DB table is the single source of truth for every asset type. Adding or changing a type via the Admin UI propagates to KML import, map display, and mobile pin-drop with no code change.

**Why:** Previously, adding one asset type required editing five hardcoded locations in lockstep; misaligning any one caused silent breakage (e.g. snow-layer zero-asset bug).

## DB layout (migrations 0011 + 0012)
- Table `asset_types`: `key` (PK, varchar), `label`, `layer_key`, `sub_layer_key`, `allowed_geometry` (JSON), `default_color`, `required_keys` (JSON), `optional_keys` (JSON), `sort_order`, `is_active`, `updated_at`
- `assets.asset_type` is now `varchar` with FK → `asset_types.key` (was a Postgres enum)
- Old `assetTypeEnum` Postgres type is kept (not dropped) so a column revert is a one-liner
- Unique index `asset_types_layer_sub_unique_idx` on `(layer_key, sub_layer_key)` — duplicate layer/sub-layer combos return 409

**How to apply:** Migrations 0011 and 0012 must both be applied before starting the server. They are idempotent raw SQL (not drizzle-kit managed).

## Server cache (`artifacts/api-server/src/assetTypeCache.ts`)
- `getAssetTypeCache()` — 60-second in-process cache of all asset_types rows
- `resolveAssetType(layerKey, subLayerKey)` — **async**; replaces the old synchronous constant lookup
- `getAssetTypeTemplate(key)` — **async**; replaces old `ASSET_TYPE_TEMPLATES[key]`
- `invalidateAssetTypeCache()` — called after any CRUD on asset_types
- `validateLayerKeysFromCatalogue()` — replaces hardcoded `CANONICAL_LAYER_HIERARCHY`; `outline`/`community_boundary` are always exempt

**Why async matters:** All 46+ call sites in storage.ts that previously read synchronous constants must now await these helpers. A sync call will silently return undefined.

## Mobile (`artifacts/vrtsync-mobile/`)
- `client/contexts/AssetTypeContext.tsx` — React Query fetch of `/api/asset-types`; provides `assetTypes[]`, `getLabel`, `getColor`, `getRequiredKeys`, `getOptionalKeys`, `isLoaded`; `deriveLabel(key)` for unknown-type graceful fallback (snake_case → Title Case)
- `lib/mcAssetTypeCatalog.ts` — now exports **icon helpers only** (`TYPE_ICON_MAP`, `LAYER_ICON_MAP`, `getTypeIcon`, `getLayerIcon`, `IRRIGATION_CONTROLLERS_ZONE_KEYS`). No more `MC_LAYERS`, `MC_LAYER_MAP`, `IRRIGATION_GROUP_CONTROLLERS`, `IRRIGATION_GROUP_VALVES`.
- `McLayerKey` is now `string` (open), not a union of three hardcoded keys.
- `shared/assetFieldTemplates.ts` (mobile duplicate) has been deleted — mobile reads from `AssetTypeContext`.
- `app/_layout.tsx` wraps the tree with `<AssetTypeProvider>`.

## MC pin-drop components
- `MapCreatorChrome.tsx`, `MapCreatorOverlay.tsx`, `AssetPickerSheet.tsx` all derive layer lists and type lists from `useAssetTypes()` — no hardcoded lists.
- Irrigation grouping: `IRRIGATION_CONTROLLERS_ZONE_KEYS = Set(['controller', 'zone'])` splits the picker into two groups.
- Unknown types fall back to `getTypeIcon(key) → 'cube-outline'` and `deriveLabel(key)`.

## Admin UI
- `artifacts/web-portal/public/admin/pages/asset-types.js` — list/filter, create/edit (key immutable after creation), deactivate/reactivate.
- Nav link in `artifacts/web-portal/templates/admin-shell.html` (the one that actually serves `/web/admin`, not the API server copy).
- POST/PATCH bodies are Zod-validated; unique-violation returns 409.

## API routes
- `GET /api/asset-types` — active types; `?all=true` (admin only) returns all rows
- `POST /api/asset-types` — create; key must match `/^[a-z][a-z0-9_]*$/`; Zod-validated
- `PATCH /api/asset-types/:key` — update; key is immutable
- `DELETE /api/asset-types/:key` — deactivate (sets is_active = false, never deletes rows or assets)
- `GET /api/layer-hierarchy` — derived from catalogue, ordered by sort_order
