import React, { useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, Platform, Image, Modal, Dimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getQueryFn } from '@/lib/query-client';
import { useOffline } from '@/client/contexts/OfflineContext';
import { useOfflinePack } from '@/client/contexts/OfflinePackContext';

type HistoryEntry = {
  id: string;
  type: 'task_completion';
  completedAt: string;
  completedBy: { id: string; displayName: string };
  employeeSignOffName: string;
  notes: string | null;
  timeSpentMinutes: number | null;
  materialsUsed: string | null;
  followUpNeeded: string | null;
  task: { id: string; title: string };
  attachments: { id: string; url: string }[];
};

type AssetInfo = {
  id: string;
  label: string;
  assetType: string;
};

const ASSET_TYPE_LABELS: Record<string, string> = {
  controller: 'Controller', backflow: 'Backflow', zone: 'Zone', tree: 'Tree',
  pet_station: 'Pet Station', landscape_bed: 'Landscape Bed', bluegrass_area: 'Bluegrass Area',
  native_area: 'Native Area', snow_area: 'Snow Area',
};

const screenWidth = Dimensions.get('window').width;

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export default function AssetHistoryScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [fullScreenPhoto, setFullScreenPhoto] = useState<string | null>(null);
  const { isOnline } = useOffline();
  const { localPack, getOfflineWorkHistory, resolveFeatureToAsset } = useOfflinePack();
  const useOfflineData = !isOnline && !!localPack;

  const { data: asset } = useQuery<AssetInfo>({
    queryKey: [`/api/assets/${id}`],
    queryFn: getQueryFn({ on401: 'throw' }),
    enabled: !!id && !useOfflineData,
  });

  const { data: onlineHistory = [], isLoading } = useQuery<HistoryEntry[]>({
    queryKey: [`/api/assets/${id}/history`],
    queryFn: getQueryFn({ on401: 'throw' }),
    enabled: !!id && !useOfflineData,
  });

  const offlineHistory = React.useMemo(() => {
    if (!useOfflineData || !id) return [];
    return (getOfflineWorkHistory(id as string) || []) as HistoryEntry[];
  }, [useOfflineData, id, localPack]);

  const history = useOfflineData ? offlineHistory : onlineHistory;

  const offlineAssetInfo = React.useMemo(() => {
    if (!useOfflineData || !id) return null;
    const assetIndex = localPack?.assetIndex || {};
    const entry = Object.values(assetIndex).find((e: any) => e.assetId === id);
    if (!entry) return null;
    return { id: entry.assetId, label: entry.label, assetType: entry.assetType } as AssetInfo;
  }, [useOfflineData, id, localPack]);

  const displayAsset = useOfflineData ? offlineAssetInfo : asset;

  const renderEntry = ({ item }: { item: HistoryEntry }) => (
    <View style={styles.entryCard}>
      <View style={styles.entryHeader}>
        <View style={styles.dateBadge}>
          <Ionicons name="calendar-outline" size={14} color="#25C1AC" />
          <Text style={styles.dateText}>{formatDate(item.completedAt)}</Text>
          <Text style={styles.timeText}>{formatTime(item.completedAt)}</Text>
        </View>
      </View>

      <TouchableOpacity
        style={styles.taskLink}
        onPress={() => router.push(`/task/${item.task.id}` as any)}
      >
        <Ionicons name="clipboard-outline" size={16} color="#0C1D31" />
        <Text style={styles.taskTitle} numberOfLines={2}>{item.task.title}</Text>
        <Ionicons name="chevron-forward" size={14} color="#ccc" />
      </TouchableOpacity>

      <View style={styles.entryMeta}>
        <View style={styles.metaRow}>
          <Ionicons name="person-outline" size={14} color="#666" />
          <Text style={styles.metaText}>{item.employeeSignOffName || item.completedBy.displayName}</Text>
        </View>
        {item.timeSpentMinutes != null && (
          <View style={styles.metaRow}>
            <Ionicons name="time-outline" size={14} color="#666" />
            <Text style={styles.metaText}>{item.timeSpentMinutes} min</Text>
          </View>
        )}
      </View>

      {item.notes ? (
        <View style={styles.notesSection}>
          <Text style={styles.notesLabel}>Notes</Text>
          <Text style={styles.notesText}>{item.notes}</Text>
        </View>
      ) : null}

      {item.materialsUsed ? (
        <View style={styles.notesSection}>
          <Text style={styles.notesLabel}>Materials</Text>
          <Text style={styles.notesText}>{item.materialsUsed}</Text>
        </View>
      ) : null}

      {item.followUpNeeded ? (
        <View style={styles.followUpBadge}>
          <Ionicons name="flag-outline" size={14} color="#f57c00" />
          <Text style={styles.followUpText}>Follow-up: {item.followUpNeeded}</Text>
        </View>
      ) : null}

      {item.attachments.length > 0 && (
        <View style={styles.photosRow}>
          {item.attachments.map((a) => (
            <TouchableOpacity
              key={a.id}
              onPress={() => setFullScreenPhoto(a.url)}
              style={styles.photoThumb}
            >
              <Image source={{ uri: a.url }} style={styles.photoImage} />
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={[styles.header, Platform.OS === 'web' && { paddingTop: 67 + insets.top }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>Work History</Text>
          {displayAsset && (
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {displayAsset.label} · {ASSET_TYPE_LABELS[displayAsset.assetType] || displayAsset.assetType}
            </Text>
          )}
          {useOfflineData && (
            <Text style={styles.offlineTag}>Offline snapshot</Text>
          )}
        </View>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#25C1AC" size="large" />
        </View>
      ) : history.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="time-outline" size={48} color="#ddd" />
          <Text style={styles.emptyTitle}>No work history yet</Text>
          <Text style={styles.emptySubtitle}>Completed tasks linked to this asset will appear here</Text>
        </View>
      ) : (
        <FlatList
          data={history}
          keyExtractor={(item) => item.id}
          renderItem={renderEntry}
          contentContainerStyle={styles.listContent}
          scrollEnabled={!!history.length}
        />
      )}

      <Modal visible={!!fullScreenPhoto} transparent animationType="fade">
        <View style={styles.photoModal}>
          <TouchableOpacity
            style={[styles.photoCloseBtn, Platform.OS === 'web' && { top: 67 + insets.top + 12 }]}
            onPress={() => setFullScreenPhoto(null)}
          >
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          {fullScreenPhoto && (
            <Image
              source={{ uri: fullScreenPhoto }}
              style={styles.fullPhoto}
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
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
  offlineTag: { fontSize: 11, color: '#f39c12', marginTop: 2, fontWeight: '500' },
  listContent: { padding: 16, paddingBottom: 40 },
  entryCard: {
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
  entryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  dateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dateText: { fontSize: 14, fontWeight: '600', color: '#0C1D31' },
  timeText: { fontSize: 13, color: '#999' },
  taskLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#f5f7fa',
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
  },
  taskTitle: { flex: 1, fontSize: 14, fontWeight: '600', color: '#0C1D31' },
  entryMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginBottom: 6,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: { fontSize: 13, color: '#666' },
  notesSection: { marginTop: 8 },
  notesLabel: { fontSize: 12, fontWeight: '600', color: '#999', marginBottom: 2, textTransform: 'uppercase' },
  notesText: { fontSize: 14, color: '#333', lineHeight: 20 },
  followUpBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    backgroundColor: '#fff3e0',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  followUpText: { fontSize: 13, color: '#f57c00', fontWeight: '500' },
  photosRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  photoThumb: {
    width: 72,
    height: 72,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#eee',
  },
  photoImage: { width: '100%', height: '100%' },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#333', marginTop: 16 },
  emptySubtitle: { fontSize: 14, color: '#999', marginTop: 4, textAlign: 'center' },
  photoModal: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoCloseBtn: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullPhoto: {
    width: screenWidth - 32,
    height: screenWidth - 32,
  },
});
