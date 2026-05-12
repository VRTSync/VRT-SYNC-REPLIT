/**
 * Map Creator asset type catalog.
 * Defines the three layer pills and the tile grid entries for each.
 *
 * Icon names are from @expo/vector-icons Ionicons:
 *   tree            → leaf-outline         (foliage)
 *   pet_station     → business-outline     (community amenity)
 *   controller      → flash-outline        (electrical/control)
 *   backflow        → link-outline         (pipe connection)
 *   pump            → git-pull-request-outline (flow circuit)
 *   master_valve    → lock-closed-outline  (master shutoff)
 *   flow_meter      → analytics-outline    (measurement)
 *   quick_connect   → water-outline        (quick water access)
 *   isolation_valve → lock-closed-outline  (isolation shutoff — reuses valve icon)
 *   zone            → water-outline        (irrigation zone — reuses water icon)
 */

import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';

export type IoniconName = ComponentProps<typeof Ionicons>['name'];

export type McLayerKey = 'trees' | 'community' | 'irrigation';

export type McAssetType = {
  key: string;
  label: string;
  icon: IoniconName;
};

export type McLayerDef = {
  key: McLayerKey;
  label: string;
  icon: IoniconName;
  types: McAssetType[];
};

export const MC_LAYERS: McLayerDef[] = [
  {
    key: 'trees',
    label: 'Trees',
    icon: 'leaf-outline',
    types: [
      { key: 'tree', label: 'Tree', icon: 'leaf-outline' },
    ],
  },
  {
    key: 'community',
    label: 'Community',
    icon: 'business-outline',
    types: [
      { key: 'pet_station', label: 'Pet Station', icon: 'business-outline' },
    ],
  },
  {
    key: 'irrigation',
    label: 'Irrigation',
    icon: 'water-outline',
    types: [
      { key: 'controller',      label: 'Controller',       icon: 'flash-outline' },
      { key: 'backflow',        label: 'Backflow',          icon: 'link-outline' },
      { key: 'pump',            label: 'Pump',              icon: 'git-pull-request-outline' },
      { key: 'master_valve',    label: 'Master Valve',      icon: 'lock-closed-outline' },
      { key: 'flow_meter',      label: 'Flow Meter',        icon: 'analytics-outline' },
      { key: 'quick_connect',   label: 'Quick Connect',     icon: 'water-outline' },
      { key: 'isolation_valve', label: 'Isolation Valve',   icon: 'lock-closed-outline' },
      { key: 'zone',            label: 'Zone',              icon: 'water-outline' },
    ],
  },
];

export const MC_LAYER_MAP: Record<McLayerKey, McLayerDef> = {
  trees: MC_LAYERS[0],
  community: MC_LAYERS[1],
  irrigation: MC_LAYERS[2],
};
