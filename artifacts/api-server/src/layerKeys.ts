export const CANONICAL_LAYER_HIERARCHY: Record<string, string[]> = {
  community: ["bluegrass_area", "native_area", "landscape_bed", "pet_station"],
  irrigation: ["backflow", "controller", "zone", "master_valve", "flow_meter", "qc_iso_valve"],
  snow: ["plow", "atv", "hand_shovel", "ice_melt", "slicer", "storage_area"],
  trees: ["tree"],
  outline: ["community_boundary"],
};

export const VALID_LAYER_KEYS = Object.keys(CANONICAL_LAYER_HIERARCHY);

export function validateLayerKeys(
  layerKey: string,
  subLayerKey: string
): { valid: boolean; error?: string } {
  if (!CANONICAL_LAYER_HIERARCHY[layerKey]) {
    return {
      valid: false,
      error: `Invalid layerKey "${layerKey}". Allowed values: ${VALID_LAYER_KEYS.join(", ")}`,
    };
  }

  const allowedSubs = CANONICAL_LAYER_HIERARCHY[layerKey];
  if (!allowedSubs.includes(subLayerKey)) {
    return {
      valid: false,
      error: `Invalid subLayerKey "${subLayerKey}" for layerKey "${layerKey}". Allowed values: ${allowedSubs.join(", ")}`,
    };
  }

  return { valid: true };
}
