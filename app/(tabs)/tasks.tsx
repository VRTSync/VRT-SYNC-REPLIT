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
import TaskCard from '@/components/TaskCard';
import TaskSectionHeader from '@/components/TaskSectionHeader';
import { apiRequest } from '@/lib/query-client';
import { useCommunity } from '@/client/contexts/CommunityContext';
import { useAuth } from '@/client/contexts/AuthContext';
import { useOffline, ServiceSchedule } from '@/client/contexts/OfflineContext';
import { getTaskPageConfigForRole, FilterKey } from '@/constants/taskPageRoleConfig';
import type { SectionLabelOverrides } from '@/constants/taskPageRoleConfig';
import type { TaskCardItem } from '@/components/TaskCard';

type Task = TaskCardItem & {
  version: number;
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

type WindowGroup = 'overdue' | 'active_window' | 'upcoming' | 'no_window';
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

const GROUP_ORDER: WindowGroup[] = ['overdue', 'active_window', 'upcoming', 'no_window'];

function getSectionLabels(overrides: SectionLabelOverrides) {
  return {
    overdue: overrides.overdue ?? 'Overdue',
    active_window: overrides.active_window ?? 'Active Window',
    upcoming: overrides.upcoming ?? 'Upcoming',
    no_window: overrides.no_window ?? 'Other Tasks',
    completed_contract: overrides.completed_contract ?? 'Completed Tasks',
    completed_requests: overrides.completed_requests ?? 'Completed Requests',
    urgent_requests: overrides.urgent_requests ?? 'Urgent Requests',
    hoa_requests: overrides.hoa_requests ?? 'HOA Requests',
  };
}

export default function TasksScreen() {
  const router = useRouter();
  const { activeCommunity } = useCommunity();
  const { user } = useAuth();
  const navyHeaderProps = useNavyHeaderProps();
  const config = getTaskPageConfigForRole(user?.role);
  const sectionLabels = getSectionLabels(config.sectionLabelOverrides);
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

  const defaultFilterKey: FilterKey = config.availableFilters[0]?.key ?? 'tasks';
  const [filterMode, setFilterMode] = React.useState<FilterKey>(() => {
    if (filterParam && config.availableFilters.some(f => f.key === filterParam)) {
      return filterParam as FilterKey;
    }
    if (filterParam === 'requests' || filterParam === 'completed') return filterParam as FilterKey;
    return defaultFilterKey;
  });

  React.useEffect(() => {
    if (filterParam && config.availableFilters.some(f => f.key === filterParam)) {
      setFilterMode(filterParam as FilterKey);
    }
  }, [filterParam]);

  const [viewMode, setViewMode] = React.useState<ViewMode>(config.defaultView);
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
    try {
      await qc.invalidateQueries({ queryKey: ['/api/map-layers'] });
    } catch {}
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
        qc.setQueryData([`/api/tasks/${task.id}/detail`], { task, completions: [], taskAttachments: [], taskLink: null });
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
    const items: (Task | { type: 'header'; title: string; count: number })[] = [];

    if (filterMode === 'completed') {
      const completedContract = completedTasks.filter(t => t.origin !== 'HOA');
      const completedRequests = completedTasks.filter(t => t.origin === 'HOA');
      if (completedContract.length > 0) {
        items.push({ type: 'header', title: sectionLabels.completed_contract, count: completedContract.length } as any);
        items.push(...completedContract);
      }
      if (completedRequests.length > 0) {
        items.push({ type: 'header', title: sectionLabels.completed_requests, count: completedRequests.length } as any);
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
      if (urgentReqs.length > 0) {
        items.push({ type: 'header', title: sectionLabels.urgent_requests, count: urgentReqs.length } as any);
        items.push(...urgentReqs);
      }
      if (normalReqs.length > 0) {
        items.push({ type: 'header', title: sectionLabels.hoa_requests, count: normalReqs.length } as any);
        items.push(...normalReqs);
      }
      return items;
    }

    if (filterMode === 'active') {
      const groups: Record<WindowGroup, Task[]> = {
        overdue: [], active_window: [], upcoming: [], no_window: [],
      };
      for (const t of activeTasks) {
        groups[classifyTask(t, today)].push(t);
      }
      for (const group of GROUP_ORDER) {
        if (groups[group].length > 0) {
          items.push({ type: 'header', title: sectionLabels[group], count: groups[group].length } as any);
          items.push(...groups[group]);
        }
      }
      return items;
    }

    if (filterMode === 'all') {
      const allTasksSorted = [...tasks].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      for (const t of allTasksSorted) {
        items.push(t);
      }
      return items;
    }

    const sourceTasks = config.taskGrouping === 'window' ? contractTasks : activeTasks;

    if (config.taskGrouping === 'flat') {
      for (const t of sourceTasks) {
        items.push(t);
      }
      return items;
    }

    if (config.taskGrouping === 'priority') {
      const urgent = sourceTasks.filter(t => t.priority === 'urgent');
      const high = sourceTasks.filter(t => t.priority === 'high');
      const medium = sourceTasks.filter(t => t.priority === 'medium');
      const low = sourceTasks.filter(t => t.priority === 'low');
      if (urgent.length > 0) {
        items.push({ type: 'header', title: 'Urgent', count: urgent.length } as any);
        items.push(...urgent);
      }
      if (high.length > 0) {
        items.push({ type: 'header', title: 'High', count: high.length } as any);
        items.push(...high);
      }
      if (medium.length > 0) {
        items.push({ type: 'header', title: 'Medium', count: medium.length } as any);
        items.push(...medium);
      }
      if (low.length > 0) {
        items.push({ type: 'header', title: 'Low', count: low.length } as any);
        items.push(...low);
      }
      return items;
    }

    const groups: Record<WindowGroup, Task[]> = {
      overdue: [], active_window: [], upcoming: [], no_window: [],
    };
    for (const t of sourceTasks) {
      groups[classifyTask(t, today)].push(t);
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

    for (const group of GROUP_ORDER) {
      if (groups[group].length > 0) {
        items.push({ type: 'header', title: sectionLabels[group], count: groups[group].length } as any);
        items.push(...groups[group]);
      }
    }
    return items;
  };

  const allItems = buildGroupedList();

  const emptyMessages = config.emptyStateMessages[filterMode]
    ?? config.emptyStateMessages[defaultFilterKey]
    ?? { title: 'No Tasks', subtitle: 'Nothing to show' };

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

      {viewMode === 'list' && config.availableFilters.length > 1 && (
        <View style={styles.filterRow}>
          {config.availableFilters.map((f) => (
            <TouchableOpacity
              key={f.key}
              style={[styles.filterTab, filterMode === f.key && styles.filterTabActive]}
              onPress={() => setFilterMode(f.key)}
              testID={f.testID ?? `filter-${f.key}`}
            >
              <Text style={[styles.filterTabText, filterMode === f.key && styles.filterTabTextActive]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
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
          <Text style={styles.emptyTitle}>{emptyMessages.title}</Text>
          <Text style={styles.emptySubtitle}>{emptyMessages.subtitle}</Text>
        </View>
      ) : (
        <FlatList
          data={allItems}
          keyExtractor={(item: any) => item.type === 'header' ? `header-${item.title}` : item.id}
          renderItem={({ item }: any) => {
            if (item.type === 'header') {
              return (
                <TaskSectionHeader
                  title={item.title}
                  count={item.count}
                />
              );
            }
            const pending = pendingCompletions.find(c => c.taskId === item.id && c.state !== 'synced');
            return (
              <TaskCard
                item={item}
                cardVariant={config.cardVariant}
                visibleActions={config.cardActions}
                visibleMetadata={config.visibleMetadata}
                today={today}
                pendingCompletion={pending}
                acknowledgingId={acknowledgingId}
                onPress={() => router.push(`/task/${item.id}`)}
                onAcknowledge={config.showAcknowledgmentControls ? handleAcknowledge : undefined}
              />
            );
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
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#999' },
  emptySubtitle: { fontSize: 14, color: '#bbb', textAlign: 'center', paddingHorizontal: 40 },
});
