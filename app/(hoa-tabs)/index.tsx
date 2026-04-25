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
import { apiRequest } from '@/lib/query-client';
import StatusBarFill from '@/components/StatusBarFill';
import NavyHeader, { subtitleStyles as ss } from '@/components/NavyHeader';
import { useNavyHeaderProps } from '@/components/useNavyHeaderProps';
import CreateRequestSheet from '@/components/CreateRequestSheet';
import NotificationBell from '@/components/NotificationBell';
import SyncBar from '@/components/SyncBar';
import { getRoleCopy } from '@/constants/roleCopy';

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

type WaterUsageRow = {
  year: number;
  month: number;
  usage_amount: number;
  unit: string | null;
};

type HoaRequestItem = {
  id: string;
  title: string;
  priority: string;
  status: string;
  createdAt: string;
  assignedTo: string | null;
};

type AttentionItem = {
  id: string;
  label: string;
  reason: string;
  color: string;
  type: 'task' | 'request';
};

type ServiceVisit = {
  id: string;
  serviceDate: string;
};

type DashboardData = {
  community: { id: string; name: string } | null;
  upcomingTasks: UpcomingTask[];
  recentCompletions: RecentCompletion[];
  requestsSummary: RequestsSummary;
  mowingSchedules: MowingSchedule[];
};

type RoleDashboardViewModel = {
  role: string;
  communityId: string;
  hoaRequests?: {
    byLifecycleStatus: {
      submittedCount: number;
      acknowledgedCount: number;
      inProgressCount: number;
      completedRecentCount: number;
    };
    recentCommunityCompletions: RecentCompletion[];
    upcomingWorkWindows: UpcomingTask[];
    mapLayerAvailability: { layerKey: string; subLayerKey: string; displayName: string }[];
    mowingSchedules: MowingSchedule[];
  };
  communityActivity?: {
    recentCompletions: RecentCompletion[];
    upcomingCommunityWork: UpcomingTask[];
    serviceSchedules: MowingSchedule[];
    requestsSummary: RequestsSummary;
  };
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
  const copy = getRoleCopy(user?.role);
  const [showCreateRequest, setShowCreateRequest] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  const { data: roleData, isLoading, isRefetching, refetch, isError, dataUpdatedAt } = useQuery<RoleDashboardViewModel>({
    queryKey: ['/api/dashboard/role'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/dashboard/role');
      return res.json();
    },
    enabled: !!user,
    retry: 1,
    staleTime: 0,
  });

  const data: DashboardData | undefined = React.useMemo(() => {
    if (!roleData) return undefined;
    if (roleData.hoaRequests) {
      const hr = roleData.hoaRequests;
      return {
        community: { id: roleData.communityId, name: activeCommunity?.name ?? '' },
        upcomingTasks: hr.upcomingWorkWindows,
        recentCompletions: hr.recentCommunityCompletions,
        requestsSummary: {
          submittedCount: hr.byLifecycleStatus.submittedCount,
          acknowledgedCount: hr.byLifecycleStatus.acknowledgedCount,
          topRequests: [],
        },
        mowingSchedules: hr.mowingSchedules,
      };
    }
    if (roleData.communityActivity) {
      const ca = roleData.communityActivity;
      return {
        community: { id: roleData.communityId, name: activeCommunity?.name ?? '' },
        upcomingTasks: ca.upcomingCommunityWork,
        recentCompletions: ca.recentCompletions,
        requestsSummary: ca.requestsSummary,
        mowingSchedules: ca.serviceSchedules,
      };
    }
    return undefined;
  }, [roleData, activeCommunity?.name]);

  const weekRange = React.useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sun = new Date(today);
    sun.setDate(today.getDate() - today.getDay());
    const sat = new Date(sun);
    sat.setDate(sun.getDate() + 6);
    return { from: sun.toISOString().slice(0, 10), to: sat.toISOString().slice(0, 10) };
  }, []);

  const communityId = activeCommunity?.id;

  const { data: serviceVisits = [] } = useQuery<ServiceVisit[]>({
    queryKey: [`/api/communities/${communityId}/service-visits?from=${weekRange.from}&to=${weekRange.to}`],
    enabled: !!communityId,
  });

  const { data: waterUsage = [] } = useQuery<WaterUsageRow[]>({
    queryKey: [`/api/reports/water-usage?communityId=${communityId}`],
    enabled: !!communityId,
  });

  const { data: hoaRequests = [] } = useQuery<HoaRequestItem[]>({
    queryKey: ['/api/hoa/requests'],
  });

  const attentionItems: AttentionItem[] = React.useMemo(() => {
    const items: AttentionItem[] = [];
    const now = Date.now();
    const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
    const todayTs = new Date().setHours(0, 0, 0, 0);

    (data?.upcomingTasks ?? []).forEach(t => {
      if (t.status === 'completed') return;
      const end = t.windowEnd ? new Date(t.windowEnd).getTime() : null;
      if (end && end < todayTs) {
        items.push({ id: t.id, label: t.title || 'Untitled task', reason: 'Overdue', color: '#e74c3c', type: 'task' });
      }
    });

    hoaRequests.forEach(r => {
      if (r.status === 'completed') return;
      if (r.priority === 'urgent') {
        items.push({ id: r.id, label: r.title || 'Untitled request', reason: 'Urgent priority', color: '#9c27b0', type: 'request' });
        return;
      }
      const created = r.createdAt ? new Date(r.createdAt).getTime() : 0;
      if (!r.assignedTo && created && (now - created) > THREE_DAYS_MS) {
        items.push({ id: r.id, label: r.title || 'Untitled request', reason: 'Unassigned 3+ days', color: '#f39c12', type: 'request' });
      }
    });

    return items;
  }, [data?.upcomingTasks, hoaRequests]);

  const sortedWater = React.useMemo(() => {
    return waterUsage.slice().sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      return a.month - b.month;
    });
  }, [waterUsage]);

  React.useEffect(() => {
    if (dataUpdatedAt > 0) {
      setLastSyncedAt(prev => {
        const queryDate = new Date(dataUpdatedAt);
        if (!prev || queryDate > prev) return queryDate;
        return prev;
      });
    }
  }, [dataUpdatedAt]);

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const handleSyncNow = useCallback(async () => {
    const result = await refetch();
    if (result.error) throw result.error;
    setLastSyncedAt(new Date());
    try {
      await queryClient.invalidateQueries({ queryKey: ['/api/map-layers'] });
    } catch {}
  }, [refetch, queryClient]);

  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom + 90;

  if (!user || isLoading) {
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
  const inProgressCount = hoaRequests.filter(r => r.status === 'in_progress').length;
  const today = new Date();

  const activeMowingSchedule = mowingSchedules.length > 0 ? mowingSchedules[0] : null;
  const thisWeekServiceDate = activeMowingSchedule ? (() => {
    const d = new Date(today);
    const sundayOffset = today.getDay();
    d.setDate(today.getDate() - sundayOffset + activeMowingSchedule.dayOfWeek);
    return d.toISOString().slice(0, 10);
  })() : null;
  const visitLoggedThisWeek = thisWeekServiceDate
    ? serviceVisits.some(v => v.serviceDate === thisWeekServiceDate)
    : false;

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

      <SyncBar
        onSync={handleSyncNow}
        isSyncing={isRefetching}
        lastSyncedAt={lastSyncedAt}
      />

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
        {/* ── 1. Requests Summary ── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{copy.sectionHeaders.requests}</Text>
          <TouchableOpacity onPress={() => router.push('/(hoa-tabs)/requests')}>
            <Text style={styles.viewAllText}>{copy.buttonLabels.viewAll}</Text>
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
            {hoaRequests.length > 0 && (
              <>
                <View style={styles.requestCountDivider} />
                <View style={styles.requestCountBox}>
                  <Text style={[styles.requestCountNum, inProgressCount > 0 ? { color: '#00838F' } : {}]}>{inProgressCount}</Text>
                  <Text style={styles.requestCountLabel}>In Progress</Text>
                </View>
              </>
            )}
          </View>
        </View>

        {/* ── 2. Create Request CTA ── */}
        {isHoaAdmin && (
          <View style={styles.createRequestCTAWrapper}>
            <TouchableOpacity
              style={styles.createRequestCTA}
              onPress={() => setShowCreateRequest(true)}
              activeOpacity={0.85}
              testID="create-request-cta"
            >
              <View style={styles.createRequestCTAIcon}>
                <Ionicons name="add" size={22} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.createRequestCTATitle}>Create a Request</Text>
                <Text style={styles.createRequestCTASub}>Report an issue or service need for your community</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.7)" />
            </TouchableOpacity>
          </View>
        )}

        {/* ── 3. Attention Required ── */}
        <View style={styles.ccCard}>
          <View style={styles.ccCardHeader}>
            <Ionicons name="alert-circle-outline" size={16} color="#e74c3c" />
            <Text style={styles.ccCardTitle}>Attention Required</Text>
            {attentionItems.length > 0 && (
              <View style={styles.ccAttnBadge}>
                <Text style={styles.ccAttnBadgeText}>{attentionItems.length}</Text>
              </View>
            )}
          </View>
          {attentionItems.length === 0 ? (
            <View style={styles.ccAllClear}>
              <Ionicons name="checkmark-circle" size={16} color="#25C1AC" />
              <Text style={styles.ccAllClearText}>{copy.emptyStates.allClear}</Text>
            </View>
          ) : (
            <View>
              {attentionItems.slice(0, 8).map((item, i) => (
                <TouchableOpacity
                  key={item.id + i}
                  style={styles.ccAttnRow}
                  activeOpacity={0.7}
                  onPress={isHoaAdmin ? () => {
                    if (item.type === 'request') {
                      router.push({ pathname: '/(hoa-tabs)/requests', params: { requestId: item.id } });
                    } else {
                      router.push({ pathname: '/(hoa-tabs)/calendar', params: { taskId: item.id } });
                    }
                  } : undefined}
                  testID={`attention-item-${item.id}`}
                >
                  <View style={[styles.ccAttnDot, { backgroundColor: item.color }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.ccAttnLabel} numberOfLines={1}>{item.label}</Text>
                    <Text style={styles.ccAttnReason}>{item.reason}</Text>
                  </View>
                  {isHoaAdmin && <Ionicons name="chevron-forward" size={14} color="#ccc" />}
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* ── 4. Upcoming Tasks ── */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { flex: 1, marginRight: 8 }]} numberOfLines={1}>
            What's coming up in your community
          </Text>
          <TouchableOpacity onPress={() => router.push('/(hoa-tabs)/calendar')}>
            <View style={styles.sectionAction}>
              <Ionicons name="calendar-outline" size={16} color="#25C1AC" />
              <Text style={styles.sectionActionText}>Calendar</Text>
            </View>
          </TouchableOpacity>
        </View>
        {upcomingTasks.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="sunny-outline" size={28} color="#ccc" />
            <Text style={styles.emptyText}>Nothing scheduled yet — check back soon.</Text>
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

        {/* ── 5. Recent Completions ── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent Completions</Text>
        </View>
        {recentCompletions.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="checkmark-circle-outline" size={28} color="#ccc" />
            <Text style={styles.emptyText}>No recent work has been logged for your community yet.</Text>
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
                  <View style={styles.completionStatusRow}>
                    <View style={[styles.statusChipSmall, { backgroundColor: '#E8F5E9' }]}>
                      <Text style={[styles.statusChipSmallText, { color: '#2E7D32' }]}>Completed</Text>
                    </View>
                  </View>
                  <View style={styles.completionDateRow}>
                    <Ionicons name="checkmark-circle" size={12} color="#27ae60" />
                    <Text style={styles.completionDateText}>{formatDateTime(comp.completedAt)}</Text>
                  </View>
                  <TouchableOpacity style={styles.viewOnMapBtn} disabled>
                    <Ionicons name="map-outline" size={12} color="#aaa" />
                    <Text style={styles.viewOnMapText}>View on map</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </ScrollView>
        )}

        {/* ── 6. Service Schedule (consolidated) ── */}
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
            {activeMowingSchedule && (
              <Text style={[styles.ccVisitLabel, visitLoggedThisWeek ? styles.ccVisitLogged : styles.ccVisitPending, { marginBottom: 4 }]}>
                {visitLoggedThisWeek ? 'This week: Logged ✓' : 'This week: Not yet logged'}
              </Text>
            )}
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
                      <View style={[styles.ccBadge, inSeason ? styles.ccBadgeGreen : styles.ccBadgeGray]}>
                        <Text style={[styles.ccBadgeText, inSeason ? styles.ccBadgeTextGreen : styles.ccBadgeTextGray]}>
                          {inSeason ? 'In Season' : 'Off Season'}
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

        {/* ── 7. Quick Map Layers ── */}
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

        {/* ── 8. Water Usage ── */}
        <View style={styles.ccCard}>
          <View style={styles.ccCardHeader}>
            <Ionicons name="water-outline" size={16} color="#2196F3" />
            <Text style={styles.ccCardTitle}>Water Usage</Text>
          </View>
          {sortedWater.length === 0 ? (
            <Text style={styles.ccEmpty}>No water usage data recorded yet</Text>
          ) : (() => {
            const last6 = sortedWater.slice(-6);
            const latest = sortedWater[sortedWater.length - 1];
            const maxAmt = Math.max(...last6.map(r => r.usage_amount));
            const MONTH_ABBR = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            return (
              <View>
                <View style={styles.ccWaterLatest}>
                  <Text style={styles.ccWaterValue}>
                    {latest.usage_amount.toLocaleString()} {latest.unit ?? ''}
                  </Text>
                  <Text style={styles.ccWaterPeriod}>{MONTH_ABBR[latest.month]} {latest.year}</Text>
                </View>
                <View style={styles.ccSparkline}>
                  {last6.map((r, i) => {
                    const pct = maxAmt > 0 ? r.usage_amount / maxAmt : 0;
                    const h = Math.max(4, Math.round(pct * 36));
                    const isLatest = r.year === latest.year && r.month === latest.month;
                    return (
                      <View key={i} style={styles.ccSparkCol}>
                        <View style={[styles.ccSparkBar, { height: h }, isLatest && styles.ccSparkBarHi]} />
                        <Text style={styles.ccSparkLabel}>{MONTH_ABBR[r.month]}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            );
          })()}
        </View>

      </ScrollView>

      <CreateRequestSheet
        visible={showCreateRequest}
        onClose={() => {
          setShowCreateRequest(false);
          queryClient.invalidateQueries({ queryKey: ['/api/dashboard/role'] });
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
  createRequestCTAWrapper: {
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  createRequestCTA: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: '#0C1D31',
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 16,
    gap: 12,
    shadowColor: '#0C1D31',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  createRequestCTAIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#25C1AC',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  createRequestCTATitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#fff',
  },
  createRequestCTASub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 2,
  },
  completionStatusRow: {
    marginBottom: 6,
  },
  viewOnMapBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    marginTop: 8,
    opacity: 0.5,
  },
  viewOnMapText: {
    fontSize: 11,
    color: '#666',
    fontWeight: '500' as const,
  },

  ccCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  ccCardHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 12,
  },
  ccCardTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: '#0C1D31',
    flex: 1,
  },
  ccEmpty: {
    fontSize: 13,
    color: '#aaa',
    fontStyle: 'italic' as const,
  },

  ccBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  ccBadgeGreen: { backgroundColor: '#E8F5E9' },
  ccBadgeGray: { backgroundColor: '#ECEFF1' },
  ccBadgeText: {
    fontSize: 11,
    fontWeight: '600' as const,
  },
  ccBadgeTextGreen: { color: '#2E7D32' },
  ccBadgeTextGray: { color: '#78909C' },
  ccVisitLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
  },
  ccVisitLogged: { color: '#27ae60' },
  ccVisitPending: { color: '#f39c12' },

  ccWaterLatest: {
    flexDirection: 'row' as const,
    alignItems: 'baseline' as const,
    gap: 8,
    marginBottom: 10,
  },
  ccWaterValue: {
    fontSize: 22,
    fontWeight: '700' as const,
    color: '#0C1D31',
  },
  ccWaterPeriod: {
    fontSize: 12,
    color: '#999',
  },
  ccSparkline: {
    flexDirection: 'row' as const,
    alignItems: 'flex-end' as const,
    gap: 4,
    height: 56,
  },
  ccSparkCol: {
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'flex-end' as const,
  },
  ccSparkBar: {
    width: '100%' as any,
    backgroundColor: '#B0BEC5',
    borderRadius: 2,
  },
  ccSparkBarHi: {
    backgroundColor: '#2196F3',
  },
  ccSparkLabel: {
    fontSize: 9,
    color: '#aaa',
    marginTop: 3,
  },

  ccAttnBadge: {
    backgroundColor: '#FFEBEE',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingHorizontal: 5,
  },
  ccAttnBadgeText: {
    color: '#e74c3c',
    fontSize: 11,
    fontWeight: '700' as const,
  },
  ccAllClear: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
  },
  ccAllClearText: {
    fontSize: 14,
    color: '#25C1AC',
    fontWeight: '600' as const,
  },
  ccAttnRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: '#f5f5f5',
  },
  ccAttnDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  ccAttnLabel: {
    fontSize: 13,
    fontWeight: '500' as const,
    color: '#333',
  },
  ccAttnReason: {
    fontSize: 11,
    color: '#999',
    marginTop: 1,
  },
});
