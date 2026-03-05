import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, ActivityIndicator, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useAuth } from '@/client/contexts/AuthContext';
import { useCommunity } from '@/client/contexts/CommunityContext';
import StatusBarFill from '@/components/StatusBarFill';
import NavyHeader, { subtitleStyles as ss } from '@/components/NavyHeader';
import { useNavyHeaderProps } from '@/components/useNavyHeaderProps';
import CreateRequestSheet from '@/components/CreateRequestSheet';
import NotificationBell from '@/components/NotificationBell';

type UpcomingTask = {
  id: string;
  title: string;
  status: string;
  windowStart: string | null;
  windowEnd: string | null;
  dueDate: string | null;
  origin: string | null;
  priority: string;
  assetId: string | null;
};

type RecentCompletion = {
  id: string;
  title: string;
  completedAt: string;
  origin: string | null;
  priority: string;
  hasPhotos: boolean;
};

type RequestsSummary = {
  submittedCount: number;
  acknowledgedCount: number;
  topRequests: {
    id: string;
    title: string;
    priority: string;
    status: string;
    createdAt: string;
  }[];
};

type MowingSchedule = {
  id: string;
  serviceType: string;
  dayOfWeek: number;
  seasonStart: string | null;
  seasonEnd: string | null;
};

type DashboardData = {
  community: { id: string; name: string };
  upcomingTasks: UpcomingTask[];
  recentCompletions: RecentCompletion[];
  requestsSummary: RequestsSummary;
  mowingSchedules: MowingSchedule[];
};

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending: { bg: '#F3E5F5', text: '#7B1FA2' },
  in_progress: { bg: '#E0F7FA', text: '#00838F' },
  completed: { bg: '#E8F5E9', text: '#2E7D32' },
  submitted: { bg: '#E3F2FD', text: '#1565C0' },
  acknowledged: { bg: '#FFF3E0', text: '#E65100' },
};

const SERVICE_TYPE_LABELS: Record<string, string> = {
  mowing_visit: 'Mowing',
  mowing: 'Mowing',
  fertilization: 'Fertilization',
  irrigation_check: 'Irrigation Check',
  snow_removal: 'Snow Removal',
};

const QUICK_MAP_BUTTONS = [
  { key: 'community', label: 'Community', icon: 'home-outline' as const, color: '#3498db' },
  { key: 'irrigation', label: 'Irrigation', icon: 'water-outline' as const, color: '#25C1AC' },
  { key: 'trees', label: 'Trees', icon: 'leaf-outline' as const, color: '#27ae60' },
  { key: 'snow', label: 'Snow', icon: 'snow-outline' as const, color: '#5C6BC0' },
];

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function formatSeasonRange(start: string | null, end: string | null): string | null {
  if (!start || !end) return null;
  const [sm, sd] = start.split('-').map(Number);
  const [em, ed] = end.split('-').map(Number);
  return `${MONTH_SHORT[sm - 1]} ${sd} - ${MONTH_SHORT[em - 1]} ${ed}`;
}

function isInSeason(schedule: MowingSchedule, date: Date): boolean {
  if (!schedule.seasonStart || !schedule.seasonEnd) return true;
  const mm = date.getMonth() + 1;
  const dd = date.getDate();
  const current = mm * 100 + dd;
  const [sm, sd] = schedule.seasonStart.split('-').map(Number);
  const [em, ed] = schedule.seasonEnd.split('-').map(Number);
  const startVal = sm * 100 + sd;
  const endVal = em * 100 + ed;
  if (startVal <= endVal) return current >= startVal && current <= endVal;
  return current >= startVal || current <= endVal;
}

function getNextServiceDate(schedule: MowingSchedule): Date | null {
  const today = new Date();
  for (let i = 0; i < 14; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    if (d.getDay() === schedule.dayOfWeek && isInSeason(schedule, d)) return d;
  }
  return null;
}

function formatServiceType(type: string): string {
  return SERVICE_TYPE_LABELS[type] || type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export default function HoaDashboardScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { activeCommunity } = useCommunity();
  const navyHeaderProps = useNavyHeaderProps();
  const isHoaAdmin = user?.role === 'hoa_admin';
  const [showCreateRequest, setShowCreateRequest] = useState(false);

  const { data, isLoading, isRefetching, refetch, isError } = useQuery<DashboardData>({
    queryKey: ['/api/hoa/dashboard'],
  });

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom + 90;

  if (isLoading) {
    return (
      <View style={styles.container}>
        <StatusBarFill />
        <NavyHeader {...navyHeaderProps}>
          <View style={ss.subtitleRow}>
            <Text style={ss.subtitleText}>DASHBOARD</Text>
            <View style={ss.subtitleActions} />
          </View>
        </NavyHeader>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#25C1AC" />
        </View>
      </View>
    );
  }

  if (isError || !data) {
    return (
      <View style={styles.container}>
        <StatusBarFill />
        <NavyHeader {...navyHeaderProps}>
          <View style={ss.subtitleRow}>
            <Text style={ss.subtitleText}>DASHBOARD</Text>
            <View style={ss.subtitleActions} />
          </View>
        </NavyHeader>
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={48} color="#e74c3c" />
          <Text style={styles.errorText}>Failed to load dashboard</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={handleRefresh}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const { upcomingTasks, recentCompletions, requestsSummary, mowingSchedules } = data;
  const today = new Date();

  return (
    <View style={styles.container}>
      <StatusBarFill />
      <NavyHeader {...navyHeaderProps}>
        <View style={ss.subtitleRow}>
          <Text style={ss.subtitleText}>DASHBOARD</Text>
          <View style={ss.subtitleActions}>
            {isHoaAdmin && <NotificationBell />}
          </View>
        </View>
      </NavyHeader>

      <ScrollView
        contentContainerStyle={{ paddingBottom: bottomPad }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={handleRefresh}
            tintColor="#25C1AC"
            colors={['#25C1AC']}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Upcoming Tasks</Text>
          <TouchableOpacity onPress={() => router.push('/(hoa-tabs)/calendar')}>
            <View style={styles.sectionAction}>
              <Ionicons name="calendar-outline" size={16} color="#25C1AC" />
              <Text style={styles.sectionActionText}>Calendar</Text>
            </View>
          </TouchableOpacity>
        </View>
        {upcomingTasks.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="checkmark-done-outline" size={28} color="#ccc" />
            <Text style={styles.emptyText}>No upcoming tasks</Text>
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.horizontalScroll}
          >
            {upcomingTasks.map((task) => {
              const statusColor = STATUS_COLORS[task.status] ?? { bg: '#ECEFF1', text: '#546E7A' };
              const isRequest = task.origin === 'HOA';
              const isUrgent = task.priority === 'urgent';
              return (
                <View key={task.id} style={styles.taskCard}>
                  <View style={styles.taskCardTop}>
                    {isRequest && (
                      <View style={styles.originBadge}>
                        <Text style={styles.originBadgeText}>REQUEST</Text>
                      </View>
                    )}
                    {isUrgent && (
                      <View style={styles.urgentBadge}>
                        <Ionicons name="alert-circle" size={10} color="#D32F2F" />
                        <Text style={styles.urgentBadgeText}>Urgent</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.taskCardTitle} numberOfLines={2}>{task.title}</Text>
                  <View style={[styles.statusChip, { backgroundColor: statusColor.bg }]}>
                    <Text style={[styles.statusChipText, { color: statusColor.text }]}>
                      {task.status.replace('_', ' ')}
                    </Text>
                  </View>
                  {(task.windowStart || task.dueDate) && (
                    <View style={styles.taskDateRow}>
                      <Ionicons name="time-outline" size={12} color="#999" />
                      <Text style={styles.taskDateText}>
                        {task.windowStart
                          ? `${formatDate(task.windowStart)}${task.windowEnd ? ` - ${formatDate(task.windowEnd)}` : ''}`
                          : formatDate(task.dueDate)}
                      </Text>
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>
        )}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Quick Map Layers</Text>
        </View>
        <View style={styles.mapGrid}>
          {QUICK_MAP_BUTTONS.map((btn) => (
            <TouchableOpacity
              key={btn.key}
              style={styles.mapGridBtn}
              onPress={() => router.push(`/(hoa-tabs)/map?category=${btn.key}`)}
              activeOpacity={0.7}
            >
              <View style={[styles.mapGridIcon, { backgroundColor: btn.color + '18' }]}>
                <Ionicons name={btn.icon} size={24} color={btn.color} />
              </View>
              <Text style={styles.mapGridLabel}>{btn.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Service Schedule</Text>
        </View>
        {mowingSchedules.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="leaf-outline" size={28} color="#ccc" />
            <Text style={styles.emptyText}>No service schedules configured</Text>
          </View>
        ) : (
          <View style={styles.mowingCard}>
            <View style={styles.mowingHeaderRow}>
              <View style={styles.mowingIconCircle}>
                <Ionicons name="leaf" size={18} color="#27ae60" />
              </View>
              <Text style={styles.mowingCardTitle}>Service Schedule</Text>
            </View>
            {mowingSchedules.map((schedule) => {
              const inSeason = isInSeason(schedule, today);
              const nextDate = getNextServiceDate(schedule);
              const isToday = nextDate && nextDate.toDateString() === today.toDateString();
              const seasonRange = formatSeasonRange(schedule.seasonStart, schedule.seasonEnd);

              return (
                <View key={schedule.id} style={styles.mowingRow}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.mowingDayRow}>
                      <Text style={styles.mowingServiceType}>
                        {formatServiceType(schedule.serviceType)}
                      </Text>
                      <View style={[styles.dayBadge, isToday && styles.dayBadgeToday]}>
                        <Text style={[styles.dayBadgeText, isToday && styles.dayBadgeTodayText]}>
                          {DAY_NAMES[schedule.dayOfWeek]}s
                        </Text>
                      </View>
                    </View>
                    {!inSeason ? (
                      <Text style={styles.offSeason}>
                        Off season{seasonRange ? ` · Season: ${seasonRange}` : ''}
                      </Text>
                    ) : nextDate ? (
                      <View>
                        <Text style={styles.nextDate}>
                          {isToday ? 'Today' : `Next: ${nextDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`}
                        </Text>
                        {seasonRange && <Text style={styles.seasonRange}>Season: {seasonRange}</Text>}
                      </View>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        )}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent Completions</Text>
        </View>
        {recentCompletions.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="checkmark-circle-outline" size={28} color="#ccc" />
            <Text style={styles.emptyText}>No recent completions</Text>
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.horizontalScroll}
          >
            {recentCompletions.map((comp) => {
              const isRequest = comp.origin === 'HOA';
              return (
                <View key={comp.id} style={styles.completionCard}>
                  <View style={styles.completionCardTop}>
                    {isRequest && (
                      <View style={styles.originBadge}>
                        <Text style={styles.originBadgeText}>REQUEST</Text>
                      </View>
                    )}
                    {comp.hasPhotos && (
                      <View style={styles.photoBadge}>
                        <Ionicons name="camera-outline" size={12} color="#25C1AC" />
                      </View>
                    )}
                  </View>
                  <Text style={styles.completionTitle} numberOfLines={2}>{comp.title}</Text>
                  <View style={styles.completionDateRow}>
                    <Ionicons name="checkmark-circle" size={12} color="#27ae60" />
                    <Text style={styles.completionDateText}>{formatDateTime(comp.completedAt)}</Text>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        )}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Requests</Text>
          <TouchableOpacity onPress={() => router.push('/(hoa-tabs)/requests')}>
            <Text style={styles.viewAllText}>View All</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.requestsCard}>
          <View style={styles.requestCountRow}>
            <View style={styles.requestCountBox}>
              <Text style={styles.requestCountNum}>{requestsSummary.submittedCount}</Text>
              <Text style={styles.requestCountLabel}>Submitted</Text>
            </View>
            <View style={styles.requestCountDivider} />
            <View style={styles.requestCountBox}>
              <Text style={styles.requestCountNum}>{requestsSummary.acknowledgedCount}</Text>
              <Text style={styles.requestCountLabel}>Acknowledged</Text>
            </View>
          </View>
          {requestsSummary.topRequests.length > 0 && (
            <View style={styles.topRequestsList}>
              {requestsSummary.topRequests.map((req) => {
                const statusColor = STATUS_COLORS[req.status] ?? { bg: '#ECEFF1', text: '#546E7A' };
                const isUrgent = req.priority === 'urgent';
                return (
                  <TouchableOpacity
                    key={req.id}
                    style={styles.topRequestRow}
                    onPress={() => router.push(`/task/${req.id}`)}
                    activeOpacity={0.7}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.topRequestTitle} numberOfLines={1}>{req.title}</Text>
                      <Text style={styles.topRequestDate}>{formatDateTime(req.createdAt)}</Text>
                    </View>
                    <View style={{ flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 }}>
                      {isUrgent && <Ionicons name="alert-circle" size={14} color="#D32F2F" />}
                      <View style={[styles.statusChipSmall, { backgroundColor: statusColor.bg }]}>
                        <Text style={[styles.statusChipSmallText, { color: statusColor.text }]}>
                          {req.status.replace('_', ' ')}
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
          {isHoaAdmin && (
            <TouchableOpacity
              style={styles.createRequestBtn}
              onPress={() => setShowCreateRequest(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="add-circle-outline" size={18} color="#fff" />
              <Text style={styles.createRequestBtnText}>Create Request</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>

      <CreateRequestSheet
        visible={showCreateRequest}
        onClose={() => {
          setShowCreateRequest(false);
          queryClient.invalidateQueries({ queryKey: ['/api/hoa/dashboard'] });
          queryClient.invalidateQueries({ queryKey: ['/api/hoa/requests'] });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  centered: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    padding: 20,
  },
  errorText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: '#555',
    marginTop: 12,
  },
  retryBtn: {
    marginTop: 16,
    backgroundColor: '#25C1AC',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 10,
  },
  retryBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600' as const,
  },
  sectionHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 10,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: '#0C1D31',
  },
  sectionAction: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
  },
  sectionActionText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: '#25C1AC',
  },
  viewAllText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: '#25C1AC',
  },
  horizontalScroll: {
    paddingHorizontal: 16,
    gap: 12,
  },
  emptyCard: {
    marginHorizontal: 20,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 24,
    alignItems: 'center' as const,
    gap: 8,
  },
  emptyText: {
    fontSize: 14,
    color: '#999',
  },
  taskCard: {
    width: 200,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  taskCardTop: {
    flexDirection: 'row' as const,
    gap: 6,
    marginBottom: 6,
    flexWrap: 'wrap' as const,
  },
  originBadge: {
    backgroundColor: '#E0F2F1',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  originBadgeText: {
    fontSize: 9,
    fontWeight: '700' as const,
    color: '#25C1AC',
    letterSpacing: 0.8,
  },
  urgentBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 3,
    backgroundColor: '#FFEBEE',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  urgentBadgeText: {
    fontSize: 9,
    fontWeight: '700' as const,
    color: '#D32F2F',
  },
  taskCardTitle: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#1a1a1a',
    marginBottom: 8,
    lineHeight: 19,
  },
  statusChip: {
    alignSelf: 'flex-start' as const,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginBottom: 8,
  },
  statusChipText: {
    fontSize: 11,
    fontWeight: '600' as const,
    textTransform: 'capitalize' as const,
  },
  taskDateRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
  },
  taskDateText: {
    fontSize: 11,
    color: '#999',
  },
  mapGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    paddingHorizontal: 16,
    gap: 12,
  },
  mapGridBtn: {
    width: '47%' as any,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center' as const,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  mapGridIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: 8,
  },
  mapGridLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: '#333',
  },
  mowingCard: {
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
  mowingHeaderRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 12,
  },
  mowingIconCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#27ae6015',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  mowingCardTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#0C1D31',
    flex: 1,
  },
  mowingRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  mowingDayRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  mowingServiceType: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: '#0C1D31',
  },
  dayBadge: {
    backgroundColor: '#e8f5e9',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  dayBadgeToday: {
    backgroundColor: '#25C1AC',
  },
  dayBadgeText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: '#27ae60',
  },
  dayBadgeTodayText: {
    color: '#fff',
  },
  nextDate: {
    fontSize: 13,
    color: '#888',
    marginTop: 3,
  },
  offSeason: {
    fontSize: 13,
    color: '#bbb',
    marginTop: 3,
    fontStyle: 'italic' as const,
  },
  seasonRange: {
    fontSize: 11,
    color: '#aaa',
    marginTop: 2,
  },
  completionCard: {
    width: 180,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  completionCardTop: {
    flexDirection: 'row' as const,
    gap: 6,
    marginBottom: 6,
  },
  photoBadge: {
    backgroundColor: '#E0F7FA',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  completionTitle: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: '#1a1a1a',
    marginBottom: 8,
    lineHeight: 18,
  },
  completionDateRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
  },
  completionDateText: {
    fontSize: 11,
    color: '#27ae60',
  },
  requestsCard: {
    marginHorizontal: 16,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  requestCountRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginBottom: 12,
  },
  requestCountBox: {
    flex: 1,
    alignItems: 'center' as const,
  },
  requestCountNum: {
    fontSize: 28,
    fontWeight: '700' as const,
    color: '#0C1D31',
  },
  requestCountLabel: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
  },
  requestCountDivider: {
    width: 1,
    height: 40,
    backgroundColor: '#eee',
  },
  topRequestsList: {
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    paddingTop: 8,
  },
  topRequestRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f5f5f5',
  },
  topRequestTitle: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: '#333',
  },
  topRequestDate: {
    fontSize: 11,
    color: '#999',
    marginTop: 2,
  },
  statusChipSmall: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusChipSmallText: {
    fontSize: 10,
    fontWeight: '600' as const,
    textTransform: 'capitalize' as const,
  },
  createRequestBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: '#25C1AC',
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 12,
    gap: 6,
  },
  createRequestBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600' as const,
  },
});
