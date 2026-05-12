import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MC_LAYERS, type McLayerKey, type McAssetType } from '@/lib/mcAssetTypeCatalog';

type Props = {
  activeLayer: McLayerKey;
  onLayerChange: (layer: McLayerKey) => void;
  armedType: string | null;
  onArmType: (typeKey: string | null) => void;
  typeCounts: Record<string, number>;
  /** GPS lock state; available for MC5 to colour the armed tile or the hint card */
  lockState: 'red' | 'yellow' | 'green';
};

export default function MapCreatorOverlay({
  activeLayer,
  onLayerChange,
  armedType,
  onArmType,
  typeCounts,
  lockState: _lockState,
}: Props) {
  const activeDef = MC_LAYERS.find((l) => l.key === activeLayer);
  const types: McAssetType[] = activeDef?.types ?? [];

  return (
    <View style={styles.container} pointerEvents="box-none">
      <View style={styles.pillsRow}>
        {MC_LAYERS.map((layer) => {
          const isActive = layer.key === activeLayer;
          return (
            <TouchableOpacity
              key={layer.key}
              style={[styles.layerPill, isActive && styles.layerPillActive]}
              onPress={() => onLayerChange(layer.key)}
              activeOpacity={0.75}
            >
              <Ionicons
                name={layer.icon}
                size={14}
                color={isActive ? '#fff' : '#0C1D31'}
              />
              <Text style={[styles.layerPillText, isActive && styles.layerPillTextActive]}>
                {layer.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.tileGrid}>
        {types.map((type) => {
          const count = typeCounts[type.key] ?? 0;
          const isArmed = armedType === type.key;
          return (
            <TouchableOpacity
              key={type.key}
              style={[styles.tile, isArmed && styles.tileArmed]}
              onPress={() => onArmType(isArmed ? null : type.key)}
              activeOpacity={0.75}
            >
              <View style={styles.tileIconWrap}>
                <Ionicons
                  name={type.icon}
                  size={20}
                  color={isArmed ? '#25C1AC' : '#4b5563'}
                />
                {count > 0 && (
                  <View style={styles.countBadge}>
                    <Text style={styles.countBadgeText}>
                      {count > 99 ? '99+' : count}
                    </Text>
                  </View>
                )}
              </View>
              <Text style={[styles.tileLabel, isArmed && styles.tileLabelArmed]} numberOfLines={2}>
                {type.label}
              </Text>
              {isArmed && (
                <TouchableOpacity
                  style={styles.cancelPill}
                  onPress={() => onArmType(null)}
                  hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                >
                  <Text style={styles.cancelPillText}>Cancel</Text>
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
  },
  pillsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
  },
  layerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 3,
  },
  layerPillActive: {
    backgroundColor: '#0C1D31',
  },
  layerPillText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0C1D31',
  },
  layerPillTextActive: {
    color: '#fff',
  },
  tileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 10,
    gap: 8,
  },
  tile: {
    width: '22%',
    flexGrow: 1,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
    gap: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
    borderWidth: 2,
    borderColor: 'transparent',
    minHeight: 72,
  },
  tileArmed: {
    borderColor: '#25C1AC',
    backgroundColor: 'rgba(37,193,172,0.08)',
  },
  tileIconWrap: {
    position: 'relative',
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadge: {
    position: 'absolute',
    top: -4,
    right: -6,
    backgroundColor: '#25C1AC',
    borderRadius: 8,
    minWidth: 16,
    paddingHorizontal: 3,
    paddingVertical: 1,
    alignItems: 'center',
  },
  countBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#fff',
  },
  tileLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#4b5563',
    textAlign: 'center',
    lineHeight: 13,
  },
  tileLabelArmed: {
    color: '#25C1AC',
  },
  cancelPill: {
    backgroundColor: '#f44336',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 2,
  },
  cancelPillText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#fff',
  },
});
