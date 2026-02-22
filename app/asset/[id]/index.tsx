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
  createdAt: string;
  updatedAt: string;
  properties: { id: string; key: string; value: string; version: number }[];
};

const ASSET_TYPE_LABELS: Record<string, string> = {
  controller: 'Controller', backflow: 'Backflow', zone: 'Zone', tree: 'Tree',
  pet_station: 'Pet Station', landscape_bed: 'Landscape Bed', bluegrass_area: 'Bluegrass Area',
  native_area: 'Native Area', snow_area: 'Snow Area',
};

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

        {asset.properties.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Properties</Text>
            {asset.properties.map((p) => (
              <View key={p.id} style={styles.detailRow}>
                <Text style={styles.detailLabel}>{p.key}</Text>
                <Text style={styles.detailValue}>{p.value}</Text>
              </View>
            ))}
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
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#fff' },
  headerSubtitle: { fontSize: 13, color: '#25C1AC', marginTop: 2, fontWeight: '500' },
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
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#0C1D31', marginBottom: 12 },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  detailLabel: { fontSize: 14, color: '#666', fontWeight: '500' },
  detailValue: { fontSize: 14, color: '#333', fontWeight: '400', maxWidth: '60%', textAlign: 'right' },
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
  historyBtnText: { fontSize: 16, fontWeight: '600', color: '#fff' },
});
