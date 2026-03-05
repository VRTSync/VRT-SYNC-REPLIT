import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import StatusBarFill from '@/components/StatusBarFill';
import CalendarView from '@/components/CalendarView';

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: 'pending' | 'in_progress' | 'completed';
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

type FilterKey = 'all' | 'requests' | 'non-requests';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'requests', label: 'Requests' },
  { key: 'non-requests', label: 'Non-Requests' },
];

export default function HoaCalendarScreen() {
  const router = useRouter();
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');

  const { data: tasks, isLoading } = useQuery<Task[]>({
    queryKey: ['/api/tasks'],
  });

  const filteredTasks = useMemo(() => {
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

  const handleTaskPress = useCallback((taskId: string) => {
    router.push(`/task/${taskId}` as any);
  }, [router]);

  const noopLogVisit = useCallback(() => {}, []);

  return (
    <View style={styles.container}>
      <StatusBarFill />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Calendar</Text>
      </View>

      <View style={styles.filterRow}>
        {FILTERS.map(f => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterChip, activeFilter === f.key && styles.filterChipActive]}
            onPress={() => setActiveFilter(f.key)}
            activeOpacity={0.7}
          >
            <Text style={[styles.filterChipText, activeFilter === f.key && styles.filterChipTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#25C1AC" />
        </View>
      ) : (
        <View style={styles.calendarScroll}>
          <CalendarView
            tasks={filteredTasks}
            schedules={[]}
            visits={[]}
            pendingVisits={[]}
            onTaskPress={handleTaskPress}
            onLogVisit={noopLogVisit}
            isOffline={false}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    backgroundColor: '#0C1D31',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
  },
  headerTitle: { color: '#fff', fontSize: 22, fontWeight: '700' as const },
  filterRow: {
    flexDirection: 'row' as const,
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#f0f2f5',
  },
  filterChipActive: {
    backgroundColor: '#25C1AC',
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: '#666',
  },
  filterChipTextActive: {
    color: '#fff',
  },
  centered: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  calendarScroll: {
    flex: 1,
  },
});
