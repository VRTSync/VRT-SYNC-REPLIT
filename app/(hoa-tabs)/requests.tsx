import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ScrollView, RefreshControl, ActivityIndicator, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/client/contexts/AuthContext';
import { useCommunity } from '@/client/contexts/CommunityContext';
import StatusBarFill from '@/components/StatusBarFill';
import NavyHeader from '@/components/NavyHeader';
import { useNavyHeaderProps } from '@/components/useNavyHeaderProps';
import CreateRequestSheet from '@/components/CreateRequestSheet';

type HoaRequest = {
  id: string;
  title: string;
  status: string;
  priority: string;
  createdAt: string;
  completedAt: string | null;
  isArchived: boolean;
  assetId: string | null;
  assetLabel: string | null;
  latitude: number | null;
  longitude: number | null;
  attachmentCount: number;
  category: string | null;
};

type FilterKey = 'all' | 'submitted' | 'acknowledged' | 'completed' | 'archived';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'acknowledged', label: 'Acknowledged' },
  { key: 'completed', label: 'Completed' },
  { key: 'archived', label: 'Archived' },
];

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  submitted: { bg: '#E3F2FD', text: '#1565C0' },
  acknowledged: { bg: '#FFF3E0', text: '#E65100' },
  completed: { bg: '#E8F5E9', text: '#2E7D32' },
  pending: { bg: '#F3E5F5', text: '#7B1FA2' },
  in_progress: { bg: '#E0F7FA', text: '#00838F' },
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function RequestCard({ item, onPress }: { item: HoaRequest; onPress: () => void }) {
  const statusColor = STATUS_COLORS[item.status] ?? { bg: '#ECEFF1', text: '#546E7A' };
  const isUrgent = item.priority === 'urgent' || item.priority === 'Urgent';

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.cardTop}>
        <Text style={styles.requestLabel}>REQUEST</Text>
        {item.isArchived && <Text style={styles.archivedLabel}>ARCHIVED</Text>}
      </View>
      <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
      <View style={styles.badgeRow}>
        <View style={[styles.priorityBadge, { backgroundColor: isUrgent ? '#FFEBEE' : '#E0F2F1' }]}>
          <Ionicons
            name={isUrgent ? 'alert-circle' : 'flag'}
            size={12}
            color={isUrgent ? '#D32F2F' : '#25C1AC'}
          />
          <Text style={[styles.priorityText, { color: isUrgent ? '#D32F2F' : '#25C1AC' }]}>
            {isUrgent ? 'Urgent' : 'Normal'}
          </Text>
        </View>
        <View style={[styles.statusChip, { backgroundColor: statusColor.bg }]}>
          <Text style={[styles.statusText, { color: statusColor.text }]}>
            {item.status.replace('_', ' ')}
          </Text>
        </View>
      </View>
      <View style={styles.metaRow}>
        <Ionicons name="time-outline" size={13} color="#999" />
        <Text style={styles.metaText}>{formatDate(item.createdAt)}</Text>
      </View>
      <View style={styles.metaRow}>
        <Ionicons name="location-outline" size={13} color="#999" />
        <Text style={styles.metaText}>
          {item.assetId ? (item.assetLabel || 'Attached asset') : 'Pinned location'}
        </Text>
        {item.attachmentCount > 0 && (
          <View style={styles.photoIndicator}>
            <Ionicons name="camera-outline" size={13} color="#25C1AC" />
            <Text style={styles.photoCount}>{item.attachmentCount}</Text>
          </View>
        )}
      </View>
      {item.category && (
        <View style={styles.metaRow}>
          <Ionicons name="pricetag-outline" size={13} color="#999" />
          <Text style={styles.metaText}>{item.category}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function HoaRequestsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { activeCommunity } = useCommunity();
  const navyHeaderProps = useNavyHeaderProps();
  const queryClient = useQueryClient();
  const [activeFilter, setActiveFilter] = useState<FilterKey>('submitted');
  const [showCreateRequest, setShowCreateRequest] = useState(false);
  const isHoaAdmin = user?.role === 'hoa_admin';

  const { data, isLoading, isRefetching, refetch } = useQuery<HoaRequest[]>({
    queryKey: ['/api/hoa/requests'],
  });

  const filteredData = useMemo(() => {
    if (!data) return [];
    switch (activeFilter) {
      case 'submitted':
        return data.filter(r => r.status === 'submitted' && !r.isArchived);
      case 'acknowledged':
        return data.filter(r => r.status === 'acknowledged' && !r.isArchived);
      case 'completed':
        return data.filter(r => r.status === 'completed' && !r.isArchived);
      case 'archived':
        return data.filter(r => r.isArchived);
      case 'all':
      default:
        return data;
    }
  }, [data, activeFilter]);

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom + 80;

  return (
    <View style={styles.container}>
      <StatusBarFill />
      <NavyHeader {...navyHeaderProps}>
        <View style={styles.subtitleRow}>
          <Text style={styles.subtitleText}>REQUESTS</Text>
        </View>
      </NavyHeader>

      <View style={styles.filterContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterScroll}
        >
          {FILTERS.map((f) => (
            <TouchableOpacity
              key={f.key}
              style={[styles.filterChip, activeFilter === f.key && styles.filterChipActive]}
              onPress={() => setActiveFilter(f.key)}
              activeOpacity={0.7}
            >
              <Text style={[styles.filterText, activeFilter === f.key && styles.filterTextActive]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#25C1AC" />
        </View>
      ) : (
        <FlatList
          data={filteredData}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: bottomPad },
            filteredData.length === 0 && styles.emptyList,
          ]}
          scrollEnabled={filteredData.length > 0}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={handleRefresh}
              tintColor="#25C1AC"
              colors={['#25C1AC']}
            />
          }
          renderItem={({ item }) => (
            <RequestCard
              item={item}
              onPress={() => router.push(`/task/${item.id}`)}
            />
          )}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="document-text-outline" size={48} color="#ccc" />
              <Text style={styles.emptyTitle}>No requests found</Text>
              <Text style={styles.emptySubtitle}>
                {activeFilter === 'all'
                  ? 'No HOA requests have been created yet'
                  : `No ${activeFilter} requests`}
              </Text>
            </View>
          }
        />
      )}

      {isHoaAdmin && (
        <TouchableOpacity
          style={[styles.fab, { bottom: Platform.OS === 'web' ? 100 : insets.bottom + 90 }]}
          onPress={() => setShowCreateRequest(true)}
          activeOpacity={0.8}
        >
          <Ionicons name="add" size={28} color="#fff" />
        </TouchableOpacity>
      )}

      <CreateRequestSheet
        visible={showCreateRequest}
        onClose={() => {
          setShowCreateRequest(false);
          queryClient.invalidateQueries({ queryKey: ['/api/hoa/requests'] });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  subtitleRow: {
    backgroundColor: '#fff',
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
  },
  subtitleText: { fontSize: 13, fontWeight: '700' as const, color: '#0C1D31', letterSpacing: 1.5 },
  filterContainer: {
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e8e8e8',
  },
  filterScroll: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#f0f0f0',
    marginRight: 8,
  },
  filterChipActive: {
    backgroundColor: '#0C1D31',
  },
  filterText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: '#666',
  },
  filterTextActive: {
    color: '#fff',
  },
  listContent: {
    padding: 16,
  },
  emptyList: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cardTop: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginBottom: 6,
  },
  requestLabel: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: '#25C1AC',
    letterSpacing: 1.2,
  },
  archivedLabel: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: '#999',
    letterSpacing: 1,
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: '#1a1a1a',
    marginBottom: 10,
    lineHeight: 22,
  },
  badgeRow: {
    flexDirection: 'row' as const,
    gap: 8,
    marginBottom: 10,
  },
  priorityBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  priorityText: {
    fontSize: 12,
    fontWeight: '600' as const,
  },
  statusChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600' as const,
    textTransform: 'capitalize' as const,
  },
  metaRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginBottom: 4,
  },
  metaText: {
    fontSize: 13,
    color: '#777',
    flex: 1,
  },
  photoIndicator: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 3,
  },
  photoCount: {
    fontSize: 12,
    color: '#25C1AC',
    fontWeight: '600' as const,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    paddingTop: 60,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: '#555',
    marginTop: 12,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#999',
    marginTop: 4,
    textAlign: 'center' as const,
  },
  fab: {
    position: 'absolute' as const,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#25C1AC',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
    zIndex: 999,
  },
});
