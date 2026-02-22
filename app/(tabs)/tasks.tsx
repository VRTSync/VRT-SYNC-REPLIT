import React from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import StatusBarFill from '@/components/StatusBarFill';
import SearchModal from '@/components/SearchModal';
import { apiRequest, getQueryFn } from '@/lib/query-client';
import { useCommunity } from '@/client/contexts/CommunityContext';
import { useAuth } from '@/client/contexts/AuthContext';
import { useOffline } from '@/client/contexts/OfflineContext';

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: 'pending' | 'in_progress' | 'completed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  address: string | null;
  assignedTo: string | null;
  dueDate: string | null;
  version: number;
  createdAt: string;
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
};

const statusColors: Record<string, string> = {
  pending: '#ff9800',
  in_progress: '#25C1AC',
  completed: '#4caf50',
};

export default function TasksScreen() {
  const router = useRouter();
  const { activeCommunity } = useCommunity();
  const { user } = useAuth();
  const { isOnline, cachedTasks, cacheTasks, pendingCompletions, syncPendingCompletions } = useOffline();
  const [syncing, setSyncing] = React.useState(false);
  const [searchVisible, setSearchVisible] = React.useState(false);

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      const result = await syncPendingCompletions();
      if (result.synced > 0 || result.failed > 0) {
        refetch();
      }
    } finally {
      setSyncing(false);
    }
  };

  const communityId = activeCommunity?.id;
  const { data: serverTasks, isLoading, refetch } = useQuery<Task[]>({
    queryKey: ['/api/tasks', { communityId }],
    queryFn: async () => {
      const route = communityId ? `/api/tasks?communityId=${communityId}` : '/api/tasks';
      const res = await apiRequest('GET', route);
      return res.json();
    },
    enabled: !!activeCommunity && isOnline,
  });

  React.useEffect(() => {
    if (serverTasks && serverTasks.length > 0) {
      cacheTasks(serverTasks);
    }
  }, [serverTasks]);

  const tasks: Task[] = serverTasks || (isOnline ? [] : cachedTasks);

  const activeTasks = tasks.filter((t) => t.status !== 'completed');
  const completedTasks = tasks.filter((t) => t.status === 'completed');

  const renderTask = ({ item }: { item: Task }) => {
    const pending = pendingCompletions.find(c => c.taskId === item.id && c.state !== 'synced');
    return (
      <TouchableOpacity
        style={styles.taskCard}
        onPress={() => router.push(`/task/${item.id}`)}
        activeOpacity={0.7}
        testID={`task-${item.id}`}
      >
        <View style={styles.taskHeader}>
          <View style={[styles.priorityDot, { backgroundColor: priorityColors[item.priority] }]} />
          <Text style={styles.taskTitle} numberOfLines={1}>{item.title}</Text>
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
          ) : (
            <View style={[styles.statusBadge, { backgroundColor: statusColors[item.status] + '20' }]}>
              <Text style={[styles.statusText, { color: statusColors[item.status] }]}>
                {statusLabels[item.status]}
              </Text>
            </View>
          )}
        </View>
        {item.description ? (
          <Text style={styles.taskDescription} numberOfLines={2}>{item.description}</Text>
        ) : null}
        <View style={styles.taskFooter}>
          {item.address ? (
            <View style={styles.taskMeta}>
              <Ionicons name="location-outline" size={12} color="#999" />
              <Text style={styles.metaText} numberOfLines={1}>{item.address}</Text>
            </View>
          ) : null}
          {item.dueDate ? (
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

  const sections = [
    ...(activeTasks.length > 0 ? [{ title: 'Active Tasks', data: activeTasks }] : []),
    ...(completedTasks.length > 0 ? [{ title: 'Completed', data: completedTasks }] : []),
  ];

  const allItems: (Task | { type: 'header'; title: string })[] = [];
  for (const section of sections) {
    allItems.push({ type: 'header', title: section.title } as any);
    allItems.push(...section.data);
  }

  return (
    <View style={styles.container}>
      <StatusBarFill />
      {!isOnline && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={14} color="#fff" />
          <Text style={styles.offlineBannerText}>Offline Mode</Text>
        </View>
      )}
      {pendingCompletions.length > 0 && (
        <View style={styles.syncBanner}>
          <View style={styles.syncInfo}>
            <Text style={styles.syncBannerText}>
              {pendingCompletions.filter(c => c.state === 'queued').length > 0 &&
                `${pendingCompletions.filter(c => c.state === 'queued').length} queued`}
              {pendingCompletions.filter(c => c.state === 'failed').length > 0 &&
                `${pendingCompletions.filter(c => c.state === 'queued').length > 0 ? ', ' : ''}${pendingCompletions.filter(c => c.state === 'failed').length} failed`}
              {pendingCompletions.filter(c => c.state === 'syncing').length > 0 &&
                ` syncing...`}
            </Text>
          </View>
          {isOnline && (
            <TouchableOpacity style={styles.syncButton} onPress={handleSyncNow} disabled={syncing}>
              <Text style={styles.syncButtonText}>{syncing ? 'Syncing...' : 'Sync Now'}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      <View style={styles.headerBar}>
        <View style={{ flex: 1 }}>
          <Text style={styles.communityName}>{activeCommunity?.name || 'No Community'}</Text>
          <Text style={styles.taskCount}>
            {activeTasks.length} active task{activeTasks.length !== 1 ? 's' : ''}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => setSearchVisible(true)}
          style={styles.searchButton}
          testID="search-button"
        >
          <Ionicons name="search" size={22} color="#0C1D31" />
        </TouchableOpacity>
      </View>
      <SearchModal
        visible={searchVisible}
        onClose={() => setSearchVisible(false)}
        onSelectTask={(result) => router.push(`/task/${result.id}`)}
        onSelectAsset={(result) => router.push(`/task/${result.id}` as any)}
        onShowOnMap={(result) => {
          router.push('/(tabs)/map' as any);
        }}
      />

      {tasks.length === 0 && !isLoading ? (
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
          keyExtractor={(item: any) => item.type === 'header' ? `header-${item.title}` : item.id}
          renderItem={({ item }: any) => {
            if (item.type === 'header') {
              return (
                <Text style={styles.sectionHeader}>{item.title}</Text>
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
  headerBar: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8, flexDirection: 'row', alignItems: 'center' },
  searchButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#f0f2f5', alignItems: 'center', justifyContent: 'center' },
  communityName: { fontSize: 22, fontWeight: '700', color: '#0C1D31' },
  taskCount: { fontSize: 14, color: '#888', marginTop: 2 },
  listContent: { paddingHorizontal: 16, paddingBottom: 100 },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '600',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 20,
    marginBottom: 8,
    paddingHorizontal: 4,
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
  taskFooter: { flexDirection: 'row', gap: 16, marginTop: 12 },
  taskMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 12, color: '#999' },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#999' },
  emptySubtitle: { fontSize: 14, color: '#bbb', textAlign: 'center', paddingHorizontal: 40 },
  offlineBanner: {
    backgroundColor: '#f44336',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 6,
  },
  offlineBannerText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  syncBanner: {
    backgroundColor: '#fff3e0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#ffe0b2',
  },
  syncInfo: { flex: 1 },
  syncBannerText: { fontSize: 13, fontWeight: '500', color: '#e65100' },
  syncButton: {
    backgroundColor: '#25C1AC',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  syncButtonText: { color: '#fff', fontSize: 12, fontWeight: '600' },
});
