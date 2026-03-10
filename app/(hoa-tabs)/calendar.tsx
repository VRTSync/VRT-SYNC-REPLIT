import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import StatusBarFill from '@/components/StatusBarFill';
import NavyHeader, { subtitleStyles as ss } from '@/components/NavyHeader';
import { useNavyHeaderProps } from '@/components/useNavyHeaderProps';
import CalendarView from '@/components/CalendarView';
import SearchModal from '@/components/SearchModal';
import { useCommunity } from '@/client/contexts/CommunityContext';

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
  dueDate: string | null;
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
type FilterKey = 'all' | 'requests' | 'non-requests';
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

export default function HoaTasksScreen() {
  const router = useRouter();
  const { activeCommunity } = useCommunity();
  const navyHeaderProps = useNavyHeaderProps();
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [searchVisible, setSearchVisible] = useState(false);

  const { data: tasks, isLoading, refetch } = useQuery<Task[]>({
    queryKey: ['/api/tasks'],
  });

  const today = getTodayDenver();

  const filteredTasks = useMemo(() => {
    if (!tasks) return [];
    const active = tasks.filter(t => t.status !== 'completed');
    switch (activeFilter) {
      case 'requests':
        return active.filter(t => t.origin === 'HOA');
      case 'non-requests':
        return active.filter(t => t.origin !== 'HOA');
      default:
        return active;
    }
  }, [tasks, activeFilter]);

  const calendarTasks = useMemo(() => {
    if (!tasks) return [];
    switch (activeFilter) {
      case 'requests':
        return tasks.filter(t => t.origin === 'HOA');
      case 'non-requests':
        return tasks.filter(t => t.origin !== 'HOA');
      default:
        return tasks;
    }
  }, [tasks, activeFilter]);

  const buildGroupedList = (): (Task | { type: 'header'; title: string; count: number })[] => {
    const groups: Record<WindowGroup, Task[]> = {
      overdue: [],
      active_window: [],
      upcoming: [],
      no_window: [],
    };
    for (const t of filteredTasks) {
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

  const handleTaskPress = useCallback((taskId: string) => {
    router.push(`/task/${taskId}` as any);
  }, [router]);

  const renderTask = ({ item }: { item: Task }) => {
    const urgency = getUrgencyChip(item, today);
    const windowRange = formatWindowRange(item);
    const isHoa = item.origin === 'HOA';

    const isCompleted = item.status === 'completed';

    return (
      <TouchableOpacity
        style={[styles.taskCard, isHoa && styles.hoaTaskCard, isCompleted && styles.completedCard]}
        onPress={() => handleTaskPress(item.id)}
        activeOpacity={0.7}
      >
        {isCompleted && (
          <View style={styles.completedBanner}>
            <Ionicons name="checkmark-circle" size={16} color="#2E7D32" />
            <Text style={styles.completedBannerText}>COMPLETED</Text>
          </View>
        )}
        <View style={styles.taskHeader}>
          <View style={[styles.priorityDot, { backgroundColor: priorityColors[item.priority] }]} />
          <Text style={[styles.taskTitle, isCompleted && styles.completedTitle]} numberOfLines={1}>{item.title}</Text>
          {isHoa ? (
            <View style={styles.hoaBadge}>
              <Text style={styles.hoaBadgeText}>REQUEST</Text>
            </View>
          ) : null}
          {urgency ? (
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
            >
              <Ionicons name="search" size={20} color="#555" />
            </TouchableOpacity>
          </View>
        </View>
      </NavyHeader>

      {viewMode === 'list' && (
        <View style={styles.filterRow}>
          <TouchableOpacity
            style={[styles.filterTab, activeFilter === 'all' && styles.filterTabActive]}
            onPress={() => setActiveFilter('all')}
          >
            <Text style={[styles.filterTabText, activeFilter === 'all' && styles.filterTabTextActive]}>
              All
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterTab, activeFilter === 'requests' && styles.filterTabActive]}
            onPress={() => setActiveFilter('requests')}
          >
            <Text style={[styles.filterTabText, activeFilter === 'requests' && styles.filterTabTextActive]}>
              Requests
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterTab, activeFilter === 'non-requests' && styles.filterTabActive]}
            onPress={() => setActiveFilter('non-requests')}
          >
            <Text style={[styles.filterTabText, activeFilter === 'non-requests' && styles.filterTabTextActive]}>
              Non-Requests
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <SearchModal
        visible={searchVisible}
        onClose={() => setSearchVisible(false)}
        onSelectTask={(result) => router.push(`/task/${result.id}`)}
        onSelectAsset={(result) => router.push(`/asset/${result.id}` as any)}
        onShowOnMap={() => {}}
      />

      {viewMode === 'calendar' ? (
        <CalendarView
          tasks={calendarTasks}
          schedules={[]}
          visits={[]}
          pendingVisits={[]}
          onTaskPress={handleTaskPress}
          onLogVisit={() => {}}
          isOffline={false}
        />
      ) : isLoading ? (
        <View style={styles.emptyState}>
          <ActivityIndicator size="large" color="#25C1AC" />
        </View>
      ) : allItems.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="clipboard-outline" size={48} color="#ccc" />
          <Text style={styles.emptyTitle}>
            {activeFilter === 'requests' ? 'No Requests' : activeFilter === 'non-requests' ? 'No Contract Tasks' : 'No Tasks'}
          </Text>
          <Text style={styles.emptySubtitle}>
            {activeFilter === 'requests' ? 'HOA requests will appear here' : 'Tasks will appear here'}
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
  sectionHeader: { fontSize: 14, fontWeight: '700', color: '#0C1D31' },
  sectionHeaderOverdue: { color: '#c62828' },
  sectionHeaderActive: { color: '#25C1AC' },
  sectionCountBadge: {
    backgroundColor: '#e8eaed',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  sectionCountText: { fontSize: 12, fontWeight: '700', color: '#666' },
  taskCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  hoaTaskCard: {
    borderLeftWidth: 3,
    borderLeftColor: '#25C1AC',
  },
  taskHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  priorityDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  taskTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#0C1D31',
  },
  hoaBadge: {
    backgroundColor: '#25C1AC20',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  hoaBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#25C1AC',
    letterSpacing: 0.5,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  taskDescription: {
    fontSize: 13,
    color: '#666',
    marginTop: 6,
    lineHeight: 18,
  },
  taskFooter: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 8,
    alignItems: 'center',
  },
  taskMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 12,
    color: '#999',
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
    marginTop: 12,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#999',
    marginTop: 4,
    textAlign: 'center',
  },
  completedCard: {
    backgroundColor: '#E8F5E9',
    borderLeftWidth: 4,
    borderLeftColor: '#4caf50',
  },
  completedBanner: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    backgroundColor: '#C8E6C9',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginBottom: 10,
    alignSelf: 'flex-start' as const,
  },
  completedBannerText: {
    fontSize: 12,
    fontWeight: '800' as const,
    color: '#2E7D32',
    letterSpacing: 1,
  },
  completedTitle: {
    color: '#2E7D32',
  },
});
