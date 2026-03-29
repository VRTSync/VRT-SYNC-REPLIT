import React from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl, Alert,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import StatusBarFill from '@/components/StatusBarFill';
import NavyHeader, { subtitleStyles as ss } from '@/components/NavyHeader';
import { useNavyHeaderProps } from '@/components/useNavyHeaderProps';
import SearchModal from '@/components/SearchModal';
import CalendarView from '@/components/CalendarView';
import LogVisitModal from '@/components/LogVisitModal';
import SyncBar from '@/components/SyncBar';
import { apiRequest, getQueryFn } from '@/lib/query-client';
import { useCommunity } from '@/client/contexts/CommunityContext';
import { useAuth } from '@/client/contexts/AuthContext';
import { useOffline, ServiceSchedule } from '@/client/contexts/OfflineContext';

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: 'pending' | 'in_progress' | 'completed' | 'submitted' | 'acknowledged';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  address: string | null;
  assignedTo: string | null;
  dueDate: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  version: number;
  createdAt: string;
  origin?: string | null;
};

const priorityColors: Record<string, string> = {
  low: '#4caf50',
  medium: '#ff9800',
  high: '#f44336',
  urgent: '#9c27b0',
};

const statusLabels: Record<string, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
  submitted: 'Submitted',
  acknowledged: 'Acknowledged',
};

const statusColors: Record<string, string> = {
  pending: '#ff9800',
  in_progress: '#25C1AC',
  completed: '#4caf50',
  submitted: '#e65100',
  acknowledged: '#1565c0',
};

function getTodayDenver(): Date {
  const now = new Date();
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: 'America/Denver' });
  return new Date(todayStr + 'T00:00:00');
}

function toDateOnly(s: string): Date {
  const d = s.includes('T') ? s.split('T')[0] : s;
  return new Date(d + 'T00:00:00');
}

function diffDays(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

type WindowGroup = 'overdue' | 'active_window' | 'upcoming' | 'no_window';
type FilterMode = 'tasks' | 'requests' | 'completed';
type ViewMode = 'list' | 'calendar';

function classifyTask(task: Task, today: Date): WindowGroup {
  if (task.status === 'completed') return 'no_window';
  if (!task.windowStart || !task.windowEnd) return 'no_window';
  const start = toDateOnly(task.windowStart);
  const end = toDateOnly(task.windowEnd);
  if (today > end) return 'overdue';
  if (today >= start && today <= end) return 'active_window';
  return 'upcoming';
}

function getUrgencyChip(task: Task, today: Date): { label: string; color: string; bg: string } | null {
  if (task.status === 'completed' || !task.windowStart || !task.windowEnd) return null;
  const start = toDateOnly(task.windowStart);
  const end = toDateOnly(task.windowEnd);
  if (today > end) {
    const overdueDays = diffDays(today, end);
    return { label: `Overdue ${overdueDays}d`, color: '#c62828', bg: '#ffebee' };
  }
  if (today >= start && today <= end) {
    const remaining = diffDays(end, today);
    if (remaining <= 2) return { label: `${remaining}d left`, color: '#e65100', bg: '#fff3e0' };
    return { label: `${remaining}d left`, color: '#2e7d32', bg: '#e8f5e9' };
  }
  const startsIn = diffDays(start, today);
  return { label: `Starts in ${startsIn}d`, color: '#1565c0', bg: '#e3f2fd' };
}

function formatWindowRange(task: Task): string | null {
  if (!task.windowStart || !task.windowEnd) return null;
  const s = toDateOnly(task.windowStart);
  const e = toDateOnly(task.windowEnd);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${s.toLocaleDateString('en-US', opts)} – ${e.toLocaleDateString('en-US', opts)}`;
}

const GROUP_ORDER: WindowGroup[] = ['overdue', 'active_window', 'upcoming', 'no_window'];
const GROUP_LABELS: Record<WindowGroup, string> = {
  overdue: 'Overdue',
  active_window: 'Active Window',
  upcoming: 'Upcoming',
  no_window: 'Other Tasks',
};

export default function TasksScreen() {
  const router = useRouter();
  const { activeCommunity } = useCommunity();
  const { user } = useAuth();
  const navyHeaderProps = useNavyHeaderProps();
  const {
    isOnline, cachedTasks, cacheTasks, pendingCompletions, syncPendingCompletions,
    cachedServiceSchedules, cachedServiceVisits, pendingServiceVisits,
    cacheServiceSchedules, cacheServiceVisits, addPendingServiceVisit,
    syncPendingServiceVisits,
  } = useOffline();
  const [syncing, setSyncing] = React.useState(false);
  const [lastSyncedAt, setLastSyncedAt] = React.useState<Date | null>(null);
  const [searchVisible, setSearchVisible] = React.useState(false);
  const { filter: filterParam } = useLocalSearchParams<{ filter?: string }>();
  const [filterMode, setFilterMode] = React.useState<FilterMode>(
    filterParam === 'requests' || filterParam === 'completed' ? filterParam : 'tasks'
  );
  React.useEffect(() => {
    if (filterParam === 'requests' || filterParam === 'completed') {
      setFilterMode(filterParam);
    }
  }, [filterParam]);
  const [viewMode, setViewMode] = React.useState<ViewMode>('list');
  const [logVisitSchedule, setLogVisitSchedule] = React.useState<ServiceSchedule | null>(null);
  const [logVisitDate, setLogVisitDate] = React.useState<string | undefined>(undefined);
  const [acknowledgingId, setAcknowledgingId] = React.useState<string | null>(null);
  const qc = useQueryClient();

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      const syncResult = await syncPendingCompletions();
      const fetchResult = await refetch();
      if (fetchResult.error) throw fetchResult.error;
      if (syncResult.failed > 0) {
        throw new Error(`${syncResult.failed} task(s) failed to upload`);
      }
      setLastSyncedAt(new Date());
    } finally {
      setSyncing(false);
    }
  };

  const communityId = activeCommunity?.id;
  const { data: serverTasks, isLoading, refetch, dataUpdatedAt } = useQuery<Task[]>({
    queryKey: ['/api/tasks', { communityId }],
    queryFn: async () => {
      const route = communityId ? `/api/tasks?communityId=${communityId}` : '/api/tasks';
      const res = await apiRequest('GET', route);
      return res.json();
    },
    enabled: !!activeCommunity && isOnline,
  });

  React.useEffect(() => {
    if (dataUpdatedAt > 0) {
      setLastSyncedAt(prev => {
        const queryDate = new Date(dataUpdatedAt);
        if (!prev || queryDate > prev) return queryDate;
        return prev;
      });
    }
  }, [dataUpdatedAt]);

  const { data: schedules, refetch: refetchSchedules } = useQuery({
    queryKey: ['service-schedules', communityId],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/communities/${communityId}/service-schedules`);
      const data = await res.json();
      if (communityId) cacheServiceSchedules(communityId, data);
      return data as ServiceSchedule[];
    },
    enabled: !!communityId && isOnline,
  });

  const { data: recentVisits, refetch: refetchVisits } = useQuery({
    queryKey: ['service-visits', communityId],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0];
      const monthAgo = new Date(Date.now() - 60 * 86400000).toISOString().split('T')[0];
      const res = await apiRequest('GET', `/api/communities/${communityId}/service-visits?from=${monthAgo}&to=${today}`);
      const data = await res.json();
      if (communityId) cacheServiceVisits(communityId, data);
      return data;
    },
    enabled: !!communityId && isOnline,
  });

  React.useEffect(() => {
    if (serverTasks && serverTasks.length > 0) {
      cacheTasks(serverTasks);
      serverTasks.forEach(task => {
        qc.setQueryData([`/api/tasks/${task.id}/detail`], { task, completions: [], taskAttachments: [] });
      });
    }
  }, [serverTasks]);

  const tasks: Task[] = serverTasks || (isOnline ? [] : cachedTasks);
  const displaySchedules = schedules || cachedServiceSchedules;
  const displayVisits = recentVisits || cachedServiceVisits;
  const today = getTodayDenver();

  const activeTasks = tasks.filter((t) => t.status !== 'completed');
  const completedTasks = tasks.filter((t) => t.status === 'completed');
  const contractTasks = activeTasks.filter(t => t.origin !== 'HOA');
  const requestTasks = activeTasks.filter(t => t.origin === 'HOA');

  const handleLogVisit = async (data: any) => {
    if (isOnline) {
      try {
        await apiRequest('POST', `/api/service-schedules/${data.scheduleId}/log`, {
          serviceDate: data.serviceDate,
          employeeSignOffName: data.employeeSignOffName,
          notes: data.notes,
          completedAt: data.completedAt,
        });
        refetchVisits();
        refetchSchedules();
      } catch (e: any) {
        await addPendingServiceVisit(data);
        Alert.alert('Queued Offline', 'Visit logged offline and will sync when connected.');
      }
    } else {
      await addPendingServiceVisit(data);
      Alert.alert('Queued Offline', 'Visit logged offline and will sync when connected.');
    }
  };

  const handleAcknowledge = async (task: Task) => {
    setAcknowledgingId(task.id);
    try {
      await apiRequest('PUT', `/api/tasks/${task.id}`, {
        status: 'acknowledged',
        version: task.version,
      });
      qc.invalidateQueries({ queryKey: ['/api/tasks'] });
      refetch();
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to acknowledge request');
    } finally {
      setAcknowledgingId(null);
    }
  };

  const buildGroupedList = (): (Task | { type: 'header'; title: string; count: number })[] => {
    if (filterMode === 'completed') {
      const completedContract = completedTasks.filter(t => t.origin !== 'HOA');
      const completedRequests = completedTasks.filter(t => t.origin === 'HOA');
      const items: (Task | { type: 'header'; title: string; count: number })[] = [];
      if (completedContract.length > 0) {
        items.push({ type: 'header', title: 'Completed Tasks', count: completedContract.length } as any);
        items.push(...completedContract);
      }
      if (completedRequests.length > 0) {
        items.push({ type: 'header', title: 'Completed Requests', count: completedRequests.length } as any);
        items.push(...completedRequests);
      }
      return items;
    }

    if (filterMode === 'requests') {
      const urgentReqs = requestTasks
        .filter(t => t.priority === 'urgent')
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      const normalReqs = requestTasks
        .filter(t => t.priority !== 'urgent')
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      const items: (Task | { type: 'header'; title: string; count: number })[] = [];
      if (urgentReqs.length > 0) {
        items.push({ type: 'header', title: 'Urgent Requests', count: urgentReqs.length } as any);
        items.push(...urgentReqs);
      }
      if (normalReqs.length > 0) {
        items.push({ type: 'header', title: 'HOA Requests', count: normalReqs.length } as any);
        items.push(...normalReqs);
      }
      return items;
    }

    const groups: Record<WindowGroup, Task[]> = {
      overdue: [],
      active_window: [],
      upcoming: [],
      no_window: [],
    };
    for (const t of contractTasks) {
      const group = classifyTask(t, today);
      groups[group].push(t);
    }

    groups.overdue.sort((a, b) => {
      const endA = a.windowEnd ? toDateOnly(a.windowEnd).getTime() : 0;
      const endB = b.windowEnd ? toDateOnly(b.windowEnd).getTime() : 0;
      return endA - endB;
    });
    groups.active_window.sort((a, b) => {
      const endA = a.windowEnd ? toDateOnly(a.windowEnd).getTime() : 0;
      const endB = b.windowEnd ? toDateOnly(b.windowEnd).getTime() : 0;
      return endA - endB;
    });
    groups.upcoming.sort((a, b) => {
      const startA = a.windowStart ? toDateOnly(a.windowStart).getTime() : 0;
      const startB = b.windowStart ? toDateOnly(b.windowStart).getTime() : 0;
      return startA - startB;
    });

    const items: (Task | { type: 'header'; title: string; count: number })[] = [];
    for (const group of GROUP_ORDER) {
      if (groups[group].length > 0) {
        items.push({ type: 'header', title: GROUP_LABELS[group], count: groups[group].length } as any);
        items.push(...groups[group]);
      }
    }
    return items;
  };

  const allItems = buildGroupedList();

  const renderTask = ({ item }: { item: Task }) => {
    const pending = pendingCompletions.find(c => c.taskId === item.id && c.state !== 'synced');
    const urgency = getUrgencyChip(item, today);
    const windowRange = formatWindowRange(item);
    const isHoa = item.origin === 'HOA';

    const isCompleted = item.status === 'completed';

    return (
      <TouchableOpacity
        style={[styles.taskCard, isHoa && styles.hoaTaskCard, isCompleted && styles.completedCard]}
        onPress={() => router.push(`/task/${item.id}`)}
        activeOpacity={0.7}
        testID={`task-${item.id}`}
      >
        <View style={styles.taskHeader}>
          <View style={[styles.priorityDot, { backgroundColor: priorityColors[item.priority] }]} />
          <Text style={[styles.taskTitle, isCompleted && styles.completedTitle]} numberOfLines={1}>{item.title}</Text>
          {isHoa ? (
            <View style={styles.hoaBadge}>
              <Text style={styles.hoaBadgeText}>HOA REQUEST</Text>
            </View>
          ) : null}
          {pending ? (
            <View style={[styles.statusBadge, {
              backgroundColor: pending.state === 'failed' ? '#ffebee' : '#fff3e0',
            }]}>
              <Text style={[styles.statusText, {
                color: pending.state === 'failed' ? '#c62828' : '#e65100',
              }]}>
                {pending.state === 'failed' ? 'Sync Error' : pending.state === 'syncing' ? 'Syncing' : 'Queued'}
              </Text>
            </View>
          ) : urgency ? (
            <View style={[styles.statusBadge, { backgroundColor: urgency.bg }]}>
              <Text style={[styles.statusText, { color: urgency.color }]}>{urgency.label}</Text>
            </View>
          ) : !isCompleted ? (
            <View style={[styles.statusBadge, { backgroundColor: statusColors[item.status] + '20' }]}>
              <Text style={[styles.statusText, { color: statusColors[item.status] }]}>
                {statusLabels[item.status]}
              </Text>
            </View>
          ) : null}
        </View>
        {isHoa ? (
          <View style={styles.hoaMetaRow}>
            <View style={[styles.hoaPriorityChip, item.priority === 'urgent' && styles.hoaPriorityUrgent]}>
              <Text style={[styles.hoaPriorityText, item.priority === 'urgent' && styles.hoaPriorityUrgentText]}>
                {item.priority === 'urgent' ? 'Urgent' : 'Normal'}
              </Text>
            </View>
            <View style={[styles.hoaStatusChip, { backgroundColor: statusColors[item.status] + '20' }]}>
              <Text style={[styles.hoaStatusText, { color: statusColors[item.status] }]}>
                {statusLabels[item.status]}
              </Text>
            </View>
          </View>
        ) : null}
        {item.description ? (
          <Text style={styles.taskDescription} numberOfLines={2}>{item.description}</Text>
        ) : null}
        <View style={styles.taskFooter}>
          {windowRange ? (
            <View style={styles.taskMeta}>
              <Ionicons name="time-outline" size={12} color="#999" />
              <Text style={styles.metaText}>{windowRange}</Text>
            </View>
          ) : null}
          {item.address ? (
            <View style={styles.taskMeta}>
              <Ionicons name="location-outline" size={12} color="#999" />
              <Text style={styles.metaText} numberOfLines={1}>{item.address}</Text>
            </View>
          ) : null}
          {!windowRange && item.dueDate ? (
            <View style={styles.taskMeta}>
              <Ionicons name="calendar-outline" size={12} color="#999" />
              <Text style={styles.metaText}>
                {new Date(item.dueDate).toLocaleDateString()}
              </Text>
            </View>
          ) : null}
          {isHoa && item.status === 'submitted' ? (
            <TouchableOpacity
              style={styles.acknowledgeButton}
              onPress={(e) => {
                e.stopPropagation();
                handleAcknowledge(item);
              }}
              disabled={acknowledgingId === item.id}
              activeOpacity={0.7}
            >
              <Ionicons name="checkmark-circle-outline" size={16} color="#fff" />
              <Text style={styles.acknowledgeButtonText}>
                {acknowledgingId === item.id ? 'Acknowledging...' : 'Acknowledge'}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBarFill />
      <NavyHeader {...navyHeaderProps}>
        <View style={ss.subtitleRow}>
          <Text style={ss.subtitleText}>TASKS</Text>
          <View style={ss.subtitleActions}>
            <TouchableOpacity
              onPress={() => setViewMode(viewMode === 'list' ? 'calendar' : 'list')}
              style={[ss.headerIconBtn, viewMode === 'calendar' && ss.headerIconBtnActive]}
              testID="view-toggle"
            >
              <Ionicons
                name={viewMode === 'list' ? 'calendar-outline' : 'list-outline'}
                size={20}
                color={viewMode === 'calendar' ? '#fff' : '#555'}
              />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setSearchVisible(true)}
              style={ss.headerIconBtn}
              testID="search-button"
            >
              <Ionicons name="search" size={20} color="#555" />
            </TouchableOpacity>
          </View>
        </View>
      </NavyHeader>

      {viewMode === 'list' && (
        <SyncBar
          onSync={handleSyncNow}
          isSyncing={syncing}
          lastSyncedAt={lastSyncedAt}
        />
      )}

      {viewMode === 'list' && (
        <View style={styles.filterRow}>
          <TouchableOpacity
            style={[styles.filterTab, filterMode === 'tasks' && styles.filterTabActive]}
            onPress={() => setFilterMode('tasks')}
            testID="filter-tasks"
          >
            <Text style={[styles.filterTabText, filterMode === 'tasks' && styles.filterTabTextActive]}>
              Contract
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterTab, filterMode === 'requests' && styles.filterTabActive]}
            onPress={() => setFilterMode('requests')}
            testID="filter-requests"
          >
            <Text style={[styles.filterTabText, filterMode === 'requests' && styles.filterTabTextActive]}>
              Requests
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterTab, filterMode === 'completed' && styles.filterTabActive]}
            onPress={() => setFilterMode('completed')}
            testID="filter-completed"
          >
            <Text style={[styles.filterTabText, filterMode === 'completed' && styles.filterTabTextActive]}>
              Completed
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <SearchModal
        visible={searchVisible}
        onClose={() => setSearchVisible(false)}
        onSelectTask={(result) => router.push(`/task/${result.id}`)}
        onSelectAsset={(result) => router.push(`/asset/${result.id}` as any)}
        onShowOnMap={(result) => {
          if (result.latitude && result.longitude) {
            router.push({ pathname: '/(tabs)/map', params: { targetLat: String(result.latitude), targetLng: String(result.longitude), targetLabel: result.label } } as any);
          } else {
            Alert.alert('No Location', 'This item does not have map coordinates.');
          }
        }}
      />

      {viewMode === 'calendar' ? (
        <CalendarView
          tasks={tasks}
          schedules={displaySchedules || []}
          visits={displayVisits || []}
          pendingVisits={pendingServiceVisits}
          onTaskPress={(taskId) => router.push(`/task/${taskId}`)}
          onLogVisit={(schedule, dateStr) => {
            setLogVisitSchedule(schedule);
            setLogVisitDate(dateStr);
          }}
          isOffline={!isOnline}
        />
      ) : allItems.length === 0 && !isLoading ? (
        <View style={styles.emptyState}>
          <Ionicons name="clipboard-outline" size={48} color="#ccc" />
          <Text style={styles.emptyTitle}>
            {filterMode === 'completed' ? 'No Completed Tasks'
              : filterMode === 'requests' ? 'No Requests'
              : 'No Contract Tasks'}
          </Text>
          <Text style={styles.emptySubtitle}>
            {filterMode === 'completed'
              ? 'Completed tasks will appear here'
              : filterMode === 'requests'
                ? 'HOA requests will appear here'
                : user?.role === 'admin'
                  ? 'Create a task to get started'
                  : 'No tasks assigned to you yet'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={allItems}
          keyExtractor={(item: any) => item.type === 'header' ? `header-${item.title}` : item.id}
          renderItem={({ item }: any) => {
            if (item.type === 'header') {
              return (
                <View style={styles.sectionHeaderRow}>
                  <Text style={[
                    styles.sectionHeader,
                    item.title === 'Overdue' && styles.sectionHeaderOverdue,
                    item.title === 'Active Window' && styles.sectionHeaderActive,
                    item.title === 'Urgent Requests' && styles.sectionHeaderUrgent,
                    item.title === 'HOA Requests' && styles.sectionHeaderHoa,
                  ]}>
                    {item.title}
                  </Text>
                  <View style={styles.sectionCountBadge}>
                    <Text style={styles.sectionCountText}>{item.count}</Text>
                  </View>
                </View>
              );
            }
            return renderTask({ item });
          }}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={isLoading} onRefresh={refetch} />
          }
          scrollEnabled={!!allItems.length}
        />
      )}

      <LogVisitModal
        visible={!!logVisitSchedule}
        schedule={logVisitSchedule}
        onClose={() => { setLogVisitSchedule(null); setLogVisitDate(undefined); }}
        onSubmit={handleLogVisit}
        userName={user?.displayName || ''}
        prefillDate={logVisitDate}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa' },
  filterRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    backgroundColor: '#e8eaed',
    borderRadius: 10,
    padding: 3,
  },
  filterTab: {
    flex: 1,
    paddingVertical: 8,
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
  filterTabText: { fontSize: 13, fontWeight: '600', color: '#888' },
  filterTabTextActive: { color: '#0C1D31' },
  listContent: { paddingHorizontal: 16, paddingBottom: 100 },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '600',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionHeaderOverdue: { color: '#c62828' },
  sectionHeaderActive: { color: '#25C1AC' },
  sectionCountBadge: {
    backgroundColor: '#e8eaed',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  sectionCountText: { fontSize: 11, fontWeight: '700', color: '#666' },
  taskCard: {
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
  taskHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  priorityDot: { width: 8, height: 8, borderRadius: 4 },
  taskTitle: { flex: 1, fontSize: 16, fontWeight: '600', color: '#0C1D31' },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 11, fontWeight: '600' },
  taskDescription: { fontSize: 14, color: '#666', marginTop: 8, lineHeight: 20 },
  taskFooter: { flexDirection: 'row', gap: 16, marginTop: 12, flexWrap: 'wrap' },
  taskMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 12, color: '#999' },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#999' },
  emptySubtitle: { fontSize: 14, color: '#bbb', textAlign: 'center', paddingHorizontal: 40 },
  sectionHeaderUrgent: { color: '#c62828' },
  sectionHeaderHoa: { color: '#6a1b9a' },
  hoaTaskCard: {
    borderLeftWidth: 3,
    borderLeftColor: '#7c4dff',
  },
  hoaBadge: {
    backgroundColor: '#ede7f6',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  hoaBadgeText: {
    fontSize: 9,
    fontWeight: '700' as const,
    color: '#6a1b9a',
    letterSpacing: 0.5,
  },
  hoaMetaRow: {
    flexDirection: 'row' as const,
    gap: 8,
    marginTop: 6,
  },
  hoaPriorityChip: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: '#e8eaed',
  },
  hoaPriorityUrgent: {
    backgroundColor: '#ffebee',
  },
  hoaPriorityText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: '#666',
  },
  hoaPriorityUrgentText: {
    color: '#c62828',
  },
  hoaStatusChip: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  hoaStatusText: {
    fontSize: 11,
    fontWeight: '600' as const,
  },
  acknowledgeButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    backgroundColor: '#1565c0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginLeft: 'auto' as const,
  },
  acknowledgeButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600' as const,
  },
  completedCard: {
    backgroundColor: '#fff',
    borderLeftWidth: 4,
    borderLeftColor: '#4caf50',
    borderWidth: 1,
    borderColor: '#4caf50',
  },
  completedTitle: {
    color: '#2E7D32',
  },
});
