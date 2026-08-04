/**
 * Map Creator asset type icon helpers.
 *
 * All layer/type lists now come from AssetTypeContext (API-backed), so adding
 * a new type in the Admin Hub immediately makes it available in the MC pin-drop
 * flow with no code change.  This file is kept for static icon mappings only.
 *
 * Icon names are from @expo/vector-icons Ionicons:
 *   tree            → leaf-outline
 *   pet_station     → business-outline
 *   controller      → hardware-chip-outline
 *   backflow        → link-outline
 *   pump            → git-pull-request-outline
 *   master_valve    → lock-closed-outline
 *   flow_meter      → analytics-outline
 *   quick_connect   → flash-outline
 *   isolation_valve → git-branch-outline
 *   zone            → grid-outline
 */

import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';

export type IoniconName = ComponentProps<typeof Ionicons>['name'];

/** Open string — any catalogue layer key is valid. */
export type McLayerKey = string;

export type McAssetType = {
  key: string;
  label: string;
  icon: IoniconName;
};

export type McLayerDef = {
  key: string;
  label: string;
  icon: IoniconName;
  types: McAssetType[];
};

/** Icon per asset-type key — falls back to 'cube-outline' for unknown types. */
export const TYPE_ICON_MAP: Record<string, IoniconName> = {
  tree:            'leaf-outline',
  pet_station:     'business-outline',
  controller:      'hardware-chip-outline',
  backflow:        'link-outline',
  pump:            'git-pull-request-outline',
  master_valve:    'lock-closed-outline',
  flow_meter:      'analytics-outline',
  quick_connect:   'flash-outline',
  isolation_valve: 'git-branch-outline',
  zone:            'grid-outline',
  wire_splice:     'git-merge-outline',
  landscape_bed:   'map-outline',
  bluegrass_area:  'color-fill-outline',
  native_area:     'flower-outline',
  plow:            'snow-outline',
  atv:             'bicycle-outline',
  hand_shovel:     'hammer-outline',
  ice_melt:        'thermometer-outline',
  slicer:          'cut-outline',
  storage_area:    'cube-outline',
  snow_area:       'cloud-outline',
};

/** Icon per layer key — falls back to 'layers-outline'. */
export const LAYER_ICON_MAP: Record<string, IoniconName> = {
  trees:      'leaf-outline',
  community:  'business-outline',
  irrigation: 'water-outline',
  snow:       'snow-outline',
};

/** Returns the Ionicon name for an asset-type key, falling back to 'cube-outline'. */
export function getTypeIcon(key: string): IoniconName {
  return TYPE_ICON_MAP[key] ?? 'cube-outline';
}

/** Returns the Ionicon name for a layer key, falling back to 'layers-outline'. */
export function getLayerIcon(key: string): IoniconName {
  return LAYER_ICON_MAP[key] ?? 'layers-outline';
}

/**
 * In the irrigation AssetPickerSheet, these type keys get their own
 * "Controllers & Zones" group header.  All other irrigation types fall under
 * "Valves, Meters & Fittings".
 */
export const IRRIGATION_CONTROLLERS_ZONE_KEYS = new Set(['controller', 'zone']);
