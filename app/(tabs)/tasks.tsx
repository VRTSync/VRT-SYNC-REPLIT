import React from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl, Alert, Linking, Platform,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import StatusBarFill from '@/components/StatusBarFill';
import NavyHeader, { subtitleStyles as ss } from '@/components/NavyHeader';
import { useNavyHeaderProps } from '@/components/useNavyHeaderProps';
import SearchModal from '@/components/SearchModal';
import CalendarView from '@/components/CalendarView';
import LogVisitModal from '@/components/LogVisitModal';
import Toast from '@/components/Toast';
import SyncBar from '@/components/SyncBar';
import TaskSectionHeader from '@/components/TaskSectionHeader';
import { apiRequest } from '@/lib/query-client';
import { useCommunity } from '@/client/contexts/CommunityContext';
import { useAuth } from '@/client/contexts/AuthContext';
import { useOffline, ServiceSchedule } from '@/client/contexts/OfflineContext';
import { useMapFilter } from '@/client/contexts/MapFilterContext';
import { getTaskPageConfigForRole } from '@/constants/taskPageRoleConfig';
import type { TaskCardItem } from '@/components/TaskCard';

type Task = TaskCardItem & {
  version: number;
  createdAt: string;
  origin?: string | null;
  latitude?: number | null;
  longitude?: number | null;
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

type SectionGroup = 'overdue' | 'active_window' | 'needs_acknowledgment' | 'upcoming' | 'completed';
type ViewMode = 'list' | 'calendar';
type ContractorViewMode = 'today' | 'calendar';

function classifyTask(task: Task, today: Date): SectionGroup {
  if (task.status === 'completed') return 'completed';
  if (task.status === 'submitted') return 'needs_acknowledgment';
  if (!task.windowStart || !task.windowEnd) return 'upcoming';
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

function isTaskToday(task: Task, today: Date): boolean {
  if (!task.windowStart || !task.windowEnd) return false;
  const start = toDateOnly(task.windowStart);
  const end = toDateOnly(task.windowEnd);
  return today >= start && today <= end;
}

const SECTION_ORDER: SectionGroup[] = ['overdue', 'active_window', 'needs_acknowledgment', 'upcoming', 'completed'];
const SECTION_LABELS: Record<SectionGroup, string> = {
  overdue: 'Overdue',
  active_window: 'Active Window',
  needs_acknowledgment: 'Needs Acknowledgment',
  upcoming: 'Upcoming',
  completed: 'Completed',
};

type ListItem = Task | { type: 'header'; title: string; count: number; group: SectionGroup } | { type: 'collapsed_completed'; count: number };

type TodayStatusGroup = 'pending' | 'in_progress' | 'done';
type TodayListItem = Task | { type: 'today_header'; title: string; count: number; group: TodayStatusGroup } | { type: 'upcoming_header'; count: number };

const TODAY_STATUS_ORDER: TodayStatusGroup[] = ['pending', 'in_progress', 'done'];
const TODAY_STATUS_LABELS: Record<TodayStatusGroup, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  done: 'Done',
};

function classifyTodayTask(task: Task): TodayStatusGroup {
  if (task.status === 'completed' || task.status === 'submitted' || task.status === 'acknowledged') return 'done';
  if (task.status === 'in_progress') return 'in_progress';
  return 'pending';
}

export default function TasksScreen() {
  const router = useRouter();
  const { activeCommunity } = useCommunity();
  const { user } = useAuth();
  const navyHeaderProps = useNavyHeaderProps();
  const config = getTaskPageConfigForRole(user?.role);
  const isContractor = user?.role === 'contractor';
  const { setMapFilter } = useMapFilter();
  const {
    isOnline, cachedTasks, cacheTasks, pendingCompletions, syncPendingCompletions,
    cachedServiceSchedules, cachedServiceVisits, pendingServiceVisits,
    cacheServiceSchedules, cacheServiceVisits, addPendingServiceVisit,
    syncPendingServiceVisits,
  } = useOffline();
  const [syncing, setSyncing] = React.useState(false);
  const [lastSyncedAt, setLastSyncedAt] = React.useState<Date | null>(null);
  const [searchVisible, setSearchVisible] = React.useState(false);
  const [viewMode, setViewMode] = React.useState<ViewMode>('list');
  const [contractorViewMode, setContractorViewMode] = React.useState<ContractorViewMode>('today');
  const [logVisitSchedule, setLogVisitSchedule] = React.useState<ServiceSchedule | null>(null);
  const [logVisitDate, setLogVisitDate] = React.useState<string | undefined>(undefined);
  const [toastVisible, setToastVisible] = React.useState(false);
  const [toastMessage, setToastMessage] = React.useState('');
  const [toastKey, setToastKey] = React.useState(0);
  const toastTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); };
  }, []);

  const showToast = (message: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(message);
    setToastVisible(true);
    setToastKey(k => k + 1);
    toastTimerRef.current = setTimeout(() => setToastVisible(false), 2700);
  };

  const [acknowledgingId, setAcknowledgingId] = React.useState<string | null>(null);
  const [markingInProgressId, setMarkingInProgressId] = React.useState<string | null>(null);
  const [completedExpanded, setCompletedExpanded] = React.useState(false);
  const [startingWork, setStartingWork] = React.useState(false);
  const [undoStartEarly, setUndoStartEarly] = React.useState<{ taskId: string; taskVersion: number } | null>(null);
  const undoTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const todayFlatListRef = React.useRef<FlatList<any>>(null);
  const qc = useQueryClient();

  React.useEffect(() => {
    return () => {
      if (undoTimerRef.current) {
        clearTimeout(undoTimerRef.current);
      }
    };
  }, []);

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
    enabled: isOnline,
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

  const handleMarkInProgress = async (task: Task) => {
    setMarkingInProgressId(task.id);
    try {
      await apiRequest('PUT', `/api/tasks/${task.id}`, {
        status: 'in_progress',
        version: task.version,
      });
      qc.invalidateQueries({ queryKey: ['/api/tasks'] });
      refetch();
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to update task status');
    } finally {
      setMarkingInProgressId(null);
    }
  };

  const handleStartEarly = async (task: Task) => {
    setMarkingInProgressId(task.id);
    try {
      await apiRequest('PUT', `/api/tasks/${task.id}`, {
        status: 'in_progress',
        version: task.version,
      });
      qc.invalidateQueries({ queryKey: ['/api/tasks'] });
      const fetchResult = await refetch();
      const freshTasks: Task[] = fetchResult.data || [];
      const updatedTask = freshTasks.find(t => t.id === task.id);
      const updatedVersion = updatedTask?.version ?? task.version + 1;
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      setUndoStartEarly({ taskId: task.id, taskVersion: updatedVersion });
      undoTimerRef.current = setTimeout(() => {
        setUndoStartEarly(null);
        undoTimerRef.current = null;
      }, 5000);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to update task status');
    } finally {
      setMarkingInProgressId(null);
    }
  };

  const handleUndoStartEarly = async () => {
    if (!undoStartEarly) return;
    const { taskId, taskVersion } = undoStartEarly;
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    setUndoStartEarly(null);
    try {
      await apiRequest('PUT', `/api/tasks/${taskId}`, {
        status: 'pending',
        version: taskVersion,
      });
      qc.invalidateQueries({ queryKey: ['/api/tasks'] });
      await refetch();
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to undo start early');
    }
  };

  const handleViewOnMap = (task: Task) => {
    const isHoa = task.origin === 'HOA';
    if (isHoa && task.latitude != null && task.longitude != null) {
      router.push(`/request-map/${task.id}` as any);
    } else if (task.address) {
      const addr = encodeURIComponent(task.address);
      if (Platform.OS === 'ios') {
        Linking.openURL(`maps://?q=${addr}`);
      } else {
        Linking.openURL(`https://maps.google.com/?q=${addr}`);
      }
    }
  };

  const handleViewTaskOnMap = (task: Task) => {
    setMapFilter({ type: 'task', taskId: task.id, label: task.title });
    router.push('/(tabs)/map' as any);
  };

  const handleViewDayOnMap = (taskIds: string[], label: string) => {
    setMapFilter({ type: 'task', taskId: taskIds.join(','), label });
    router.push('/(tabs)/map' as any);
  };

  const buildGroupedList = (): (Task | { type: 'header'; title: string; count: number; group: SectionGroup } | { type: 'collapsed_completed'; count: number })[] => {
    const groups: Record<SectionGroup, Task[]> = {
      overdue: [],
      active_window: [],
      needs_acknowledgment: [],
      upcoming: [],
      completed: [],
    };

    for (const t of tasks) {
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
    groups.needs_acknowledgment.sort((a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    groups.upcoming.sort((a, b) => {
      const startA = a.windowStart ? toDateOnly(a.windowStart).getTime() : 0;
      const startB = b.windowStart ? toDateOnly(b.windowStart).getTime() : 0;
      return startA - startB;
    });
    groups.completed.sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const items: (Task | { type: 'header'; title: string; count: number; group: SectionGroup } | { type: 'collapsed_completed'; count: number })[] = [];
    for (const group of SECTION_ORDER) {
      if (groups[group].length === 0) continue;
      if (group === 'completed') {
        items.push({ type: 'header', title: SECTION_LABELS[group], count: groups[group].length, group } as any);
        if (completedExpanded) {
          items.push(...groups[group]);
        } else {
          items.push({ type: 'collapsed_completed', count: groups[group].length } as any);
        }
      } else {
        items.push({ type: 'header', title: SECTION_LABELS[group], count: groups[group].length, group } as any);
        items.push(...groups[group]);
      }
    }
    return items;
  };

  const buildTodayList = (): TodayListItem[] => {
    const todayTasks = tasks.filter(t => isTaskToday(t, today));
    const groups: Record<TodayStatusGroup, Task[]> = {
      pending: [],
      in_progress: [],
      done: [],
    };
    for (const t of todayTasks) {
      groups[classifyTodayTask(t)].push(t);
    }
    const items: TodayListItem[] = [];
    for (const group of TODAY_STATUS_ORDER) {
      if (groups[group].length === 0) continue;
      items.push({ type: 'today_header', title: TODAY_STATUS_LABELS[group], count: groups[group].length, group });
      items.push(...groups[group]);
    }
    const upcomingTasks = tasks
      .filter(t => t.status !== 'completed' && t.status !== 'submitted' && t.windowStart && toDateOnly(t.windowStart) > today)
      .sort((a, b) => toDateOnly(a.windowStart!).getTime() - toDateOnly(b.windowStart!).getTime());
    if (upcomingTasks.length > 0) {
      items.push({ type: 'upcoming_header', count: upcomingTasks.length });
      items.push(...upcomingTasks);
    }
    return items;
  };

  const todayItems = buildTodayList();
  const todayTasks = tasks.filter(t => isTaskToday(t, today));
  const firstPendingTodayTask = todayTasks.find(t => t.status === 'pending');
  const hasPendingToday = !!firstPendingTodayTask;

  const handleStartWork = async () => {
    if (!firstPendingTodayTask) {
      Alert.alert('No Pending Tasks', 'All of today\'s tasks are already in progress or done.');
      return;
    }
    setStartingWork(true);
    try {
      await apiRequest('PUT', `/api/tasks/${firstPendingTodayTask.id}`, {
        status: 'in_progress',
        version: firstPendingTodayTask.version,
      });
      qc.invalidateQueries({ queryKey: ['/api/tasks', { communityId }] });
      const fetchResult = await refetch();
      const freshTasks: Task[] = fetchResult.data || tasks;
      const freshTodayTasks = freshTasks.filter(t => isTaskToday(t, today));
      const freshGroups: Record<TodayStatusGroup, Task[]> = { pending: [], in_progress: [], done: [] };
      for (const t of freshTodayTasks) {
        freshGroups[classifyTodayTask(t)].push(t);
      }
      const freshItems: TodayListItem[] = [];
      for (const group of TODAY_STATUS_ORDER) {
        if (freshGroups[group].length === 0) continue;
        freshItems.push({ type: 'today_header', title: TODAY_STATUS_LABELS[group], count: freshGroups[group].length, group });
        freshItems.push(...freshGroups[group]);
      }
      const idx = freshItems.findIndex((item: any) => item.id === firstPendingTodayTask.id);
      if (idx !== -1 && todayFlatListRef.current) {
        todayFlatListRef.current.scrollToIndex({ index: idx, animated: true, viewPosition: 0.2 });
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to start work');
    } finally {
      setStartingWork(false);
    }
  };

  const allItems = buildGroupedList();

  const renderTask = ({ item, startEarly }: { item: Task; startEarly?: boolean }) => {
    const pending = pendingCompletions.find(c => c.taskId === item.id && c.state !== 'synced');
    const urgency = getUrgencyChip(item, today);
    const windowRange = formatWindowRange(item);
    const isHoa = item.origin === 'HOA';
    const isCompleted = item.status === 'completed';
    const hasMapPin = item.latitude != null && item.longitude != null;

    const showAcknowledge = item.status === 'submitted' && config.showAcknowledgmentControls;
    const showStartEarly = !!startEarly && item.status === 'pending';
    const showMarkInProgress = !startEarly && item.status === 'pending';
    const showComplete = !startEarly && (item.status === 'pending' || item.status === 'in_progress');
    const showViewOnMap = !!item.address;

    const hasQuickActions = !isCompleted && (showAcknowledge || showStartEarly || showMarkInProgress || showComplete || showViewOnMap);

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
          {hasMapPin && (
            <TouchableOpacity
              onPress={(e) => { e.stopPropagation(); handleViewTaskOnMap(item); }}
              style={styles.taskMapIconBtn}
              activeOpacity={0.7}
              testID={`map-pin-${item.id}`}
            >
              <Ionicons name="map" size={14} color="#25C1AC" />
            </TouchableOpacity>
          )}
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

        <View style={styles.taskMetas}>
          {windowRange ? (
            <View style={styles.taskMeta}>
              <Ionicons name="calendar-outline" size={12} color="#999" />
              <Text style={styles.metaText}>{windowRange}</Text>
            </View>
          ) : null}
          {item.address ? (
            <View style={styles.taskMeta}>
              <Ionicons name="location-outline" size={12} color="#999" />
              <Text style={styles.metaText} numberOfLines={1}>{item.address}</Text>
            </View>
          ) : null}
        </View>

        {hasQuickActions && (
          <View style={styles.quickActionsRow}>
            {showAcknowledge && (
              <TouchableOpacity
                style={[styles.quickActionBtn, styles.quickActionAcknowledge]}
                onPress={(e) => { e.stopPropagation(); handleAcknowledge(item); }}
                disabled={acknowledgingId === item.id}
                activeOpacity={0.7}
                testID={`acknowledge-${item.id}`}
              >
                <Ionicons name="checkmark-circle-outline" size={14} color="#fff" />
                <Text style={styles.quickActionText}>
                  {acknowledgingId === item.id ? 'Acknowledging...' : 'Acknowledge'}
                </Text>
              </TouchableOpacity>
            )}
            {showStartEarly && (
              <TouchableOpacity
                style={[styles.quickActionBtn, styles.quickActionStartEarly]}
                onPress={(e) => { e.stopPropagation(); handleStartEarly(item); }}
                disabled={markingInProgressId === item.id}
                activeOpacity={0.7}
                testID={`start-early-${item.id}`}
              >
                <Ionicons name="flash-outline" size={14} color="#fff" />
                <Text style={styles.quickActionText}>
                  {markingInProgressId === item.id ? 'Starting...' : 'Start Early'}
                </Text>
              </TouchableOpacity>
            )}
            {showMarkInProgress && (
              <TouchableOpacity
                style={[styles.quickActionBtn, styles.quickActionInProgress]}
                onPress={(e) => { e.stopPropagation(); handleMarkInProgress(item); }}
                disabled={markingInProgressId === item.id}
                activeOpacity={0.7}
                testID={`in-progress-${item.id}`}
              >
                <Ionicons name="play-circle-outline" size={14} color="#fff" />
                <Text style={styles.quickActionText}>
                  {markingInProgressId === item.id ? 'Updating...' : 'Mark In Progress'}
                </Text>
              </TouchableOpacity>
            )}
            {showComplete && (
              <TouchableOpacity
                style={[styles.quickActionBtn, styles.quickActionComplete]}
                onPress={(e) => { e.stopPropagation(); router.push(`/task/${item.id}`); }}
                activeOpacity={0.7}
                testID={`complete-${item.id}`}
              >
                <Ionicons name="checkmark-done-outline" size={14} color="#fff" />
                <Text style={styles.quickActionText}>Complete</Text>
              </TouchableOpacity>
            )}
            {showViewOnMap && (
              <TouchableOpacity
                style={[styles.quickActionBtn, styles.quickActionMap]}
                onPress={(e) => { e.stopPropagation(); handleViewOnMap(item); }}
                activeOpacity={0.7}
                testID={`map-${item.id}`}
              >
                <Ionicons name="map-outline" size={14} color="#fff" />
                <Text style={styles.quickActionText}>View on Map</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const renderTodayItem = ({ item }: { item: TodayListItem }) => {
    if ('type' in item && item.type === 'upcoming_header') {
      return (
        <View style={styles.todaySectionHeader}>
          <View style={[styles.todaySectionDot, { backgroundColor: '#1565c0' }]} />
          <Text style={styles.todaySectionTitle}>Upcoming</Text>
          <Text style={styles.todaySectionCount}>{item.count}</Text>
        </View>
      );
    }
    if ('type' in item && item.type === 'today_header') {
      const groupColor: Record<TodayStatusGroup, string> = {
        pending: '#ff9800',
        in_progress: '#25C1AC',
        done: '#4caf50',
      };
      return (
        <View style={styles.todaySectionHeader}>
          <View style={[styles.todaySectionDot, { backgroundColor: groupColor[item.group] }]} />
          <Text style={styles.todaySectionTitle}>{item.title}</Text>
          <Text style={styles.todaySectionCount}>{item.count}</Text>
        </View>
      );
    }
    const task = item as Task;
    const isUpcoming = !!task.windowStart && toDateOnly(task.windowStart) > today;
    return renderTask({ item: task, startEarly: isUpcoming });
  };

  return (
    <View style={styles.container}>
      <StatusBarFill />
      <NavyHeader {...navyHeaderProps}>
        <View style={ss.subtitleRow}>
          <Text style={ss.subtitleText}>TASKS</Text>
          <View style={ss.subtitleActions}>
            {isContractor ? (
              <View style={styles.contractorSegment} testID="contractor-view-toggle">
                <TouchableOpacity
                  style={[styles.segmentBtn, contractorViewMode === 'today' && styles.segmentBtnActive]}
                  onPress={() => setContractorViewMode('today')}
                  testID="segment-today"
                >
                  <Text style={[styles.segmentBtnText, contractorViewMode === 'today' && styles.segmentBtnTextActive]}>Today</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.segmentBtn, contractorViewMode === 'calendar' && styles.segmentBtnActive]}
                  onPress={() => setContractorViewMode('calendar')}
                  testID="segment-calendar"
                >
                  <Text style={[styles.segmentBtnText, contractorViewMode === 'calendar' && styles.segmentBtnTextActive]}>Calendar</Text>
                </TouchableOpacity>
              </View>
            ) : (
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
            )}
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

      {!isContractor && viewMode === 'list' && (
        <SyncBar
          onSync={handleSyncNow}
          isSyncing={syncing}
          lastSyncedAt={lastSyncedAt}
        />
      )}
      {isContractor && contractorViewMode === 'today' && (
        <SyncBar
          onSync={handleSyncNow}
          isSyncing={syncing}
          lastSyncedAt={lastSyncedAt}
        />
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

      {isContractor ? (
        contractorViewMode === 'calendar' ? (
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
            onViewDayOnMap={handleViewDayOnMap}
            isOffline={!isOnline}
          />
        ) : todayItems.length === 0 && !isLoading ? (
          <View style={styles.emptyState}>
            <Ionicons name="sunny-outline" size={48} color="#ccc" />
            <Text style={styles.emptyTitle}>No Tasks Today</Text>
            <Text style={styles.emptySubtitle}>You have no tasks scheduled for today</Text>
          </View>
        ) : (
          <FlatList
            ref={todayFlatListRef}
            data={todayItems}
            keyExtractor={(item: any) => {
              if (item.type === 'today_header') return `today-header-${item.group}`;
              if (item.type === 'upcoming_header') return 'upcoming-header';
              return item.id;
            }}
            renderItem={renderTodayItem}
            contentContainerStyle={styles.todayListContent}
            refreshControl={
              <RefreshControl refreshing={isLoading} onRefresh={refetch} />
            }
            scrollEnabled={!!todayItems.length}
            onScrollToIndexFailed={() => {}}
          />
        )
      ) : viewMode === 'calendar' ? (
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
          onViewDayOnMap={handleViewDayOnMap}
          isOffline={!isOnline}
          role={user?.role as any}
        />
      ) : allItems.length === 0 && !isLoading ? (
        <View style={styles.emptyState}>
          <Ionicons name="clipboard-outline" size={48} color="#ccc" />
          <Text style={styles.emptyTitle}>No Tasks</Text>
          <Text style={styles.emptySubtitle}>
            {user?.role === 'admin'
              ? 'Create a task to get started'
              : 'No tasks assigned to you yet'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={allItems}
          keyExtractor={(item: any) => {
            if (item.type === 'header') return `header-${item.title}`;
            if (item.type === 'collapsed_completed') return 'collapsed_completed';
            return item.id;
          }}
          renderItem={({ item }: any) => {
            if (item.type === 'header') {
              const isCompletedHeader = item.group === 'completed';
              return (
                <TouchableOpacity
                  style={styles.sectionHeaderRow}
                  onPress={isCompletedHeader ? () => setCompletedExpanded(e => !e) : undefined}
                  activeOpacity={isCompletedHeader ? 0.7 : 1}
                  testID={isCompletedHeader ? 'completed-header-toggle' : undefined}
                >
                  <TaskSectionHeader
                    title={item.title}
                    count={item.count}
                  />
                  {isCompletedHeader && (
                    <Ionicons
                      name={completedExpanded ? 'chevron-up' : 'chevron-down'}
                      size={14}
                      color="#888"
                      style={{ marginLeft: 2 }}
                    />
                  )}
                </TouchableOpacity>
              );
            }
            if (item.type === 'collapsed_completed') {
              return (
                <TouchableOpacity
                  style={styles.collapsedRow}
                  onPress={() => setCompletedExpanded(true)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="checkmark-circle-outline" size={16} color="#4caf50" />
                  <Text style={styles.collapsedText}>
                    {item.count} completed {item.count === 1 ? 'task' : 'tasks'} — tap to expand
                  </Text>
                </TouchableOpacity>
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

      {isContractor && contractorViewMode === 'today' && (
        <View style={styles.startWorkContainer}>
          <TouchableOpacity
            style={[styles.startWorkBtn, !hasPendingToday && styles.startWorkBtnDisabled]}
            onPress={handleStartWork}
            disabled={!hasPendingToday || startingWork}
            activeOpacity={0.85}
            testID="start-work-btn"
          >
            <Ionicons
              name="play-circle"
              size={22}
              color={hasPendingToday ? '#fff' : '#bbb'}
            />
            <Text style={[styles.startWorkText, !hasPendingToday && styles.startWorkTextDisabled]}>
              {startingWork ? 'Starting...' : hasPendingToday ? 'Start Work' : 'No Pending Tasks'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <LogVisitModal
        visible={!!logVisitSchedule}
        schedule={logVisitSchedule}
        onClose={() => { setLogVisitSchedule(null); setLogVisitDate(undefined); }}
        onSubmit={handleLogVisit}
        onSuccess={() => showToast('Visit logged')}
        userName={user?.displayName || ''}
        prefillDate={logVisitDate}
      />

      {undoStartEarly && (
        <View style={styles.undoToast} testID="undo-start-early-toast">
          <Text style={styles.undoToastText}>Task started early</Text>
          <TouchableOpacity
            onPress={handleUndoStartEarly}
            style={styles.undoToastBtn}
            activeOpacity={0.7}
            testID="undo-start-early-btn"
          >
            <Text style={styles.undoToastBtnText}>Undo</Text>
          </TouchableOpacity>
        </View>
      )}
      <Toast visible={toastVisible} message={toastMessage} toastKey={toastKey} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa' },
  listContent: { paddingHorizontal: 16, paddingBottom: 100 },
  todayListContent: { paddingHorizontal: 16, paddingBottom: 160 },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#999' },
  emptySubtitle: { fontSize: 14, color: '#bbb', textAlign: 'center', paddingHorizontal: 40 },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  collapsedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#f0faf0',
    borderRadius: 10,
    marginBottom: 8,
  },
  collapsedText: {
    fontSize: 13,
    color: '#4caf50',
    fontWeight: '500',
  },
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
  taskMetas: { flexDirection: 'row', gap: 16, marginTop: 10, flexWrap: 'wrap' },
  taskMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 12, color: '#999' },
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
  quickActionsRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 8,
    marginTop: 12,
  },
  quickActionBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  quickActionAcknowledge: {
    backgroundColor: '#1565c0',
  },
  quickActionStartEarly: {
    backgroundColor: '#7b1fa2',
  },
  quickActionInProgress: {
    backgroundColor: '#e65100',
  },
  quickActionComplete: {
    backgroundColor: '#25C1AC',
  },
  quickActionMap: {
    backgroundColor: '#546e7a',
  },
  quickActionText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600' as const,
  },
  taskMapIconBtn: {
    padding: 4,
    borderRadius: 6,
    backgroundColor: '#E8FAF7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  contractorSegment: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 8,
    padding: 2,
    gap: 2,
  },
  segmentBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
  },
  segmentBtnActive: {
    backgroundColor: '#fff',
  },
  segmentBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.75)',
  },
  segmentBtnTextActive: {
    color: '#0C1D31',
  },
  todaySectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 4,
    marginTop: 4,
  },
  todaySectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  todaySectionTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: '#555',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  todaySectionCount: {
    fontSize: 12,
    fontWeight: '600',
    color: '#aaa',
  },
  startWorkContainer: {
    position: 'absolute',
    bottom: Platform.OS === 'web' ? 34 : 90,
    left: 16,
    right: 16,
  },
  startWorkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#25C1AC',
    borderRadius: 14,
    paddingVertical: 16,
    shadowColor: '#25C1AC',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  startWorkBtnDisabled: {
    backgroundColor: '#e8e8e8',
    shadowOpacity: 0,
    elevation: 0,
  },
  startWorkText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.3,
  },
  startWorkTextDisabled: {
    color: '#aaa',
  },
  undoToast: {
    position: 'absolute',
    bottom: Platform.OS === 'web' ? 50 : 106,
    left: 16,
    right: 16,
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  undoToastText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#e0e0e0',
    flex: 1,
  },
  undoToastBtn: {
    backgroundColor: '#7b1fa2',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginLeft: 12,
  },
  undoToastBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },
});
