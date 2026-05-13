import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type Asset = {
  id: string;
  assetType: string;
  label: string;
  isArchived?: boolean;
  properties?: Record<string, string>;
};

type Controller = {
  id: string;
  label: string;
  controllerKey: string;
  zoneCount: number;
};

type TallyPanelProps = {
  assets: Asset[];
  controllers: Controller[];
};

const ASSET_TYPE_LABELS: Record<string, string> = {
  controller: 'Controllers',
  backflow: 'Backflows',
  zone: 'Zones',
  tree: 'Trees',
  pet_station: 'Pet Stations',
  landscape_bed: 'Landscape Beds',
  bluegrass_area: 'Bluegrass Areas',
  native_area: 'Native Areas',
  snow_area: 'Snow Areas',
  master_valve: 'Master Valves',
  flow_meter: 'Flow Meters',
  pump: 'Pumps',
  quick_connect: 'Quick Connects',
  isolation_valve: 'Isolation Valves',
};

export default function TallyPanel({ assets, controllers }: TallyPanelProps) {
  const active = assets.filter(a => !a.isArchived);

  const countsByType: Record<string, number> = {};
  for (const asset of active) {
    countsByType[asset.assetType] = (countsByType[asset.assetType] ?? 0) + 1;
  }

  const totalPins = active.length;

  const sortedTypes = Object.entries(countsByType).sort(([a], [b]) => a.localeCompare(b));

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.summaryRow}>
        <Ionicons name="location" size={18} color="#25C1AC" />
        <Text style={styles.summaryText}>{totalPins} total pin{totalPins !== 1 ? 's' : ''} placed</Text>
      </View>

      {sortedTypes.map(([type, count]) => {
        const isIrrigation = type === 'controller' || type === 'zone';
        return (
          <View key={type} style={styles.typeCard}>
            <View style={styles.typeHeader}>
              <Text style={styles.typeName}>{ASSET_TYPE_LABELS[type] ?? type}</Text>
              <Text style={styles.typeCount}>{count}</Text>
            </View>

            {type === 'controller' && controllers.length > 0 && (
              <View style={styles.controllerBreakdown}>
                {controllers
                  .filter(c => c.controllerKey)
                  .sort((a, b) => a.controllerKey.localeCompare(b.controllerKey))
                  .map(ctrl => (
                    <View key={ctrl.id} style={styles.controllerRow}>
                      <Ionicons name="git-branch-outline" size={13} color="#6b7280" />
                      <Text style={styles.controllerLabel}>
                        Controller {ctrl.controllerKey} — {ctrl.zoneCount} zone{ctrl.zoneCount !== 1 ? 's' : ''}
                      </Text>
                    </View>
                  ))
                }
              </View>
            )}
          </View>
        );
      })}

      {sortedTypes.length === 0 && (
        <View style={styles.emptyState}>
          <Ionicons name="map-outline" size={40} color="#d1d5db" />
          <Text style={styles.emptyText}>No pins placed yet</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: {
    padding: 16,
    gap: 10,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#f0fdfb',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  summaryText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f7a6a',
  },
  typeCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  typeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  typeName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0C1D31',
  },
  typeCount: {
    fontSize: 18,
    fontWeight: '800',
    color: '#25C1AC',
  },
  controllerBreakdown: {
    marginTop: 10,
    gap: 5,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  controllerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  controllerLabel: {
    fontSize: 13,
    color: '#6b7280',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: 10,
  },
  emptyText: {
    fontSize: 14,
    color: '#9ca3af',
  },
});
