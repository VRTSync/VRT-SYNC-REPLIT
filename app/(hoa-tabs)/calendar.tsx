import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, FlatList, ScrollView, StyleSheet, TouchableOpacity, RefreshControl,
  ActivityIndicator, Platform,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/query-client';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import StatusBarFill from '@/components/StatusBarFill';
import NavyHeader, { subtitleStyles as ss } from '@/components/NavyHeader';
import { useNavyHeaderProps } from '@/components/useNavyHeaderProps';
import CalendarView from '@/components/CalendarView';
import CreateRequestSheet from '@/components/CreateRequestSheet';
import { useCommunity } from '@/client/contexts/CommunityContext';
import { useAuth } from '@/client/contexts/AuthContext';
import WeeklySummaryCard from '@/components/WeeklySummaryCard';

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: 'pending' | 'in_progress' | 'completed' | 'submitted' | 'acknowledged';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  windowStart: string | null;
  windowEnd: string | null;
  address: string | null;
  assignedTo: string | null;
  assignedToName?: string | null;
  dueDate: string | null;
  category: string | null;
  version: number;
  createdAt: string;
  updatedAt?: string;
  origin?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

type FilterKey = 'all' | 'overdue' | 'requests' | 'scheduled' | 'completed';
type ViewMode = 'list' | 'calendar';

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  submitted:    { label: 'Submitted',   bg: '#E3F2FD', text: '#1565C0' },
  acknowledged: { label: 'Acknowledged', bg: '#FFF3E0', text: '#E65100' },
  pending:      { label: 'Pending',     bg: '#F3E5F5', text: '#7B1FA2' },
  in_progress:  { label: 'In Progress', bg: '#E0F7FA', text: '#00838F' },
  completed:    { label: 'Completed',   bg: '#E8F5E9', text: '#2E7D32' },
};

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all',       label: 'All' },
  { key: 'overdue',   label: 'Overdue' },
  { key: 'requests',  label: 'Requests' },
  { key: 'scheduled', label: 'Scheduled Work' },
  { key: 'completed', label: 'Completed' },
];

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function toDateOnly(s: string): Date {
  const d = s.includes('T') ? s.split('T')[0] : s;
  return new Date(d + 'T00:00:00');
}

function formatWindowRange(task: Task): string | null {
  if (!task.windowStart || !task.windowEnd) return null;
  const s = toDateOnly(task.windowStart);
  const e = toDateOnly(task.windowEnd);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const start = s.toLocaleDateString('en-US', opts);
  const end = e.toLocaleDateString('en-US', opts);
  return start === end ? start : `${start} – ${end}`;
}

function CommunityWorkCard({
  item,
  onPress,
  onViewOnMap,
}: {
  item: Task;
  onPress: () => void;
  onViewOnMap?: () => void;
}) {
  const isHoa = item.origin === 'HOA';
  const statusCfg = STATUS_CONFIG[item.status] ?? { label: item.status, bg: '#ECEFF1', text: '#546E7A' };
  const windowRange = formatWindowRange(item);
  const hasLocation = item.latitude != null && item.longitude != null;

  const dateLabel = item.status === 'completed' && item.updatedAt
    ? `Completed ${formatDate(item.updatedAt)}`
    : item.createdAt
    ? `Submitted ${formatDate(item.createdAt)}`
    : null;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.cardHeader}>
        <View style={[styles.typeBadge, isHoa ? styles.typeBadgeRequest : styles.typeBadgeScheduled]}>
          <Text style={[styles.typeBadgeText, isHoa ? styles.typeBadgeTextRequest : styles.typeBadgeTextScheduled]}>
            {isHoa ? 'REQUEST' : 'SCHEDULED'}
          </Text>
        </View>
        <View style={[styles.statusChip, { backgroundColor: statusCfg.bg }]}>
          <Text style={[styles.statusChipText, { color: statusCfg.text }]}>{statusCfg.label}</Text>
        </View>
      </View>

      <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>

      {item.description ? (
        <Text style={styles.cardDescription} numberOfLines={2}>{item.description}</Text>
      ) : null}

      <View style={styles.cardMeta}>
        {dateLabel ? (
          <View style={styles.metaRow}>
            <Ionicons name="time-outline" size={13} color="#999" />
            <Text style={styles.metaText}>{dateLabel}</Text>
          </View>
        ) : null}

        {windowRange ? (
          <View style={styles.metaRow}>
            <Ionicons name="calendar-outline" size={13} color="#999" />
            <Text style={styles.metaText}>Window: {windowRange}</Text>
          </View>
        ) : null}

        {item.address ? (
          <View style={styles.metaRow}>
            <Ionicons name="location-outline" size={13} color="#999" />
            <Text style={styles.metaText} numberOfLines={1}>{item.address}</Text>
          </View>
        ) : null}

        {item.assignedToName ? (
          <View style={styles.metaRow}>
            <Ionicons name="person-outline" size={13} color="#999" />
            <Text style={styles.metaText}>{item.assignedToName}</Text>
          </View>
        ) : item.assignedTo ? (
          <View style={styles.metaRow}>
            <Ionicons name="person-outline" size={13} color="#999" />
            <Text style={styles.metaText}>Assigned</Text>
          </View>
        ) : null}
      </View>

      {hasLocation && onViewOnMap ? (
        <TouchableOpacity style={styles.mapAction} onPress={onViewOnMap} activeOpacity={0.7}>
          <Ionicons name="map-outline" size={14} color="#25C1AC" />
          <Text style={styles.mapActionText}>View on Map</Text>
        </TouchableOpacity>
      ) : null}
    </TouchableOpacity>
  );
}

function EmptyState({
  filterKey,
  onCreateRequest,
}: {
  filterKey: FilterKey;
  onCreateRequest: () => void;
}) {
  const messages: Record<FilterKey, { icon: keyof typeof Ionicons.glyphMap; title: string; subtitle: string; showCreate: boolean }> = {
    all:       { icon: 'clipboard-outline', title: 'No community work yet', subtitle: 'Work items will appear here once they are added', showCreate: false },
    overdue:   { icon: 'alert-circle-outline', title: 'No overdue items', subtitle: 'All tasks are on track — nothing is past due', showCreate: false },
    requests:  { icon: 'document-text-outline', title: 'No requests yet', subtitle: 'Tap + to submit a new request for your community', showCreate: true },
    scheduled: { icon: 'calendar-outline', title: 'No scheduled work', subtitle: 'Scheduled maintenance tasks will appear here', showCreate: false },
    completed: { icon: 'checkmark-circle-outline', title: 'Nothing completed yet', subtitle: 'Completed work items will appear here', showCreate: false },
  };
  const msg = messages[filterKey];

  return (
    <View style={styles.emptyState}>
      <Ionicons name={msg.icon} size={52} color="#ccc" />
      <Text style={styles.emptyTitle}>{msg.title}</Text>
      <Text style={styles.emptySubtitle}>{msg.subtitle}</Text>
      {msg.showCreate ? (
        <TouchableOpacity style={styles.emptyCreateBtn} onPress={onCreateRequest} activeOpacity={0.8}>
          <Ionicons name="add" size={18} color="#fff" />
          <Text style={styles.emptyCreateText}>New Request</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export default function HoaTasksScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { activeCommunity } = useCommunity();
  const { user } = useAuth();
  const navyHeaderProps = useNavyHeaderProps();
  const queryClient = useQueryClient();
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');
  const [viewMode, setViewMode] = useState<ViewMode>(
    user?.role === 'hoa_member' ? 'calendar' : 'list'
  );
  const [showCreateRequest, setShowCreateRequest] = useState(false);

  const communityId = activeCommunity?.id;

  const { data: tasks, isLoading, refetch } = useQuery<Task[]>({
    queryKey: ['/api/tasks', { communityId }],
    queryFn: async () => {
      const route = communityId ? `/api/tasks?communityId=${communityId}` : '/api/tasks';
      const res = await apiRequest('GET', route);
      return res.json();
    },
    enabled: !!communityId,
  });

  const isContractor = user?.role === 'contractor';

  const summaryLabels = isContractor
    ? { overdue: 'Overdue', active: 'My Active', requests: 'My Requests', completed: 'Done' }
    : { overdue: 'Overdue', active: 'Active Tasks', requests: 'Requests', completed: 'Completed' };

  const summaryCounts = useMemo(() => {
    if (!tasks) return { overdue: 0, active: 0, requests: 0, completed: 0 };
    const now = new Date();
    const overdue = tasks.filter(t =>
      t.status !== 'completed' && t.dueDate && new Date(t.dueDate) < now
    ).length;
    const active = tasks.filter(t =>
      t.origin !== 'HOA' && t.status !== 'completed'
    ).length;
    const requests = tasks.filter(t =>
      t.origin === 'HOA' && t.status !== 'completed'
    ).length;
    const completed = tasks.filter(t => t.status === 'completed').length;
    return { overdue, active, requests, completed };
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    if (!tasks) return [];
    const now = new Date();
    switch (activeFilter) {
      case 'overdue':
        return tasks.filter(t => t.status !== 'completed' && t.dueDate && new Date(t.dueDate) < now);
      case 'requests':
        return tasks.filter(t => t.origin === 'HOA' && t.status !== 'completed');
      case 'scheduled':
        return tasks.filter(t => t.origin !== 'HOA' && t.status !== 'completed');
      case 'completed':
        return tasks.filter(t => t.status === 'completed');
      default:
        return tasks;
    }
  }, [tasks, activeFilter]);

  const sortedTasks = useMemo(() => {
    return [...filteredTasks].sort((a, b) => {
      const aDate = new Date(a.updatedAt || a.createdAt).getTime();
      const bDate = new Date(b.updatedAt || b.createdAt).getTime();
      return bDate - aDate;
    });
  }, [filteredTasks]);

  const handleTaskPress = useCallback((taskId: string) => {
    router.push(`/task/${taskId}` as any);
  }, [router]);

  const handleViewOnMap = useCallback((_task: Task) => {
    router.push(`/(hoa-tabs)/map` as any);
  }, [router]);

  const handleCreateRequestClose = useCallback(() => {
    setShowCreateRequest(false);
    queryClient.invalidateQueries({ queryKey: ['/api/hoa/requests'] });
    queryClient.invalidateQueries({ queryKey: ['/api/tasks', { communityId }] });
  }, [queryClient, communityId]);

  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom + 80;

  return (
    <View style={styles.container}>
      <StatusBarFill />
      <NavyHeader {...navyHeaderProps}>
        <View style={ss.subtitleRow}>
          <View style={ss.subtitleActions}>
            <TouchableOpacity
              onPress={() => setShowCreateRequest(true)}
              style={ss.headerIconBtn}
              testID="new-request-btn"
            >
              <Ionicons name="add" size={22} color="#555" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setViewMode(viewMode === 'list' ? 'calendar' : 'list')}
              style={[ss.headerIconBtn, viewMode === 'calendar' && ss.headerIconBtnActive]}
            >
              <Ionicons
                name={viewMode === 'list' ? 'calendar-outline' : 'list-outline'}
                size={20}
                color={viewMode === 'calendar' ? '#fff' : '#555'}
              />
            </TouchableOpacity>
          </View>
        </View>
        <WeeklySummaryCard
          counts={summaryCounts}
          labels={summaryLabels}
          onStatPress={(filter) => {
            setActiveFilter(filter);
            if (viewMode === 'calendar') setViewMode('list');
          }}
          activeFilter={activeFilter}
        />
      </NavyHeader>

      {viewMode === 'list' && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterScrollWrapper}
          contentContainerStyle={styles.filterRow}
        >
          {FILTERS.map((f) => (
            <TouchableOpacity
              key={f.key}
              style={[styles.filterTab, activeFilter === f.key && styles.filterTabActive]}
              onPress={() => setActiveFilter(f.key)}
              activeOpacity={0.7}
            >
              <Text style={[styles.filterTabText, activeFilter === f.key && styles.filterTabTextActive]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {viewMode === 'calendar' ? (
        <CalendarView
          tasks={tasks ?? []}
          schedules={[]}
          visits={[]}
          pendingVisits={[]}
          onTaskPress={handleTaskPress}
          onLogVisit={() => {}}
          isOffline={false}
          role={user?.role}
        />
      ) : isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#25C1AC" />
        </View>
      ) : sortedTasks.length === 0 ? (
        <EmptyState filterKey={activeFilter} onCreateRequest={() => setShowCreateRequest(true)} />
      ) : (
        <FlatList
          data={sortedTasks}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <CommunityWorkCard
              item={item}
              onPress={() => handleTaskPress(item.id)}
              onViewOnMap={
                item.latitude != null && item.longitude != null
                  ? () => handleViewOnMap(item)
                  : undefined
              }
            />
          )}
          contentContainerStyle={[styles.listContent, { paddingBottom: bottomPad }]}
          refreshControl={
            <RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor="#25C1AC" colors={['#25C1AC']} />
          }
          scrollEnabled={sortedTasks.length > 0}
        />
      )}

      <CreateRequestSheet
        visible={showCreateRequest}
        onClose={handleCreateRequestClose}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  filterScrollWrapper: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
  },
  filterRow: {
    flexDirection: 'row',
    backgroundColor: '#e8eaed',
    borderRadius: 10,
    padding: 3,
    gap: 2,
  },
  filterTab: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    alignItems: 'center',
    borderRadius: 8,
  },
  filterTabActive: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  filterTabText: { fontSize: 11, fontWeight: '600', color: '#888' },
  filterTabTextActive: { color: '#0C1D31' },

  listContent: { paddingHorizontal: 16, paddingTop: 12 },

  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  typeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 5,
  },
  typeBadgeRequest: {
    backgroundColor: '#E0F7F4',
  },
  typeBadgeScheduled: {
    backgroundColor: '#EDE7F6',
  },
  typeBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  typeBadgeTextRequest: {
    color: '#00796B',
  },
  typeBadgeTextScheduled: {
    color: '#512DA8',
  },
  statusChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    marginLeft: 'auto',
  },
  statusChipText: {
    fontSize: 11,
    fontWeight: '700',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0C1D31',
    lineHeight: 21,
    marginBottom: 4,
  },
  cardDescription: {
    fontSize: 13,
    color: '#666',
    lineHeight: 18,
    marginBottom: 8,
  },
  cardMeta: {
    gap: 4,
    marginTop: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaText: {
    fontSize: 12,
    color: '#777',
    flex: 1,
  },
  mapAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    alignSelf: 'flex-start',
  },
  mapActionText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#25C1AC',
  },

  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#333',
    marginTop: 14,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#999',
    marginTop: 6,
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyCreateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 20,
    backgroundColor: '#25C1AC',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 25,
  },
  emptyCreateText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
});
