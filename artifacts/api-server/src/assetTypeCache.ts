/**
 * assetTypeCache.ts
 *
 * 60-second in-process cache for the `asset_types` table — the single source of
 * truth for layer/sub-layer → asset type resolution and for required/optional
 * field key look-ups.  Replaces the hardcoded ASSET_TYPE_TEMPLATES and
 * SUB_LAYER_TO_ASSET_TYPE constants that used to live in assetSync.ts.
 *
 * Rollback note: if migration 0011 is reverted, the `asset_types` table will
 * not exist and every DB call here will throw.  In that case revert this module
 * and re-enable the hardcoded constants in assetSync.ts.  The original Postgres
 * enum is preserved by the migration, so reverting the column type is safe.
 */

import { db } from "./db";
import { assetTypes } from "@workspace/db";

export type AssetTypeRow = {
  key: string;
  label: string;
  layerKey: string;
  subLayerKey: string;
  allowedGeometry: string[] | null;
  defaultColor: string | null;
  requiredKeys: string[];
  optionalKeys: string[];
  sortOrder: number;
  isActive: boolean;
  updatedAt: Date;
};

let _cache: { data: AssetTypeRow[]; expiresAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

/** Returns all rows from asset_types, cached for 60 s. */
export async function getAssetTypeCache(): Promise<AssetTypeRow[]> {
  const now = Date.now();
  if (_cache && _cache.expiresAt > now) return _cache.data;
  try {
    const rows = await db.select().from(assetTypes);
    _cache = { data: rows as AssetTypeRow[], expiresAt: now + CACHE_TTL_MS };
    return _cache.data;
  } catch (err) {
    // Return stale data on transient failures so one bad DB round-trip doesn't
    // crater every in-flight request.
    console.error("[assetTypeCache] DB read failed:", err);
    return _cache?.data ?? [];
  }
}

/** Invalidate the cache so the next read fetches fresh data (call after admin mutations). */
export function invalidateAssetTypeCache(): void {
  _cache = null;
}

/**
 * Resolves (layerKey, subLayerKey) to the asset_type key string for that
 * sub-layer.  Returns null for the "outline" layer and for unknown/inactive
 * combinations.
 */
export async function resolveAssetType(layerKey: string, subLayerKey: string): Promise<string | null> {
  if (layerKey === "outline") return null;
  const types = await getAssetTypeCache();
  return (
    types.find(t => t.isActive && t.layerKey === layerKey && t.subLayerKey === subLayerKey)
      ?.key ?? null
  );
}

/**
 * Validates a (layerKey, subLayerKey) pair against the live catalogue.
 * The "outline" / "community_boundary" pair is a special structural layer
 * that is intentionally absent from the asset_types catalogue — it is always
 * allowed here.  Every other combination must exist and be active in the DB.
 */
export async function validateLayerKeysFromCatalogue(
  layerKey: string,
  subLayerKey: string,
): Promise<{ valid: boolean; error?: string }> {
  if (layerKey === "outline") {
    if (subLayerKey === "community_boundary") return { valid: true };
    return {
      valid: false,
      error: `Invalid subLayerKey "${subLayerKey}" for outline layer. Allowed: community_boundary`,
    };
  }
  const types = await getAssetTypeCache();
  const active = types.filter(t => t.isActive);
  const match = active.find(t => t.layerKey === layerKey && t.subLayerKey === subLayerKey);
  if (!match) {
    const layerExists = active.some(t => t.layerKey === layerKey);
    if (!layerExists) {
      const knownLayers = [...new Set(active.map(t => t.layerKey)), "outline"];
      return {
        valid: false,
        error: `Invalid layerKey "${layerKey}". Allowed values: ${knownLayers.join(", ")}`,
      };
    }
    const subs = active.filter(t => t.layerKey === layerKey).map(t => t.subLayerKey);
    return {
      valid: false,
      error: `Invalid subLayerKey "${subLayerKey}" for layerKey "${layerKey}". Allowed values: ${subs.join(", ")}`,
    };
  }
  return { valid: true };
}

/**
 * Returns the required/optional field keys for an asset type, or null when
 * the type is not in the table.
 */
export async function getAssetTypeTemplate(
  key: string,
): Promise<{ requiredKeys: string[]; optionalKeys: string[] } | null> {
  const types = await getAssetTypeCache();
  const match = types.find(t => t.key === key);
  if (!match) return null;
  return {
    requiredKeys: (match.requiredKeys as string[]) ?? [],
    optionalKeys: (match.optionalKeys as string[]) ?? [],
  };
}
