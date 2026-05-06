import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getQueryFn } from '@/lib/query-client';

type AssetDetail = {
  id: string;
  communityId: string;
  assetType: string;
  label: string;
  featureRef: string | null;
  geometryType: string | null;
  latitude: number | null;
  longitude: number | null;
  version: number;
  tags: string[];
  createdBy: string | null;
  updatedBy: string | null;
  createdByName: string | null;
  updatedByName: string | null;
  createdAt: string;
  updatedAt: string;
  properties: { id: string; key: string; value: string; version: number }[];
};

function formatSqFt(val: string): string {
  const num = parseInt(val, 10);
  if (isNaN(num)) return val;
  return num.toLocaleString('en-US');
}

const ASSET_TYPE_LABELS: Record<string, string> = {
  controller: 'Controller', backflow: 'Backflow', zone: 'Zone', tree: 'Tree',
  pet_station: 'Pet Station', landscape_bed: 'Landscape Bed', bluegrass_area: 'Bluegrass Area',
  native_area: 'Native Area', snow_area: 'Snow Area',
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function AssetDetailScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { data: asset, isLoading } = useQuery<AssetDetail>({
    queryKey: [`/api/assets/${id}`],
    queryFn: getQueryFn({ on401: 'throw' }),
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color="#25C1AC" size="large" />
      </View>
    );
  }

  if (!asset) {
    return (
      <View style={[styles.container, styles.center]}>
        <Ionicons name="alert-circle-outline" size={48} color="#ccc" />
        <Text style={styles.notFoundText}>Asset not found</Text>
      </View>
    );
  }

  const sqFtProp = asset.properties.find(p => p.key === 'sqFt');
  const displayProps = asset.properties.filter(p => p.key !== 'sqFt');
  const hasTags = asset.tags && asset.tags.length > 0;
  const hasAudit = asset.createdByName || asset.updatedByName;

  return (
    <View style={styles.container}>
      <View style={[styles.header, Platform.OS === 'web' && { paddingTop: 67 + insets.top }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>{asset.label}</Text>
          <Text style={styles.headerSubtitle}>
            {ASSET_TYPE_LABELS[asset.assetType] || asset.assetType}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Details</Text>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Type</Text>
            <Text style={styles.detailValue}>{ASSET_TYPE_LABELS[asset.assetType] || asset.assetType}</Text>
          </View>
          {asset.featureRef && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Feature Ref</Text>
              <Text style={styles.detailValue}>{asset.featureRef}</Text>
            </View>
          )}
          {asset.geometryType && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Geometry</Text>
              <Text style={styles.detailValue}>{asset.geometryType}</Text>
            </View>
          )}
          {asset.latitude != null && asset.longitude != null && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Location</Text>
              <Text style={styles.detailValue}>
                {asset.latitude.toFixed(6)}, {asset.longitude.toFixed(6)}
              </Text>
            </View>
          )}
        </View>

        {sqFtProp && (
          <View style={[styles.card, styles.sqFtCard]}>
            <View style={styles.sqFtRow}>
              <Ionicons name="resize-outline" size={22} color="#25C1AC" />
              <Text style={styles.sqFtValue}>{formatSqFt(sqFtProp.value)}</Text>
              <Text style={styles.sqFtLabel}>sq ft</Text>
            </View>
          </View>
        )}

        {hasTags && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Tags</Text>
            <View style={styles.tagsContainer}>
              {asset.tags.map((tag, idx) => (
                <View key={idx} style={styles.tagChip}>
                  <Text style={styles.tagText}>{tag}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {displayProps.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Properties</Text>
            {displayProps.map((p) => (
              <View key={p.id} style={styles.detailRow}>
                <Text style={styles.detailLabel}>{p.key}</Text>
                <Text style={styles.detailValue}>{p.value}</Text>
              </View>
            ))}
          </View>
        )}

        {hasAudit && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Audit Trail</Text>
            {asset.createdByName && (
              <View style={styles.auditRow}>
                <View style={styles.auditIconWrap}>
                  <Ionicons name="person-add-outline" size={16} color="#25C1AC" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.auditLabel}>Created by</Text>
                  <Text style={styles.auditValue}>{asset.createdByName}</Text>
                  <Text style={styles.auditDate}>{formatDate(asset.createdAt)}</Text>
                </View>
              </View>
            )}
            {asset.updatedByName && (
              <View style={styles.auditRow}>
                <View style={styles.auditIconWrap}>
                  <Ionicons name="create-outline" size={16} color="#F59E0B" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.auditLabel}>Updated by</Text>
                  <Text style={styles.auditValue}>{asset.updatedByName}</Text>
                  <Text style={styles.auditDate}>{formatDate(asset.updatedAt)}</Text>
                </View>
              </View>
            )}
          </View>
        )}

        <TouchableOpacity
          style={styles.historyBtn}
          onPress={() => router.push(`/asset/${id}/history` as any)}
        >
          <Ionicons name="time-outline" size={20} color="#fff" />
          <Text style={styles.historyBtnText}>View Work History</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa' },
  center: { justifyContent: 'center', alignItems: 'center' },
  notFoundText: { fontSize: 16, color: '#999', marginTop: 12 },
  header: {
    backgroundColor: '#0C1D31',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    gap: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: { fontSize: 18, fontWeight: '700' as const, color: '#fff' },
  headerSubtitle: { fontSize: 13, color: '#25C1AC', marginTop: 2, fontWeight: '500' as const },
  content: { padding: 16, paddingBottom: 40 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700' as const, color: '#0C1D31', marginBottom: 12 },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  detailLabel: { fontSize: 14, color: '#666', fontWeight: '500' as const },
  detailValue: { fontSize: 14, color: '#333', fontWeight: '400' as const, maxWidth: '60%', textAlign: 'right' as const },
  sqFtCard: {
    backgroundColor: '#E8F8F5',
    borderWidth: 1,
    borderColor: '#B2DFDB',
  },
  sqFtRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sqFtValue: {
    fontSize: 22,
    fontWeight: '700' as const,
    color: '#0C1D31',
  },
  sqFtLabel: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500' as const,
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tagChip: {
    backgroundColor: '#E0F7FA',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#B2EBF2',
  },
  tagText: {
    fontSize: 13,
    color: '#00838F',
    fontWeight: '600' as const,
  },
  auditRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  auditIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f0f4f8',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  auditLabel: {
    fontSize: 12,
    color: '#999',
    fontWeight: '500' as const,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  auditValue: {
    fontSize: 14,
    color: '#333',
    fontWeight: '600' as const,
    marginTop: 1,
  },
  auditDate: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  historyBtn: {
    backgroundColor: '#25C1AC',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 4,
    marginBottom: 20,
  },
  historyBtnText: { fontSize: 16, fontWeight: '600' as const, color: '#fff' },
});
