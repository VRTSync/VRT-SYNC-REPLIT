import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, RefreshControl,
  ActivityIndicator, Alert,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiRequest } from '@/lib/query-client';
import { useCommunity } from '@/client/contexts/CommunityContext';
import { useAuth } from '@/client/contexts/AuthContext';
import { useOffline } from '@/client/contexts/OfflineContext';
import StatusBarFill from '@/components/StatusBarFill';
import SearchModal from '@/components/SearchModal';

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
};

type FollowUpTask = {
  id: string;
  taskId: string;
  taskTitle: string;
  taskPriority: string;
  followUpNeeded: string;
  completedAt: string;
};

type DashboardData = {
  dueTodayTasks: Task[];
  upcomingTasks: Task[];
  overdueTasks: Task[];
  followUpTasks: FollowUpTask[];
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

const MAP_JUMPS = [
  { key: 'community', label: 'Community Areas', icon: 'business-outline' as const, color: '#25C1AC' },
  { key: 'irrigation', label: 'Irrigation', icon: 'water-outline' as const, color: '#3498db' },
  { key: 'trees', label: 'Trees', icon: 'leaf-outline' as const, color: '#27ae60' },
  { key: 'snow', label: 'Snow', icon: 'snow-outline' as const, color: '#7f8c8d' },
];

export default function DashboardScreen() {
  const router = useRouter();
  const { activeCommunity, communities, setActiveCommunity } = useCommunity();
  const { user } = useAuth();
  const { isOnline, pendingCompletions, syncPendingCompletions } = useOffline();
  const [syncing, setSyncing] = useState(false);
  const [showCommunitySwitcher, setShowCommunitySwitcher] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);

  const communityId = activeCommunity?.id;

  const { data: dashboard, isLoading, refetch } = useQuery<DashboardData>({
    queryKey: ['/api/dashboard', { communityId }],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/dashboard?communityId=${communityId}`);
      return res.json();
    },
    enabled: !!communityId && isOnline,
  });

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      await syncPendingCompletions();
      refetch();
    } finally {
      setSyncing(false);
    }
  };

  const queuedCount = pendingCompletions.filter(c => c.state === 'queued').length;
  const failedCount = pendingCompletions.filter(c => c.state === 'failed').length;
  const syncingCount = pendingCompletions.filter(c => c.state === 'syncing').length;
  const hasPending = queuedCount + failedCount + syncingCount > 0;

  const getSyncLabel = () => {
    if (failedCount > 0) return `Sync error (${failedCount})`;
    if (syncingCount > 0) return 'Syncing...';
    if (queuedCount > 0) return `Queued (${queuedCount})`;
    return 'All synced';
  };

  const getSyncColor = () => {
    if (failedCount > 0) return '#f44336';
    if (syncingCount > 0 || queuedCount > 0) return '#f39c12';
    return '#25C1AC';
  };

  const handleMapJump = (categoryKey: string) => {
    router.push({ pathname: '/(tabs)/map', params: { category: categoryKey } });
  };

  const formatDueDate = (dateStr: string | null) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (d >= today && d < tomorrow) return 'Today';
    const dayAfter = new Date(tomorrow);
    dayAfter.setDate(dayAfter.getDate() + 1);
    if (d >= tomorrow && d < dayAfter) return 'Tomorrow';
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  };

  const renderTaskRow = (task: Task) => (
    <TouchableOpacity
      key={task.id}
      style={styles.taskRow}
      onPress={() => router.push(`/task/${task.id}`)}
      activeOpacity={0.7}
    >
      <View style={[styles.priorityBar, { backgroundColor: priorityColors[task.priority] }]} />
      <View style={styles.taskRowContent}>
        <Text style={styles.taskRowTitle} numberOfLines={1}>{task.title}</Text>
        <View style={styles.taskRowMeta}>
          <View style={[styles.statusPill, { backgroundColor: statusColors[task.status] + '20' }]}>
            <Text style={[styles.statusPillText, { color: statusColors[task.status] }]}>
              {statusLabels[task.status]}
            </Text>
          </View>
          {task.dueDate && (
            <Text style={styles.taskRowDate}>{formatDueDate(task.dueDate)}</Text>
          )}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={16} color="#ccc" />
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <StatusBarFill />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} />}
      >
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.greeting}>
                {user?.displayName ? `Hi, ${user.displayName}` : 'Dashboard'}
              </Text>
              <TouchableOpacity
                style={styles.communitySelector}
                onPress={() => setShowCommunitySwitcher(!showCommunitySwitcher)}
              >
                <Ionicons name="business" size={14} color="#25C1AC" />
                <Text style={styles.communitySelectorText} numberOfLines={1}>
                  {activeCommunity?.name || 'Select Community'}
                </Text>
                <Ionicons name="chevron-down" size={14} color="#25C1AC" />
              </TouchableOpacity>
            </View>

            <View style={styles.headerRight}>
              <TouchableOpacity
                onPress={() => setSearchVisible(true)}
                style={styles.searchButton}
                testID="home-search-button"
              >
                <Ionicons name="search" size={20} color="#fff" />
              </TouchableOpacity>
              <View style={[styles.onlineDot, { backgroundColor: isOnline ? '#25C1AC' : '#f44336' }]} />
              <Text style={styles.onlineLabel}>{isOnline ? 'Online' : 'Offline'}</Text>
            </View>
          </View>

          {showCommunitySwitcher && communities.length > 1 && (
            <View style={styles.communitySwitcherPanel}>
              {communities.map(c => (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.communityOption, c.id === activeCommunity?.id && styles.communityOptionActive]}
                  onPress={() => { setActiveCommunity(c); setShowCommunitySwitcher(false); }}
                >
                  <Text style={[styles.communityOptionText, c.id === activeCommunity?.id && styles.communityOptionTextActive]}>
                    {c.name}
                  </Text>
                  {c.id === activeCommunity?.id && <Ionicons name="checkmark" size={16} color="#25C1AC" />}
                </TouchableOpacity>
              ))}
            </View>
          )}

          <TouchableOpacity
            style={[styles.syncChip, { borderColor: getSyncColor() + '40', backgroundColor: getSyncColor() + '10' }]}
            onPress={hasPending && isOnline ? handleSyncNow : undefined}
            disabled={!hasPending || !isOnline || syncing}
          >
            <View style={[styles.syncDot, { backgroundColor: getSyncColor() }]} />
            <Text style={[styles.syncChipText, { color: getSyncColor() }]}>
              {syncing ? 'Syncing...' : getSyncLabel()}
            </Text>
            {hasPending && isOnline && !syncing && (
              <Ionicons name="refresh-outline" size={14} color={getSyncColor()} />
            )}
          </TouchableOpacity>
        </View>

        {!communityId ? (
          <View style={styles.emptyState}>
            <Ionicons name="business-outline" size={48} color="#ccc" />
            <Text style={styles.emptyTitle}>No community selected</Text>
            <Text style={styles.emptySubtitle}>Select a community above to see your dashboard</Text>
          </View>
        ) : isLoading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator color="#25C1AC" size="large" />
          </View>
        ) : (
          <>
            {dashboard?.overdueTasks && dashboard.overdueTasks.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeaderRow}>
                  <Ionicons name="alert-circle" size={18} color="#f44336" />
                  <Text style={[styles.sectionTitle, { color: '#f44336' }]}>Overdue</Text>
                  <View style={[styles.countBadge, { backgroundColor: '#f4433620' }]}>
                    <Text style={[styles.countBadgeText, { color: '#f44336' }]}>{dashboard.overdueTasks.length}</Text>
                  </View>
                </View>
                {dashboard.overdueTasks.map(renderTaskRow)}
              </View>
            )}

            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Ionicons name="today-outline" size={18} color="#0C1D31" />
                <Text style={styles.sectionTitle}>Due Today</Text>
                {dashboard?.dueTodayTasks && dashboard.dueTodayTasks.length > 0 && (
                  <View style={styles.countBadge}>
                    <Text style={styles.countBadgeText}>{dashboard.dueTodayTasks.length}</Text>
                  </View>
                )}
              </View>
              {!dashboard?.dueTodayTasks || dashboard.dueTodayTasks.length === 0 ? (
                <View style={styles.emptySection}>
                  <Ionicons name="checkmark-circle-outline" size={24} color="#ccc" />
                  <Text style={styles.emptySectionText}>No tasks due today</Text>
                </View>
              ) : (
                dashboard.dueTodayTasks.map(renderTaskRow)
              )}
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Ionicons name="calendar-outline" size={18} color="#0C1D31" />
                <Text style={styles.sectionTitle}>Next 7 Days</Text>
                {dashboard?.upcomingTasks && dashboard.upcomingTasks.length > 0 && (
                  <View style={styles.countBadge}>
                    <Text style={styles.countBadgeText}>{dashboard.upcomingTasks.length}</Text>
                  </View>
                )}
              </View>
              {!dashboard?.upcomingTasks || dashboard.upcomingTasks.length === 0 ? (
                <View style={styles.emptySection}>
                  <Ionicons name="calendar-clear-outline" size={24} color="#ccc" />
                  <Text style={styles.emptySectionText}>No upcoming tasks this week</Text>
                </View>
              ) : (
                dashboard.upcomingTasks.map(renderTaskRow)
              )}
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Ionicons name="map-outline" size={18} color="#0C1D31" />
                <Text style={styles.sectionTitle}>Quick Map Jump</Text>
              </View>
              <View style={styles.mapJumpGrid}>
                {MAP_JUMPS.map(jump => (
                  <TouchableOpacity
                    key={jump.key}
                    style={[styles.mapJumpBtn, { borderColor: jump.color + '30' }]}
                    onPress={() => handleMapJump(jump.key)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.mapJumpIcon, { backgroundColor: jump.color + '15' }]}>
                      <Ionicons name={jump.icon} size={22} color={jump.color} />
                    </View>
                    <Text style={styles.mapJumpLabel}>{jump.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {dashboard?.followUpTasks && dashboard.followUpTasks.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeaderRow}>
                  <Ionicons name="flag-outline" size={18} color="#f39c12" />
                  <Text style={[styles.sectionTitle, { color: '#f39c12' }]}>Follow-Up Needed</Text>
                  <View style={[styles.countBadge, { backgroundColor: '#f39c1220' }]}>
                    <Text style={[styles.countBadgeText, { color: '#f39c12' }]}>{dashboard.followUpTasks.length}</Text>
                  </View>
                </View>
                {dashboard.followUpTasks.map(fu => (
                  <TouchableOpacity
                    key={fu.id}
                    style={styles.followUpRow}
                    onPress={() => router.push(`/task/${fu.taskId}`)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.priorityBar, { backgroundColor: priorityColors[fu.taskPriority] || '#999' }]} />
                    <View style={styles.taskRowContent}>
                      <Text style={styles.taskRowTitle} numberOfLines={1}>{fu.taskTitle}</Text>
                      <Text style={styles.followUpNote} numberOfLines={1}>{fu.followUpNeeded}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color="#ccc" />
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {failedCount > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeaderRow}>
                  <Ionicons name="warning-outline" size={18} color="#f44336" />
                  <Text style={[styles.sectionTitle, { color: '#f44336' }]}>Sync Errors</Text>
                </View>
                {pendingCompletions.filter(c => c.state === 'failed').map(pc => (
                  <View key={pc.id} style={styles.syncErrorRow}>
                    <Ionicons name="close-circle" size={16} color="#f44336" />
                    <Text style={styles.syncErrorText} numberOfLines={1}>
                      Task completion failed: {pc.lastError || 'Unknown error'}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            <TouchableOpacity
              style={styles.viewAllBtn}
              onPress={() => router.push('/(tabs)/tasks')}
            >
              <Ionicons name="list-outline" size={18} color="#25C1AC" />
              <Text style={styles.viewAllBtnText}>View All Tasks</Text>
              <Ionicons name="chevron-forward" size={16} color="#25C1AC" />
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa' },
  scrollContent: { paddingBottom: 100 },
  header: {
    backgroundColor: '#0C1D31',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  greeting: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
  },
  communitySelector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    backgroundColor: 'rgba(37,193,172,0.12)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  communitySelectorText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#25C1AC',
    maxWidth: 180,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  searchButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  onlineDot: { width: 8, height: 8, borderRadius: 4 },
  onlineLabel: { fontSize: 12, color: 'rgba(255,255,255,0.7)', fontWeight: '500' },
  communitySwitcherPanel: {
    marginTop: 10,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 10,
    overflow: 'hidden',
  },
  communityOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  communityOptionActive: {
    backgroundColor: 'rgba(37,193,172,0.1)',
  },
  communityOptionText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
  },
  communityOptionTextActive: {
    color: '#25C1AC',
    fontWeight: '600',
  },
  syncChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  syncDot: { width: 6, height: 6, borderRadius: 3 },
  syncChipText: { fontSize: 12, fontWeight: '600' },
  section: {
    marginTop: 16,
    marginHorizontal: 16,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0C1D31',
    flex: 1,
  },
  countBadge: {
    backgroundColor: '#25C1AC20',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  countBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#25C1AC',
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    gap: 10,
  },
  priorityBar: {
    width: 3,
    height: 32,
    borderRadius: 2,
  },
  taskRowContent: { flex: 1 },
  taskRowTitle: { fontSize: 15, fontWeight: '600', color: '#0C1D31' },
  taskRowMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3 },
  statusPill: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  statusPillText: { fontSize: 10, fontWeight: '600' },
  taskRowDate: { fontSize: 12, color: '#888' },
  emptySection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 16,
    justifyContent: 'center',
  },
  emptySectionText: { fontSize: 14, color: '#bbb' },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 80,
    gap: 12,
  },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#999' },
  emptySubtitle: { fontSize: 14, color: '#bbb', textAlign: 'center', paddingHorizontal: 40 },
  loadingState: {
    paddingTop: 80,
    alignItems: 'center',
  },
  mapJumpGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  mapJumpBtn: {
    width: '47%' as any,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
  },
  mapJumpIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mapJumpLabel: { fontSize: 13, fontWeight: '600', color: '#0C1D31', flex: 1 },
  followUpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    gap: 10,
  },
  followUpNote: { fontSize: 12, color: '#f39c12', marginTop: 2, fontStyle: 'italic' },
  syncErrorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  syncErrorText: { fontSize: 13, color: '#666', flex: 1 },
  viewAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
    marginHorizontal: 16,
    marginBottom: 20,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#25C1AC30',
  },
  viewAllBtnText: { fontSize: 15, fontWeight: '600', color: '#25C1AC' },
});
