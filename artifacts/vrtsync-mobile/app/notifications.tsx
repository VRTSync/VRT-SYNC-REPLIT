import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, SectionList, TouchableOpacity,
  ActivityIndicator, RefreshControl, Platform, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path, Circle, Ellipse } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useFocusEffect } from 'expo-router';
import { apiRequest } from '@/lib/query-client';
import StatusBarFill from '@/components/StatusBarFill';
import SyncBar from '@/components/SyncBar';
import { useTimeTick } from '@/hooks/useTimeTick';

type NotificationItem = {
  id: string;
  communityId: string;
  recipientUserId: string;
  type: string;
  title: string;
  body: string;
  relatedTaskId: string | null;
  createdAt: string;
  readAt: string | null;
};

type Section = {
  title: string;
  data: NotificationItem[];
};

const TYPE_ICONS: Record<string, { name: keyof typeof Ionicons.glyphMap; color: string }> = {
  TASK_ASSIGNED: { name: 'person-add-outline', color: '#3498db' },
  TASK_DUE_REMINDER: { name: 'alarm-outline', color: '#f39c12' },
  TASK_COMPLETED: { name: 'checkmark-circle', color: '#4caf50' },
  HOA_REQUEST_ACKNOWLEDGED: { name: 'checkmark-circle-outline', color: '#4caf50' },
  HOA_REQUEST_COMPLETED: { name: 'checkmark-done-circle', color: '#25C1AC' },
  HOA_REQUEST_SUBMITTED: { name: 'mail-unread', color: '#3498db' },
};

function getDateLabel(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const itemDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (itemDay.getTime() === today.getTime()) return 'Today';
  if (itemDay.getTime() === yesterday.getTime()) return 'Yesterday';
  const isCurrentYear = date.getFullYear() === now.getFullYear();
  return isCurrentYear
    ? date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
    : date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function groupByDate(notifications: NotificationItem[]): Section[] {
  const groups: Record<string, NotificationItem[]> = {};
  const order: string[] = [];

  for (const n of notifications) {
    const label = getDateLabel(n.createdAt);
    if (!groups[label]) {
      groups[label] = [];
      order.push(label);
    }
    groups[label].push(n);
  }

  return order.map(label => ({ title: label, data: groups[label] }));
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function EmptyBellIllustration() {
  return (
    <Svg width={100} height={100} viewBox="0 0 100 100" fill="none">
      <Circle cx={50} cy={50} r={48} fill="#EEF2F8" />
      <Path
        d="M50 18a3 3 0 0 1 3 3v1.8A20 20 0 0 1 70 42v10l5.2 7.8A2.5 2.5 0 0 1 73 64H27a2.5 2.5 0 0 1-2.2-4.2L30 52V42A20 20 0 0 1 47 22.8V21a3 3 0 0 1 3-3Z"
        fill="#C9D6E8"
      />
      <Path
        d="M44 64a6 6 0 0 0 12 0H44Z"
        fill="#B0BDD0"
      />
      <Circle cx={68} cy={30} r={8} fill="#E0E6EF" />
      <Ellipse cx={50} cy={50} rx={18} ry={3} fill="rgba(0,0,0,0.06)" />
    </Svg>
  );
}

function EmptyState() {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.08, duration: 1400, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1400, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, []);

  return (
    <View style={emptyStyles.container}>
      <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
        <EmptyBellIllustration />
      </Animated.View>
      <Text style={emptyStyles.headline}>You're all caught up</Text>
      <Text style={emptyStyles.subtitle}>No new notifications right now.{'\n'}Check back later for updates.</Text>
    </View>
  );
}

const emptyStyles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 32,
  },
  headline: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0C1D31',
    marginTop: 24,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#8A9BB0',
    marginTop: 10,
    textAlign: 'center',
    lineHeight: 21,
  },
});

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const tick = useTimeTick();

  const { data: notifications, isLoading, refetch, isRefetching, dataUpdatedAt } = useQuery<NotificationItem[]>({
    queryKey: ['/api/notifications'],
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

  const handleSyncNow = useCallback(async () => {
    const result = await refetch();
    if (result.error) throw result.error;
    setLastSyncedAt(new Date());
  }, [refetch]);

  const handleMarkAllRead = useCallback(async () => {
    try {
      await apiRequest('PUT', '/api/notifications/read-all');
      queryClient.invalidateQueries({ queryKey: ['/api/notifications'] });
      queryClient.invalidateQueries({ queryKey: ['/api/notifications/unread-count'] });
    } catch {}
  }, [queryClient]);

  useFocusEffect(
    useCallback(() => {
      apiRequest('PUT', '/api/notifications/read-all')
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ['/api/notifications'] });
          queryClient.invalidateQueries({ queryKey: ['/api/notifications/unread-count'] });
        })
        .catch(() => {});
    }, [queryClient]),
  );

  const handleTapNotification = useCallback(async (item: NotificationItem) => {
    if (!item.readAt) {
      try {
        await apiRequest('PUT', `/api/notifications/${item.id}/read`);
        queryClient.invalidateQueries({ queryKey: ['/api/notifications'] });
        queryClient.invalidateQueries({ queryKey: ['/api/notifications/unread-count'] });
      } catch {}
    }
    if (item.relatedTaskId) {
      router.push(`/task/${item.relatedTaskId}` as any);
    }
  }, [queryClient, router]);

  const renderItem = useCallback(({ item }: { item: NotificationItem }) => {
    const isUnread = !item.readAt;
    const iconConfig = TYPE_ICONS[item.type] || { name: 'notifications' as const, color: '#999' };

    return (
      <TouchableOpacity
        style={[styles.notifCard, isUnread && styles.notifCardUnread]}
        onPress={() => handleTapNotification(item)}
        activeOpacity={0.7}
        testID={`notification-${item.id}`}
      >
        <View style={[styles.iconCircle, { backgroundColor: iconConfig.color + '18' }]}>
          <Ionicons name={iconConfig.name} size={22} color={iconConfig.color} />
        </View>
        <View style={styles.notifContent}>
          <Text style={[styles.notifTitle, isUnread && styles.notifTitleUnread]} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.notifBody} numberOfLines={2}>{item.body}</Text>
          <Text style={styles.notifTime}>{timeAgo(item.createdAt)}</Text>
        </View>
        {isUnread && <View style={styles.unreadDot} />}
        {item.relatedTaskId && (
          <Ionicons name="chevron-forward" size={16} color="#ccc" style={{ marginLeft: 4 }} />
        )}
      </TouchableOpacity>
    );
  }, [handleTapNotification, tick]);

  const renderSectionHeader = useCallback(({ section }: { section: Section }) => (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeaderText}>{section.title}</Text>
    </View>
  ), []);

  const hasUnread = notifications?.some(n => !n.readAt);
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const sections = groupByDate(notifications || []);

  return (
    <View style={styles.container}>
      <StatusBarFill />
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="notifications-back">
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notifications</Text>
        {hasUnread && (
          <TouchableOpacity onPress={handleMarkAllRead} style={styles.markAllBtn} testID="mark-all-read">
            <Text style={styles.markAllText}>Mark all read</Text>
          </TouchableOpacity>
        )}
      </View>

      <SyncBar
        onSync={handleSyncNow}
        isSyncing={isRefetching}
        lastSyncedAt={lastSyncedAt}
      />

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#25C1AC" />
        </View>
      ) : (notifications || []).length === 0 ? (
        <EmptyState />
      ) : (
        <SectionList
          sections={sections}
          renderItem={renderItem}
          renderSectionHeader={renderSectionHeader}
          keyExtractor={item => item.id}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: Platform.OS === 'web' ? 34 : insets.bottom + 20 },
          ]}
          stickySectionHeadersEnabled={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor="#25C1AC"
              colors={['#25C1AC']}
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f6fa',
  },
  header: {
    backgroundColor: '#0C1D31',
    paddingHorizontal: 20,
    paddingBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backBtn: {
    marginRight: 12,
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
  },
  markAllBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: 'rgba(37,193,172,0.2)',
    borderRadius: 12,
  },
  markAllText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#25C1AC',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    padding: 16,
  },
  sectionHeader: {
    paddingVertical: 6,
    paddingHorizontal: 4,
    marginBottom: 6,
    marginTop: 4,
  },
  sectionHeaderText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#8A9BB0',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  notifCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  notifCardUnread: {
    backgroundColor: '#f0faff',
    borderLeftWidth: 3,
    borderLeftColor: '#25C1AC',
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  notifContent: {
    flex: 1,
  },
  notifTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
    marginBottom: 2,
  },
  notifTitleUnread: {
    fontWeight: '700',
    color: '#0C1D31',
  },
  notifBody: {
    fontSize: 13,
    color: '#666',
    marginBottom: 3,
  },
  notifTime: {
    fontSize: 11,
    color: '#999',
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#25C1AC',
    marginLeft: 8,
  },
});
