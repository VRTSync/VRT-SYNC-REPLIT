import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type ReshootAsset = {
  id: string;
  label: string;
  assetType: string;
  latitude: number | null;
  longitude: number | null;
  gpsAccuracy: number | null;
  version: number;
};

type ReshootListProps = {
  assets: ReshootAsset[];
  onShowOnMap: (asset: ReshootAsset) => void;
  onReshoot: (asset: ReshootAsset) => void;
};

const ASSET_TYPE_LABELS: Record<string, string> = {
  controller: 'Controller',
  backflow: 'Backflow',
  zone: 'Zone',
  tree: 'Tree',
  pet_station: 'Pet Station',
  landscape_bed: 'Landscape Bed',
  bluegrass_area: 'Bluegrass Area',
  native_area: 'Native Area',
  snow_area: 'Snow Area',
  master_valve: 'Master Valve',
  flow_meter: 'Flow Meter',
  pump: 'Pump',
  quick_connect: 'Quick Connect',
  isolation_valve: 'Isolation Valve',
};

function AccuracyBadge({ accuracy }: { accuracy: number | null }) {
  if (accuracy === null) {
    return (
      <View style={[styles.badge, styles.badgeMissing]}>
        <Ionicons name="help-circle-outline" size={11} color="#92400e" />
        <Text style={[styles.badgeText, { color: '#92400e' }]}>No accuracy</Text>
      </View>
    );
  }
  const color = accuracy > 10 ? '#dc2626' : accuracy > 5 ? '#ea580c' : '#d97706';
  const textColor = accuracy > 10 ? '#991b1b' : accuracy > 5 ? '#9a3412' : '#92400e';
  return (
    <View style={[styles.badge, { backgroundColor: color + '20', borderColor: color + '40' }]}>
      <Ionicons name="navigate-outline" size={11} color={textColor} />
      <Text style={[styles.badgeText, { color: textColor }]}>±{accuracy.toFixed(1)}m</Text>
    </View>
  );
}

export default function ReshootList({ assets, onShowOnMap, onReshoot }: ReshootListProps) {
  if (assets.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Ionicons name="checkmark-circle" size={48} color="#25C1AC" />
        <Text style={styles.emptyTitle}>All pins look good!</Text>
        <Text style={styles.emptySubtitle}>
          No pins with low accuracy or missing GPS data.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.headerRow}>
        <Ionicons name="warning-outline" size={16} color="#ea580c" />
        <Text style={styles.headerText}>
          {assets.length} pin{assets.length !== 1 ? 's' : ''} need re-shooting
        </Text>
      </View>

      {assets.map((asset) => (
        <View key={asset.id} style={styles.assetCard}>
          <View style={styles.assetInfo}>
            <Text style={styles.assetLabel} numberOfLines={1}>{asset.label}</Text>
            <View style={styles.assetMeta}>
              <Text style={styles.assetType}>{ASSET_TYPE_LABELS[asset.assetType] ?? asset.assetType}</Text>
              <AccuracyBadge accuracy={asset.gpsAccuracy} />
            </View>
          </View>

          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.showBtn}
              onPress={() => onShowOnMap(asset)}
              activeOpacity={0.7}
            >
              <Ionicons name="locate-outline" size={14} color="#25C1AC" />
              <Text style={styles.showBtnText}>Show</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.reshootBtn}
              onPress={() => onReshoot(asset)}
              activeOpacity={0.7}
            >
              <Ionicons name="camera-outline" size={14} color="#fff" />
              <Text style={styles.reshootBtnText}>Re-shoot</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: {
    padding: 16,
    gap: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fff7ed',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  headerText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9a3412',
  },
  assetCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
    gap: 10,
  },
  assetInfo: {
    gap: 4,
  },
  assetLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0C1D31',
  },
  assetMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  assetType: {
    fontSize: 12,
    color: '#6b7280',
    textTransform: 'capitalize',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
  },
  badgeMissing: {
    backgroundColor: '#fef3c7',
    borderColor: '#fde68a',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  showBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderWidth: 1.5,
    borderColor: '#25C1AC',
    borderRadius: 8,
    paddingVertical: 8,
  },
  showBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#25C1AC',
  },
  reshootBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: '#25C1AC',
    borderRadius: 8,
    paddingVertical: 8,
  },
  reshootBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0C1D31',
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 20,
  },
});
