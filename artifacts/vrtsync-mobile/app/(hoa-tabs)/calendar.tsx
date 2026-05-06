import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useToast } from '@/hooks/useToast';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl,
  ActivityIndicator, Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/query-client';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import StatusBarFill from '@/components/StatusBarFill';
import NavyHeader, { subtitleStyles as ss } from '@/components/NavyHeader';
import { useNavyHeaderProps } from '@/components/useNavyHeaderProps';
import CalendarView from '@/components/CalendarView';
import CreateRequestSheet from '@/components/CreateRequestSheet';
import Toast from '@/components/Toast';
import DayWorkSheet from '@/components/DayWorkSheet';
import { useCommunity } from '@/client/contexts/CommunityContext';
import { useAuth } from '@/client/contexts/AuthContext';
import WeeklySummaryCard, { type SummaryFilterKey } from '@/components/WeeklySummaryCard';
import { isRequestAging } from '@/constants/requestAging';
import { useTimeTick } from '@/hooks/useTimeTick';

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

type ViewMode = 'list' | 'calendar';

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  submitted:    { label: 'Submitted',    bg: '#E3F2FD', text: '#1565C0' },
  acknowledged: { label: 'Acknowledged', bg: '#FFF3E0', text: '#E65100' },
  pending:      { label: 'Pending',      bg: '#F3E5F5', text: '#7B1FA2' },
  in_progress:  { label: 'In Progress',  bg: '#E0F7FA', text: '#00838F' },
  completed:    { label: 'Completed',    bg: '#E8F5E9', text: '#2E7D32' },
};

const PREFS_STORAGE_KEY = 'hoa_tasks_prefs';
const VALID_FILTERS: SummaryFilterKey[] = ['all', 'overdue', 'requests', 'completed'];

type StoredPrefs = {
  activeFilter?: SummaryFilterKey;
  needsAttentionActive?: boolean;
};

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

function getAgingLabel(createdAt: string): string {
  const created = new Date(createdAt);
  const now = new Date();
  const days = Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0) return 'Today';
  if (days === 1) return '1 day old';
  return `${days} days old`;
}

function sortTasks(tasks: Task[]): Task[] {
  const now = new Date();
  const rank = (t: Task): number => {
    if (t.status !== 'completed' && t.dueDate && new Date(t.dueDate) < now) return 0; // Overdue
    if (t.origin === 'HOA' && t.status !== 'completed') return 1;                    // Requests
    if (t.status === 'in_progress' || t.status === 'pending') return 2;              // Active
    if (t.status === 'completed') return 4;                                            // Completed
    return 3;                                                                          // Upcoming/other
  };
  return [...tasks].sort((a, b) => {
    const rankDiff = rank(a) - rank(b);
    if (rankDiff !== 0) return rankDiff;
    // Within requests, sort oldest first
    if (a.origin === 'HOA' && b.origin === 'HOA') {
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    }
    return new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime();
  });
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
  const isRequest = item.origin === 'HOA';
  const statusCfg = STATUS_CONFIG[item.status] ?? { label: item.status, bg: '#ECEFF1', text: '#546E7A' };
  const windowRange = formatWindowRange(item);
  const hasLocation = item.latitude != null && item.longitude != null;

  const dateLabel = item.status === 'completed' && item.updatedAt
    ? `Completed ${formatDate(item.updatedAt)}`
    : item.createdAt
    ? `Submitted ${formatDate(item.createdAt)}`
    : null;

  const agingLabel = isRequest && item.status !== 'completed' ? getAgingLabel(item.createdAt) : null;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      {/* Row 1: title + status chip */}
      <View style={styles.cardRow1}>
        <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
        <View style={[styles.statusChip, { backgroundColor: statusCfg.bg }]}>
          <Text style={[styles.statusChipText, { color: statusCfg.text }]}>{statusCfg.label}</Text>
        </View>
      </View>

      {/* Row 2: type badge + description */}
      <View style={styles.cardRow2}>
        <View style={[styles.typeBadge, isRequest ? styles.typeBadgeRequest : styles.typeBadgeScheduled]}>
          <Text style={[styles.typeBadgeText, isRequest ? styles.typeBadgeTextRequest : styles.typeBadgeTextScheduled]}>
            {isRequest ? 'REQUEST' : 'SCHEDULED'}
          </Text>
        </View>
        {item.description ? (
          <Text style={styles.cardDescription} numberOfLines={2}>{item.description}</Text>
        ) : null}
      </View>

      {/* Row 3: date + contractor + aging */}
      <View style={styles.cardMeta}>
        {dateLabel ? (
          <View style={styles.metaRow}>
            <Ionicons name="time-outline" size={13} color="#999" />
            <Text style={styles.metaText}>{dateLabel}</Text>
            {agingLabel ? (
              <Text style={styles.agingText}>{agingLabel}</Text>
            ) : null}
          </View>
        ) : agingLabel ? (
          <View style={styles.metaRow}>
            <Ionicons name="hourglass-outline" size={13} color="#E65100" />
            <Text style={[styles.metaText, { color: '#E65100' }]}>{agingLabel}</Text>
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

      {/* Row 4: map link */}
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
  filter,
  needsAttention,
  canCreateRequest,
  isHoaMember,
  onCreateRequest,
  onViewAll,
  onViewRequests,
}: {
  filter: SummaryFilterKey;
  needsAttention: boolean;
  canCreateRequest: boolean;
  isHoaMember: boolean;
  onCreateRequest: () => void;
  onViewAll: () => void;
  onViewRequests: () => void;
}) {
  if (needsAttention) {
    return (
      <View style={styles.emptyState}>
        <Ionicons name="checkmark-circle-outline" size={52} color="#ccc" />
        <Text style={styles.emptyTitle}>All clear</Text>
        <Text style={styles.emptySubtitle}>No tasks need your attention right now</Text>
      </View>
    );
  }

  if (filter === 'overdue') {
    return (
      <View style={styles.emptyState}>
        <Ionicons name="checkmark-circle-outline" size={52} color="#43A047" />
        <Text style={styles.emptyTitle}>All tasks are on track</Text>
        <Text style={styles.emptySubtitle}>Nothing is past due — great work!</Text>
        <TouchableOpacity style={styles.emptyActionBtn} onPress={onViewRequests} activeOpacity={0.8}>
          <Text style={styles.emptyActionText}>View Requests</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (filter === 'requests') {
    return (
      <View style={styles.emptyState}>
        <Ionicons name="document-text-outline" size={52} color="#ccc" />
        <Text style={styles.emptyTitle}>
          {isHoaMember ? 'Have a concern to report?' : 'No active requests'}
        </Text>
        <Text style={styles.emptySubtitle}>
          {isHoaMember
            ? 'Submit a request to let your HOA know about issues in your community'
            : 'Community requests will appear here once submitted'}
        </Text>
        {canCreateRequest ? (
          <TouchableOpacity
            style={styles.emptyCreateBtn}
            onPress={onCreateRequest}
            activeOpacity={0.8}
            testID="empty-create-request-btn"
          >
            <Ionicons name="add" size={18} color="#fff" />
            <Text style={styles.emptyCreateText}>
              {isHoaMember ? 'Submit a Request' : 'Create Request'}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  if (filter === 'completed') {
    return (
      <View style={styles.emptyState}>
        <Ionicons name="checkmark-done-outline" size={52} color="#ccc" />
        <Text style={styles.emptyTitle}>Nothing completed yet</Text>
        <Text style={styles.emptySubtitle}>Completed work items will appear here</Text>
      </View>
    );
  }

  return (
    <View style={styles.emptyState}>
      <Ionicons name="checkmark-circle-outline" size={52} color="#ccc" />
      <Text style={styles.emptyTitle}>All clear</Text>
      <Text style={styles.emptySubtitle}>Work items will appear here once they are added</Text>
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
  const { taskId } = useLocalSearchParams<{ taskId?: string }>();
  const deepLinkTaskRef = useRef<string | null>(null);

  useEffect(() => {
    if (taskId && deepLinkTaskRef.current !== taskId) {
      deepLinkTaskRef.current = taskId;
      router.push({ pathname: '/task/[id]', params: { id: taskId } });
    }
  }, [taskId, router]);

  const [activeFilter, setActiveFilter] = useState<SummaryFilterKey>('all');
  const [needsAttentionActive, setNeedsAttentionActive] = useState(false);
  const prefsHydratedRef = useRef(false);
  const tick = useTimeTick();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(PREFS_STORAGE_KEY);
        if (cancelled) return;
        if (raw) {
          const parsed = JSON.parse(raw) as StoredPrefs;
          if (parsed.activeFilter && VALID_FILTERS.includes(parsed.activeFilter)) {
            setActiveFilter(parsed.activeFilter);
          }
          if (typeof parsed.needsAttentionActive === 'boolean') {
            setNeedsAttentionActive(parsed.needsAttentionActive);
          }
        }
      } catch {
        // Ignore corrupted prefs
      } finally {
        if (!cancelled) prefsHydratedRef.current = true;
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!prefsHydratedRef.current) return;
    const prefs: StoredPrefs = { activeFilter, needsAttentionActive };
    AsyncStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs)).catch(() => {});
  }, [activeFilter, needsAttentionActive]);
  const [viewMode, setViewMode] = useState<ViewMode>(
    user?.role === 'hoa_member' ? 'calendar' : 'list'
  );
  const { showToast, toastProps } = useToast();
  const [showCreateRequest, setShowCreateRequest] = useState(false);
  const [selectedDayStr, setSelectedDayStr] = useState<string | null>(null);

  const communityId = activeCommunity?.id;
  const canCreateRequest = user?.role === 'hoa_admin' || user?.role === 'hoa_member' || user?.role === 'property_manager';

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
    ? { all: 'All', overdue: 'Overdue', requests: 'My Requests', completed: 'Done' }
    : { all: 'All', overdue: 'Overdue', requests: 'Requests', completed: 'Completed' };

  const summaryCounts = useMemo(() => {
    if (!tasks) return { all: 0, overdue: 0, requests: 0, completed: 0 };
    const now = new Date();
    const overdue = tasks.filter(t =>
      t.status !== 'completed' && t.dueDate && new Date(t.dueDate) < now
    ).length;
    const requests = tasks.filter(t =>
      t.origin === 'HOA' && t.status !== 'completed'
    ).length;
    const completed = tasks.filter(t => t.status === 'completed').length;
    return { all: tasks.length, overdue, requests, completed };
  }, [tasks]);

  const agingRequestsCount = useMemo(() => {
    if (!tasks) return 0;
    return tasks.filter(t =>
      t.origin === 'HOA' &&
      t.status !== 'completed' &&
      isRequestAging(t.createdAt)
    ).length;
  }, [tasks]);

  const handleSummaryPress = useCallback((filter: SummaryFilterKey) => {
    setActiveFilter(filter);
  }, []);

  const handleNeedsAttentionToggle = useCallback(() => {
    setNeedsAttentionActive(prev => !prev);
  }, []);

  const filteredTasks = useMemo(() => {
    if (!tasks) return [];
    const now = new Date();

    let base: Task[];
    switch (activeFilter) {
      case 'overdue':
        base = tasks.filter(t => t.status !== 'completed' && t.dueDate && new Date(t.dueDate) < now);
        break;
      case 'requests':
        base = tasks.filter(t => t.origin === 'HOA' && t.status !== 'completed');
        break;
      case 'completed':
        base = tasks.filter(t => t.status === 'completed');
        break;
      default:
        base = tasks;
    }

    // Needs Attention is additive on top of the selected filter
    if (needsAttentionActive) {
      base = base.filter(t => {
        if (t.status === 'completed') return false;
        if (t.dueDate && new Date(t.dueDate) < now) return true;
        if (t.origin === 'HOA' && t.status === 'submitted') return true;
        if (t.origin === 'HOA' && isRequestAging(t.createdAt)) return true;
        return false;
      });
    }

    return base;
  }, [tasks, activeFilter, needsAttentionActive]);

  const sortedTasks = useMemo(() => sortTasks(filteredTasks), [filteredTasks]);

  const handleTaskPress = useCallback((taskId: string) => {
    router.push(`/task/${taskId}` as any);
  }, [router]);

  const handleDayPress = useCallback((dateStr: string) => {
    setSelectedDayStr(dateStr);
  }, []);

  const handleViewOnMap = useCallback((_task: Task) => {
    router.push(`/(hoa-tabs)/map` as any);
  }, [router]);

  const handleCreateRequestClose = useCallback(() => {
    setShowCreateRequest(false);
    queryClient.invalidateQueries({ queryKey: ['/api/hoa/requests'] });
    queryClient.invalidateQueries({ queryKey: ['/api/tasks', { communityId }] });
  }, [queryClient, communityId]);

  const handleViewAll = useCallback(() => {
    setActiveFilter('all');
    setNeedsAttentionActive(false);
  }, []);

  const handleViewRequests = useCallback(() => {
    setActiveFilter('requests');
    setNeedsAttentionActive(false);
  }, []);

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
          onStatPress={handleSummaryPress}
          activeSummaryFilter={activeFilter}
          requestsWarning={agingRequestsCount > 0}
        />
      </NavyHeader>

      {/* Needs Attention chip — list view only (additive on top of stat-card filter) */}
      {viewMode === 'list' && (
        <View style={styles.chipRow}>
          <TouchableOpacity
            style={[styles.attentionChip, needsAttentionActive && styles.attentionChipActive]}
            onPress={handleNeedsAttentionToggle}
            activeOpacity={0.75}
            testID="needs-attention-chip"
          >
            <Ionicons
              name="alert-circle"
              size={14}
              color={needsAttentionActive ? '#fff' : '#E53935'}
            />
            <Text style={[styles.attentionChipText, needsAttentionActive && styles.attentionChipTextActive]}>
              Needs Attention
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {viewMode === 'calendar' && activeFilter !== 'all' && (
        <View style={styles.chipRow}>
          <TouchableOpacity
            style={styles.filterChip}
            onPress={() => setActiveFilter('all')}
            activeOpacity={0.75}
            testID="calendar-active-filter-chip"
          >
            <Ionicons name="funnel" size={12} color="#1565C0" />
            <Text style={styles.filterChipText}>
              Filtered: {summaryLabels[activeFilter]}
            </Text>
            <Ionicons name="close" size={14} color="#1565C0" />
          </TouchableOpacity>
        </View>
      )}

      {viewMode === 'calendar' ? (
        <CalendarView
          tasks={tasks ?? []}
          schedules={[]}
          visits={[]}
          pendingVisits={[]}
          onTaskPress={handleTaskPress}
          onLogVisit={() => {}}
          onDayPress={handleDayPress}
          isOffline={false}
          role={user?.role}
          scope="month"
          activeFilter={activeFilter}
        />
      ) : isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#25C1AC" />
        </View>
      ) : sortedTasks.length === 0 ? (
        <EmptyState
          filter={activeFilter}
          needsAttention={needsAttentionActive}
          canCreateRequest={!!canCreateRequest}
          isHoaMember={user?.role === 'hoa_member'}
          onCreateRequest={() => setShowCreateRequest(true)}
          onViewAll={handleViewAll}
          onViewRequests={handleViewRequests}
        />
      ) : (
        <FlatList
          data={sortedTasks}
          keyExtractor={(item) => item.id}
          extraData={tick}
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
        onSuccess={() => showToast('Request submitted successfully')}
      />

      <DayWorkSheet
        visible={selectedDayStr !== null}
        dateStr={selectedDayStr}
        tasks={tasks ?? []}
        onClose={() => setSelectedDayStr(null)}
        onTaskPress={handleTaskPress}
        onViewOnMap={handleViewOnMap}
        role={user?.role}
      />
      <Toast {...toastProps} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  chipRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 2,
    gap: 8,
  },
  attentionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: '#FFF0F0',
    borderWidth: 1,
    borderColor: '#FFCDD2',
  },
  attentionChipActive: {
    backgroundColor: '#E53935',
    borderColor: '#E53935',
  },
  attentionChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#E53935',
  },
  attentionChipTextActive: {
    color: '#fff',
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: '#E3F2FD',
    borderWidth: 1,
    borderColor: '#BBDEFB',
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1565C0',
  },

  listContent: { paddingHorizontal: 16, paddingTop: 8 },

  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 9,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },

  cardRow1: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 6,
  },
  cardTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: '#0C1D31',
    lineHeight: 21,
  },
  statusChip: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 20,
    flexShrink: 0,
  },
  statusChipText: {
    fontSize: 11,
    fontWeight: '700',
  },

  cardRow2: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 6,
    flexWrap: 'wrap',
  },
  typeBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 5,
    flexShrink: 0,
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
  cardDescription: {
    flex: 1,
    fontSize: 13,
    color: '#666',
    lineHeight: 18,
  },

  cardMeta: {
    gap: 3,
    marginTop: 2,
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
  agingText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#E65100',
    backgroundColor: '#FFF3E0',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },

  mapAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 8,
    paddingTop: 8,
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
    paddingBottom: 40,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#333',
    marginTop: 12,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#999',
    marginTop: 5,
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyCreateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 18,
    backgroundColor: '#25C1AC',
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 25,
  },
  emptyCreateText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  emptyActionBtn: {
    marginTop: 18,
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 25,
    borderWidth: 1.5,
    borderColor: '#25C1AC',
  },
  emptyActionText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#25C1AC',
  },
});
