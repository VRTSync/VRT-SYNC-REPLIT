export const SUBLAYER_DEFAULT_COLORS: Record<string, string> = {
  bluegrass_area: '#2E8B57',
  native_area: '#8F9779',
  landscape_bed: '#8B5A2B',
  pet_station: '#1ABC9C',
  backflow: '#00BFFF',
  master_valve: '#1F4E79',
  flow_meter: '#00CED1',
  qc_iso_valve: '#87CEEB',
  plow: '#4A90E2',
  atv: '#6A5ACD',
  hand_shovel: '#E83E8C',
  ice_melt: '#FF8C00',
  slicer: '#D62828',
  storage_area: '#708090',
  tree: '#006400',
};

export const CONTROLLER_PALETTE: string[] = [
  '#25C1AC', '#3498db', '#e74c3c', '#f39c12', '#9b59b6',
  '#1abc9c', '#e67e22', '#2980b9', '#c0392b', '#27ae60',
];

export function getDefaultLayerColor(subLayerKey: string, existingCount: number): string {
  if (subLayerKey in SUBLAYER_DEFAULT_COLORS) {
    return SUBLAYER_DEFAULT_COLORS[subLayerKey];
  }
  return CONTROLLER_PALETTE[existingCount % CONTROLLER_PALETTE.length];
}
