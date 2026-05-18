import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { apiRequest } from '@/lib/query-client';
import { useCommunity } from '@/client/contexts/CommunityContext';
import { usePinQueue } from '@/client/contexts/PinQueueContext';

type QualityAsset = {
  id: string;
  communityId: string;
  communityName?: string;
  assetType: string;
  label: string;
  latitude: number | null;
  longitude: number | null;
  capturedAccuracyM: number | null;
  capturedSampleCount: number | null;
  capturedAt: string | null;
  capturedDeviceModel: string | null;
  capturedUnderCanopy: boolean;
  isArchived: boolean;
};

const ASSET_TYPE_PRETTY: Record<string, string> = {
  tree: 'Tree',
  pet_station: 'Pet Station',
  controller: 'Controller',
  backflow: 'Backflow',
  pump: 'Pump',
  master_valve: 'Master Valve',
  flow_meter: 'Flow Meter',
  quick_connect: 'Quick Connect',
  isolation_valve: 'Isolation Valve',
  zone: 'Zone',
};

function accuracyColor(acc: number | null, underCanopy: boolean): string {
  if (acc === null) return '#9ca3af';
  if (underCanopy) return '#06b6d4';
  if (acc <= 2.5) return '#22c55e';
  if (acc <= 5) return '#FFC107';
  return '#ef4444';
}

function accuracyLabel(acc: number | null): string {
  if (acc === null) return 'No data';
  return `${acc.toFixed(1)} m`;
}

function formatRelativeDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays < 1) return 'today';
  if (diffDays === 1) return '1d ago';
  if (diffDays < 7) return `${diffDays}d ago`;
  const wks = Math.floor(diffDays / 7);
  if (wks < 5) return `${wks}w ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

type FilterKey = 'all' | 'gt5m_strict' | 'gt3m_strict' | 'missing' | 'canopy';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'gt5m_strict', label: '>5 m strict' },
  { key: 'gt3m_strict', label: '>3 m strict' },
  { key: 'missing', label: 'Missing GPS' },
  { key: 'canopy', label: 'Canopy' },
];

function QualityRow({ item, onPress }: { item: QualityAsset; onPress: () => void }) {
  const acc = item.capturedAccuracyM;
  const color = accuracyColor(acc, item.capturedUnderCanopy);

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.75}>
      <View style={[styles.accuracyDot, { backgroundColor: color }]} />
      <View style={styles.rowContent}>
        <View style={styles.rowHeader}>
          <Text style={styles.rowLabel} numberOfLines={1}>{item.label}</Text>
          <Text style={[styles.rowAccuracy, { color }]}>{accuracyLabel(acc)}</Text>
        </View>
        <View style={styles.rowMeta}>
          <Text style={styles.rowType}>{ASSET_TYPE_PRETTY[item.assetType] ?? item.assetType}</Text>
          {item.communityName ? (
            <Text style={styles.rowCommunity} numberOfLines={1}> · {item.communityName}</Text>
          ) : null}
          {item.capturedUnderCanopy && (
            <View style={styles.canopyBadge}>
              <Ionicons name="leaf" size={9} color="#06b6d4" />
              <Text style={[styles.canopyBadgeText, { color: '#06b6d4' }]}>Canopy</Text>
            </View>
          )}
          {item.capturedSampleCount != null && (
            <Text style={styles.rowSamples}> · {item.capturedSampleCount} samp</Text>
          )}
          {formatRelativeDate(item.capturedAt) ? (
            <Text style={styles.rowDate}> · {formatRelativeDate(item.capturedAt)}</Text>
          ) : null}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={16} color="#d1d5db" />
    </TouchableOpacity>
  );
}

export default function QualityScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { communities } = useCommunity();
  const { pendingEntries, syncNow } = usePinQueue();
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');
  const [selectedCommunityId, setSelectedCommunityId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const communityMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of communities) m[c.id] = c.name;
    return m;
  }, [communities]);

  // Build server-side query URL from active filter — filters + sort pushed fully into SQL.
  const queryUrl = useMemo(() => {
    const p = new URLSearchParams({ sort: 'accuracy_desc' });
    if (selectedCommunityId) p.set('communityId', selectedCommunityId);
    switch (activeFilter) {
      case 'gt5m_strict':
        p.set('hasAccuracy', 'true'); p.set('underCanopy', 'false'); p.set('minAccuracyM', '5');
        break;
      case 'gt3m_strict':
        p.set('hasAccuracy', 'true'); p.set('underCanopy', 'false'); p.set('minAccuracyM', '3');
        break;
      case 'missing':
        p.set('hasAccuracy', 'false');
        break;
      case 'canopy':
        p.set('underCanopy', 'true');
        break;
      default:
        // 'all': strict captures only — canopy pins are not reshoot targets
        p.set('underCanopy', 'false');
    }
    return `/api/assets?${p.toString()}`;
  }, [activeFilter, selectedCommunityId]);

  const { data: assets = [], isFetching, refetch } = useQuery<QualityAsset[]>({
    queryKey: ['/api/assets', 'quality', selectedCommunityId, activeFilter],
    queryFn: async () => {
      const res = await apiRequest('GET', queryUrl);
      if (!res.ok) return [];
      return (await res.json() as QualityAsset[]).filter((a) => !a.isArchived);
    },
    staleTime: 30_000,
  });

  const withCommunity = useMemo(
    () => assets.map((a) => ({ ...a, communityName: communityMap[a.communityId] })),
    [assets, communityMap],
  );

  // Server already applied all filters; client just enriches with community name.
  const filtered = withCommunity;

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    try { await syncNow(); } finally { setSyncing(false); }
  };

  const reshootCount = withCommunity.filter(
    (a) => !a.capturedUnderCanopy && a.capturedAccuracyM != null && a.capturedAccuracyM > 5,
  ).length;
  const noDataCount = withCommunity.filter((a) => a.capturedAccuracyM == null).length;

  const pendingForCommunity = selectedCommunityId
    ? pendingEntries.filter((e) => e.communityId === selectedCommunityId)
    : pendingEntries;
  const failedCount = pendingForCommunity.filter((e) => e.state === 'failed').length;
  const pendingCount = pendingForCommunity.filter((e) => e.state === 'queued' || e.state === 'syncing').length;
  const hasPendingSync = pendingCount > 0 || failedCount > 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>GPS Quality</Text>
        {isFetching && !refreshing && (
          <ActivityIndicator size="small" color="#25C1AC" style={styles.spinner} />
        )}
      </View>

      {/* Pending-sync banner */}
      {hasPendingSync && (
        <TouchableOpacity style={styles.syncBanner} onPress={handleSyncNow} activeOpacity={0.85}>
          <Ionicons
            name={failedCount > 0 ? 'warning-outline' : 'cloud-upload-outline'}
            size={16}
            color={failedCount > 0 ? '#ef4444' : '#f59e0b'}
          />
          <Text style={[styles.syncBannerText, failedCount > 0 && styles.syncBannerTextError]}>
            {failedCount > 0
              ? `${failedCount} pin${failedCount > 1 ? 's' : ''} failed to sync — tap to retry`
              : `${pendingCount} pin${pendingCount > 1 ? 's' : ''} pending upload`}
          </Text>
          {syncing && <ActivityIndicator size="small" color="#f59e0b" style={{ marginLeft: 4 }} />}
        </TouchableOpacity>
      )}

      {/* Community filter chips */}
      {communities.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.communityScroll}
          contentContainerStyle={styles.communityScrollContent}
        >
          <TouchableOpacity
            style={[styles.communityChip, selectedCommunityId === null && styles.communityChipActive]}
            onPress={() => setSelectedCommunityId(null)}
            activeOpacity={0.8}
          >
            <Text style={[styles.communityChipText, selectedCommunityId === null && styles.communityChipTextActive]}>
              All
            </Text>
          </TouchableOpacity>
          {communities.map((c) => (
            <TouchableOpacity
              key={c.id}
              style={[styles.communityChip, selectedCommunityId === c.id && styles.communityChipActive]}
              onPress={() => setSelectedCommunityId(c.id)}
              activeOpacity={0.8}
            >
              <Text style={[styles.communityChipText, selectedCommunityId === c.id && styles.communityChipTextActive]} numberOfLines={1}>
                {c.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Summary stats */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statNum}>{withCommunity.length}</Text>
          <Text style={styles.statLabel}>Total</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statNum, { color: reshootCount > 0 ? '#ef4444' : '#22c55e' }]}>{reshootCount}</Text>
          <Text style={styles.statLabel}>{'>5m'}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statNum, { color: noDataCount > 0 ? '#9ca3af' : '#22c55e' }]}>{noDataCount}</Text>
          <Text style={styles.statLabel}>No GPS</Text>
        </View>
        {pendingEntries.length > 0 && (
          <View style={styles.statCard}>
            <Text style={[styles.statNum, { color: '#f59e0b' }]}>{pendingEntries.length}</Text>
            <Text style={styles.statLabel}>Pending</Text>
          </View>
        )}
      </View>

      {/* Filter chips */}
      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterChip, activeFilter === f.key && styles.filterChipActive]}
            onPress={() => setActiveFilter(f.key)}
            activeOpacity={0.8}
          >
            <Text style={[styles.filterChipText, activeFilter === f.key && styles.filterChipTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <QualityRow
            item={item}
            onPress={() => {
              // expo-router typed routes don't allow arbitrary search params beyond
              // the route's declared [id] segment; use string URL to pass extras
              (router.push as (href: string) => void)(
                `/mc-workspace/${item.communityId}?targetPinId=${encodeURIComponent(item.id)}&targetPinLabel=${encodeURIComponent(item.label ?? '')}`,
              );
            }}
          />
        )}
        contentContainerStyle={[styles.list, filtered.length === 0 && styles.listEmpty]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#25C1AC" />
        }
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Ionicons name="checkmark-circle-outline" size={48} color="#d1d5db" />
            <Text style={styles.emptyText}>
              {activeFilter === 'all'
                ? 'No assets found'
                : activeFilter === 'gt5m_strict'
                ? 'All strict captures are ≤ 5 m'
                : activeFilter === 'gt3m_strict'
                ? 'All strict captures are ≤ 3 m'
                : activeFilter === 'missing'
                ? 'All assets have GPS data'
                : 'No canopy-mode captures'}
            </Text>
          </View>
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f7fa',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0C1D31',
    flex: 1,
  },
  spinner: {
    marginLeft: 8,
  },
  syncBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'rgba(245,158,11,0.08)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#fcd34d',
    gap: 8,
  },
  syncBannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#92400e',
  },
  syncBannerTextError: {
    color: '#b91c1c',
  },
  communityScroll: {
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
    flexGrow: 0,
  },
  communityScrollContent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    flexDirection: 'row',
  },
  communityChip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 16,
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: 'transparent',
    maxWidth: 160,
  },
  communityChipActive: {
    backgroundColor: 'rgba(37,193,172,0.1)',
    borderColor: '#25C1AC',
  },
  communityChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
  },
  communityChipTextActive: {
    color: '#25C1AC',
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    backgroundColor: '#f9fafb',
    borderRadius: 10,
  },
  statNum: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0C1D31',
    lineHeight: 28,
  },
  statLabel: {
    fontSize: 11,
    color: '#9ca3af',
    fontWeight: '600',
    marginTop: 2,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    flexWrap: 'wrap',
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 16,
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  filterChipActive: {
    backgroundColor: 'rgba(37,193,172,0.1)',
    borderColor: '#25C1AC',
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
  },
  filterChipTextActive: {
    color: '#25C1AC',
  },
  list: {
    paddingVertical: 4,
  },
  listEmpty: {
    flex: 1,
  },
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
    gap: 12,
  },
  emptyText: {
    fontSize: 15,
    color: '#9ca3af',
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#fff',
    gap: 12,
  },
  accuracyDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    flexShrink: 0,
  },
  rowContent: {
    flex: 1,
    gap: 3,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0C1D31',
    flex: 1,
    marginRight: 8,
  },
  rowAccuracy: {
    fontSize: 13,
    fontWeight: '700',
    flexShrink: 0,
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
  },
  rowType: {
    fontSize: 12,
    color: '#6b7280',
  },
  rowCommunity: {
    fontSize: 12,
    color: '#6b7280',
    flexShrink: 1,
  },
  rowSamples: {
    fontSize: 11,
    color: '#9ca3af',
  },
  rowDate: {
    fontSize: 11,
    color: '#9ca3af',
  },
  canopyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: 'rgba(34,197,94,0.1)',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  canopyBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#22c55e',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#f3f4f6',
    marginLeft: 38,
  },
});
