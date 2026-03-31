import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/query-client';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import StatusBarFill from '@/components/StatusBarFill';
import NavyHeader, { subtitleStyles as ss } from '@/components/NavyHeader';
import { useNavyHeaderProps } from '@/components/useNavyHeaderProps';
import CalendarView from '@/components/CalendarView';
import SearchModal from '@/components/SearchModal';
import { useCommunity } from '@/client/contexts/CommunityContext';
import { useAuth } from '@/client/contexts/AuthContext';

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
  category: string | null;
  version: number;
  createdAt: string;
  origin?: string | null;
};

type FilterKey = 'all' | 'upcoming' | 'completed';
type ViewMode = 'list' | 'calendar';

function getTodayDenver(): Date {
  const now = new Date();
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: 'America/Denver' });
  return new Date(todayStr + 'T00:00:00');
}

function toDateOnly(s: string): Date {
  const d = s.includes('T') ? s.split('T')[0] : s;
  return new Date(d + 'T00:00:00');
}

function getCommunityStatusLabel(status: Task['status']): string {
  if (status === 'pending' || status === 'submitted' || status === 'acknowledged') return 'Scheduled';
  if (status === 'in_progress') return 'In Progress';
  if (status === 'completed') return 'Completed';
  return 'Scheduled';
}

function getCommunityStatusColor(status: Task['status']): { color: string; bg: string } {
  if (status === 'pending' || status === 'submitted' || status === 'acknowledged') {
    return { color: '#1565c0', bg: '#e3f2fd' };
  }
  if (status === 'in_progress') return { color: '#0d7a68', bg: '#e6f9f6' };
  if (status === 'completed') return { color: '#2e7d32', bg: '#e8f5e9' };
  return { color: '#1565c0', bg: '#e3f2fd' };
}

function formatWindowRange(task: Task): string | null {
  if (!task.windowStart || !task.windowEnd) return null;
  const s = toDateOnly(task.windowStart);
  const e = toDateOnly(task.windowEnd);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${s.toLocaleDateString('en-US', opts)} – ${e.toLocaleDateString('en-US', opts)}`;
}

export default function HoaTasksScreen() {
  const router = useRouter();
  const { activeCommunity } = useCommunity();
  const { user } = useAuth();
  const navyHeaderProps = useNavyHeaderProps();
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');
  const [viewMode, setViewMode] = useState<ViewMode>(
    user?.role === 'hoa_member' ? 'calendar' : 'list'
  );
  const [searchVisible, setSearchVisible] = useState(false);

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

  const today = getTodayDenver();

  const filteredTasks = useMemo(() => {
    if (!tasks) return [];
    switch (activeFilter) {
      case 'upcoming': {
        return tasks
          .filter(t => {
            if (t.status === 'completed') return false;
            if (!t.windowStart) return false;
            return toDateOnly(t.windowStart) > today;
          })
          .sort((a, b) => {
            const sa = a.windowStart ? toDateOnly(a.windowStart).getTime() : 0;
            const sb = b.windowStart ? toDateOnly(b.windowStart).getTime() : 0;
            return sa - sb;
          });
      }
      case 'completed': {
        return tasks
          .filter(t => t.status === 'completed')
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      }
      default: {
        return tasks
          .filter(t => t.status !== 'completed')
          .sort((a, b) => {
            const sa = a.windowStart ? toDateOnly(a.windowStart).getTime() : Infinity;
            const sb = b.windowStart ? toDateOnly(b.windowStart).getTime() : Infinity;
            return sa - sb;
          });
      }
    }
  }, [tasks, activeFilter]);

  const calendarTasks = useMemo(() => {
    if (!tasks) return [];
    return tasks;
  }, [tasks]);

  const handleTaskPress = useCallback((taskId: string) => {
    router.push(`/task/${taskId}` as any);
  }, [router]);

  const renderTask = ({ item }: { item: Task }) => {
    const windowRange = formatWindowRange(item);
    const statusLabel = getCommunityStatusLabel(item.status);
    const statusStyle = getCommunityStatusColor(item.status);
    const isCompleted = item.status === 'completed';

    return (
      <TouchableOpacity
        style={[styles.taskCard, isCompleted && styles.completedCard]}
        onPress={() => handleTaskPress(item.id)}
        activeOpacity={0.7}
      >
        <View style={styles.taskHeader}>
          <Text style={[styles.taskTitle, isCompleted && styles.completedTitle]} numberOfLines={1}>
            {item.title}
          </Text>
          <View style={[styles.statusChip, { backgroundColor: statusStyle.bg }]}>
            <Text style={[styles.statusChipText, { color: statusStyle.color }]}>{statusLabel}</Text>
          </View>
        </View>

        {item.description ? (
          <Text style={styles.taskDescription} numberOfLines={2}>{item.description}</Text>
        ) : null}

        <View style={styles.taskFooter}>
          {windowRange ? (
            <View style={styles.taskMeta}>
              <Ionicons name="calendar-outline" size={12} color="#999" />
              <Text style={styles.metaText}>{windowRange}</Text>
            </View>
          ) : item.dueDate ? (
            <View style={styles.taskMeta}>
              <Ionicons name="calendar-outline" size={12} color="#999" />
              <Text style={styles.metaText}>
                {toDateOnly(item.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </Text>
            </View>
          ) : null}
          {item.address ? (
            <View style={styles.taskMeta}>
              <Ionicons name="location-outline" size={12} color="#999" />
              <Text style={styles.metaText} numberOfLines={1}>{item.address}</Text>
            </View>
          ) : null}
          {item.category ? (
            <View style={styles.taskMeta}>
              <Ionicons name="pricetag-outline" size={12} color="#999" />
              <Text style={styles.metaText}>{item.category}</Text>
            </View>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  const emptyMessage = () => {
    if (activeFilter === 'upcoming') return { title: 'Nothing Coming Up', subtitle: 'Scheduled work will appear here' };
    if (activeFilter === 'completed') return { title: 'No Completed Tasks', subtitle: 'Finished work will appear here' };
    return { title: 'No Activity', subtitle: 'Community tasks will appear here' };
  };

  const empty = emptyMessage();

  return (
    <View style={styles.container}>
      <StatusBarFill />
      <NavyHeader {...navyHeaderProps}>
        <View style={ss.subtitleRow}>
          <Text style={ss.subtitleText}>TASKS</Text>
          <View style={ss.subtitleActions}>
            <View style={styles.viewTogglePill}>
              <TouchableOpacity
                style={[styles.viewToggleSegment, viewMode === 'list' && styles.viewToggleSegmentActive]}
                onPress={() => setViewMode('list')}
              >
                <Text style={[styles.viewToggleText, viewMode === 'list' && styles.viewToggleTextActive]}>List</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.viewToggleSegment, viewMode === 'calendar' && styles.viewToggleSegmentActive]}
                onPress={() => setViewMode('calendar')}
              >
                <Text style={[styles.viewToggleText, viewMode === 'calendar' && styles.viewToggleTextActive]}>Calendar</Text>
              </TouchableOpacity>
            </View>
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
          {(['all', 'upcoming', 'completed'] as FilterKey[]).map((key) => (
            <TouchableOpacity
              key={key}
              style={[styles.filterTab, activeFilter === key && styles.filterTabActive]}
              onPress={() => setActiveFilter(key)}
            >
              <Text style={[styles.filterTabText, activeFilter === key && styles.filterTabTextActive]}>
                {key === 'all' ? 'All' : key === 'upcoming' ? 'Upcoming' : 'Completed'}
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
          role={user?.role}
        />
      ) : isLoading ? (
        <View style={styles.emptyState}>
          <ActivityIndicator size="large" color="#25C1AC" />
        </View>
      ) : filteredTasks.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="clipboard-outline" size={48} color="#ccc" />
          <Text style={styles.emptyTitle}>{empty.title}</Text>
          <Text style={styles.emptySubtitle}>{empty.subtitle}</Text>
        </View>
      ) : (
        <FlatList
          data={filteredTasks}
          keyExtractor={(item) => item.id}
          renderItem={renderTask}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={isLoading} onRefresh={refetch} />
          }
          scrollEnabled={!!filteredTasks.length}
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
  listContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 100 },
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
  taskHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  taskTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#0C1D31',
  },
  statusChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusChipText: {
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
    borderLeftWidth: 3,
    borderLeftColor: '#4caf50',
  },
  completedTitle: {
    color: '#2E7D32',
  },
  viewTogglePill: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 8,
    padding: 2,
  },
  viewToggleSegment: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewToggleSegmentActive: {
    backgroundColor: '#fff',
  },
  viewToggleText: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.7)',
  },
  viewToggleTextActive: {
    color: '#0C1D31',
  },
});
