import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, RefreshControl,
  ActivityIndicator, Alert,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiRequest } from '@/lib/query-client';
import { useCommunity } from '@/client/contexts/CommunityContext';
import { useAuth } from '@/client/contexts/AuthContext';
import { useOffline, ServiceSchedule } from '@/client/contexts/OfflineContext';
import StatusBarFill from '@/components/StatusBarFill';
import NavyHeader, { subtitleStyles as ss } from '@/components/NavyHeader';
import { useNavyHeaderProps } from '@/components/useNavyHeaderProps';
import SearchModal from '@/components/SearchModal';
import MowingDayCard from '@/components/MowingDayCard';
import LogVisitModal from '@/components/LogVisitModal';
import NotificationBell from '@/components/NotificationBell';
import SyncBar from '@/components/SyncBar';

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
  inWindowTasks: Task[];
  comingUpTasks: Task[];
  followUpTasks: FollowUpTask[];
  urgentRequestCount: number;
  normalRequestCount: number;
  newRequestCount: number;
  acknowledgedRequestCount: number;
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
  submitted: 'New',
  acknowledged: 'Acknowledged',
};

const statusColors: Record<string, string> = {
  pending: '#ff9800',
  in_progress: '#25C1AC',
  completed: '#4caf50',
  submitted: '#e65100',
  acknowledged: '#1565c0',
};

const MAP_JUMPS = [
  { key: 'community', label: 'Community Areas', icon: 'business-outline' as const, color: '#25C1AC' },
  { key: 'irrigation', label: 'Irrigation', icon: 'water-outline' as const, color: '#3498db' },
  { key: 'trees', label: 'Trees', icon: 'leaf-outline' as const, color: '#27ae60' },
  { key: 'snow', label: 'Snow', icon: 'snow-outline' as const, color: '#7f8c8d' },
];

export default function DashboardScreen() {
  const router = useRouter();
  const { activeCommunity } = useCommunity();
  const { user } = useAuth();
  const navyHeaderProps = useNavyHeaderProps();
  const {
    isOnline, pendingCompletions, syncPendingCompletions,
    cachedServiceSchedules, cachedServiceVisits, pendingServiceVisits,
    cacheServiceSchedules, cacheServiceVisits, addPendingServiceVisit,
    syncPendingServiceVisits,
  } = useOffline();
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [searchVisible, setSearchVisible] = useState(false);
  const [logVisitSchedule, setLogVisitSchedule] = useState<ServiceSchedule | null>(null);

  const communityId = activeCommunity?.id;

  const { data: dashboard, isLoading, refetch, dataUpdatedAt } = useQuery<DashboardData>({
    queryKey: ['/api/dashboard', { communityId }],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/dashboard?communityId=${communityId}`);
      return res.json();
    },
    enabled: !!communityId && isOnline,
  });

  useEffect(() => {
    if (dataUpdatedAt > 0) {
      setLastSyncedAt(prev => {
        const queryDate = new Date(dataUpdatedAt);
        if (!prev || queryDate > prev) return queryDate;
        return prev;
      });
    }
  }, [dataUpdatedAt]);

  const { data: schedules, isLoading: schedulesLoading, refetch: refetchSchedules } = useQuery({
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
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
      const res = await apiRequest('GET', `/api/communities/${communityId}/service-visits?from=${weekAgo}&to=${today}`);
      const data = await res.json();
      if (communityId) cacheServiceVisits(communityId, data);
      return data;
    },
    enabled: !!communityId && isOnline,
  });

  const displaySchedules = schedules || cachedServiceSchedules;
  const displayVisits = recentVisits || cachedServiceVisits;

  const queryClient = useQueryClient();

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

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      const [syncResult, serviceResult] = await Promise.all([
        syncPendingCompletions(),
        syncPendingServiceVisits(),
      ]);
      const [dashResult] = await Promise.all([refetch(), refetchVisits(), refetchSchedules()]);
      if (dashResult.error) throw dashResult.error;
      if ((syncResult?.failed ?? 0) > 0 || (serviceResult?.failed ?? 0) > 0) {
        throw new Error('Some items failed to upload');
      }
      setLastSyncedAt(new Date());
    } finally {
      setSyncing(false);
    }
    try {
      await queryClient.invalidateQueries({ queryKey: ['/api/map-layers'] });
    } catch {}
  };

  useEffect(() => {
    if (!dashboard) return;
    const allTasks = [
      ...(dashboard.dueTodayTasks ?? []),
      ...(dashboard.upcomingTasks ?? []),
      ...(dashboard.overdueTasks ?? []),
      ...(dashboard.inWindowTasks ?? []),
      ...(dashboard.comingUpTasks ?? []),
    ];
    allTasks.forEach(task => {
      queryClient.setQueryData([`/api/tasks/${task.id}/detail`], { task, completions: [], taskAttachments: [], taskLink: null });
    });
  }, [dashboard, queryClient]);

  const failedCount = pendingCompletions.filter(c => c.state === 'failed').length;

  const handleMapJump = (categoryKey: string) => {
    router.push({ pathname: '/(tabs)/map', params: { category: categoryKey } });
  };

  const formatWindowDate = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  const formatWindowRange = (task: Task) => {
    if (!task.windowStart || !task.windowEnd) return null;
    return `${formatWindowDate(task.windowStart)} – ${formatWindowDate(task.windowEnd)}`;
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

  const renderTaskRow = (task: Task) => {
    const windowRange = formatWindowRange(task);
    return (
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
            {windowRange ? (
              <View style={styles.windowRangeMeta}>
                <Ionicons name="calendar-outline" size={11} color="#999" />
                <Text style={styles.taskRowDate}>{windowRange}</Text>
              </View>
            ) : task.dueDate ? (
              <Text style={styles.taskRowDate}>{formatDueDate(task.dueDate)}</Text>
            ) : null}
          </View>
        </View>
        <Ionicons name="chevron-forward" size={16} color="#ccc" />
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBarFill />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} />}
      >
        <NavyHeader {...navyHeaderProps}>
          <View style={ss.subtitleRow}>
            <Text style={ss.subtitleText}>DASHBOARD</Text>
            <View style={ss.subtitleActions}>
              <NotificationBell />
              <TouchableOpacity
                onPress={() => setSearchVisible(true)}
                style={ss.headerIconBtn}
                testID="home-search-button"
              >
                <Ionicons name="search" size={20} color="#555" />
              </TouchableOpacity>
            </View>
          </View>
        </NavyHeader>

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
            <SyncBar
              onSync={handleSyncNow}
              isSyncing={syncing}
              lastSyncedAt={lastSyncedAt}
            />
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

            {(() => {
              const newCount = dashboard?.newRequestCount ?? 0;
              const ackCount = dashboard?.acknowledgedRequestCount ?? 0;
              const totalRequests = newCount + ackCount;
              const inWindow = dashboard?.inWindowTasks ?? [];

              return (
                <View style={styles.section}>
                  <View style={styles.sectionHeaderRow}>
                    <Ionicons name="today-outline" size={18} color="#0C1D31" />
                    <Text style={styles.sectionTitle}>Today</Text>
                    {(inWindow.length + totalRequests) > 0 && (
                      <View style={styles.countBadge}>
                        <Text style={styles.countBadgeText}>{inWindow.length + totalRequests}</Text>
                      </View>
                    )}
                  </View>

                  <TouchableOpacity
                    style={styles.requestsCard}
                    onPress={() => router.push({ pathname: '/(tabs)/tasks', params: { filter: 'requests' } })}
                    activeOpacity={0.7}
                  >
                    <View style={styles.requestsCardHeader}>
                      <Ionicons name="mail-unread-outline" size={20} color="#25C1AC" />
                      <Text style={styles.requestsCardTitle}>Requests</Text>
                      <Ionicons name="chevron-forward" size={16} color="#bbb" style={{ marginLeft: 'auto' }} />
                    </View>
                    {totalRequests === 0 ? (
                      <Text style={styles.requestsNone}>No open requests</Text>
                    ) : (
                      <View style={styles.requestsBadgeRow}>
                        {newCount > 0 && (
                          <View style={[styles.requestsBadge, { backgroundColor: '#FFF3E0' }]}>
                            <View style={[styles.requestsBadgeDot, { backgroundColor: '#e65100' }]} />
                            <Text style={[styles.requestsBadgeLabel, { color: '#e65100' }]}>{newCount} New</Text>
                          </View>
                        )}
                        {ackCount > 0 && (
                          <View style={[styles.requestsBadge, { backgroundColor: '#E3F2FD' }]}>
                            <View style={[styles.requestsBadgeDot, { backgroundColor: '#1565c0' }]} />
                            <Text style={[styles.requestsBadgeLabel, { color: '#1565c0' }]}>{ackCount} Acknowledged</Text>
                          </View>
                        )}
                      </View>
                    )}
                  </TouchableOpacity>

                  {inWindow.length === 0 ? (
                    <View style={styles.emptySection}>
                      <Ionicons name="checkmark-circle-outline" size={24} color="#ccc" />
                      <Text style={styles.emptySectionText}>No active tasks in window</Text>
                    </View>
                  ) : (
                    inWindow.map(renderTaskRow)
                  )}
                </View>
              );
            })()}

            <MowingDayCard
              schedules={displaySchedules || []}
              visits={displayVisits || []}
              pendingVisits={pendingServiceVisits}
              onLogVisit={(schedule) => setLogVisitSchedule(schedule)}
              loading={schedulesLoading}
            />

            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Ionicons name="calendar-outline" size={18} color="#0C1D31" />
                <Text style={styles.sectionTitle}>Coming Up</Text>
                {dashboard?.comingUpTasks && dashboard.comingUpTasks.length > 0 && (
                  <View style={styles.countBadge}>
                    <Text style={styles.countBadgeText}>{dashboard.comingUpTasks.length}</Text>
                  </View>
                )}
              </View>
              {!dashboard?.comingUpTasks || dashboard.comingUpTasks.length === 0 ? (
                <View style={styles.emptySection}>
                  <Ionicons name="calendar-clear-outline" size={24} color="#ccc" />
                  <Text style={styles.emptySectionText}>No upcoming tasks</Text>
                </View>
              ) : (
                dashboard.comingUpTasks.map(renderTaskRow)
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
      <LogVisitModal
        visible={!!logVisitSchedule}
        schedule={logVisitSchedule}
        onClose={() => setLogVisitSchedule(null)}
        onSubmit={handleLogVisit}
        userName={user?.displayName || ''}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa' },
  scrollContent: { paddingBottom: 100 },
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
  windowRangeMeta: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 3,
  },
  requestsCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#25C1AC',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  requestsCardHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 8,
  },
  requestsCardTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: '#0C1D31',
  },
  requestsNone: {
    fontSize: 13,
    color: '#aaa',
    paddingLeft: 28,
    paddingBottom: 2,
  },
  requestsBadgeRow: {
    flexDirection: 'row' as const,
    gap: 8,
    paddingLeft: 28,
  },
  requestsBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  requestsBadgeDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  requestsBadgeLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
  },
});
