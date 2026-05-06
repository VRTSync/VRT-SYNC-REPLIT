import React, { useMemo } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: 'pending' | 'in_progress' | 'completed' | 'submitted' | 'acknowledged';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  windowStart: string | null;
  windowEnd: string | null;
  dueDate: string | null;
  origin?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  createdAt: string;
};

type Section = {
  key: 'overdue' | 'active' | 'requests' | 'completed';
  label: string;
  color: string;
  bg: string;
  tasks: Task[];
};

type Props = {
  visible: boolean;
  dateStr: string | null;
  tasks: Task[];
  onClose: () => void;
  onTaskPress: (taskId: string) => void;
  onViewOnMap: (task: Task) => void;
  role?: string;
};

function getTodayStr(): string {
  const now = new Date();
  return now.toLocaleDateString('en-CA', { timeZone: 'America/Denver' });
}

function formatDayLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}

function taskFallsOnDay(task: Task, dateStr: string): boolean {
  const hasWindow = task.windowStart && task.windowEnd;
  if (hasWindow) {
    return task.windowStart! <= dateStr && task.windowEnd! >= dateStr;
  }
  if (task.dueDate) {
    const dd = task.dueDate.includes('T') ? task.dueDate.split('T')[0] : task.dueDate;
    return dd === dateStr;
  }
  return false;
}

export default function DayWorkSheet({
  visible, dateStr, tasks, onClose, onTaskPress, onViewOnMap, role,
}: Props) {
  const insets = useSafeAreaInsets();
  const todayStr = getTodayStr();

  const sections: Section[] = useMemo(() => {
    if (!dateStr) return [];

    const dayTasks = tasks.filter(t => taskFallsOnDay(t, dateStr));

    const overdueTasks = dayTasks.filter(t =>
      t.status !== 'completed' &&
      t.dueDate &&
      (t.dueDate.includes('T') ? t.dueDate.split('T')[0] : t.dueDate) < todayStr
    );

    const requestTasks = dayTasks.filter(t =>
      t.origin === 'HOA' &&
      t.status !== 'completed' &&
      !overdueTasks.includes(t)
    );

    const activeTasks = dayTasks.filter(t =>
      t.origin !== 'HOA' &&
      t.status !== 'completed' &&
      !overdueTasks.includes(t)
    );

    const completedTasks = dayTasks.filter(t => t.status === 'completed');

    const result: Section[] = [];

    if (overdueTasks.length > 0) {
      result.push({
        key: 'overdue',
        label: 'Overdue',
        color: '#C62828',
        bg: '#FFEBEE',
        tasks: overdueTasks,
      });
    }
    if (activeTasks.length > 0) {
      result.push({
        key: 'active',
        label: 'Active',
        color: '#E65100',
        bg: '#FFF3E0',
        tasks: activeTasks,
      });
    }
    if (requestTasks.length > 0) {
      result.push({
        key: 'requests',
        label: 'Requests',
        color: '#1565C0',
        bg: '#E3F2FD',
        tasks: requestTasks,
      });
    }
    if (completedTasks.length > 0) {
      result.push({
        key: 'completed',
        label: 'Completed',
        color: '#2E7D32',
        bg: '#E8F5E9',
        tasks: completedTasks,
      });
    }

    return result;
  }, [dateStr, tasks, todayStr]);

  const totalCount = sections.reduce((sum, s) => sum + s.tasks.length, 0);

  const bottomPad = Platform.OS === 'ios' ? insets.bottom : Platform.OS === 'web' ? 34 : 20;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={sheetStyles.backdrop}
        activeOpacity={1}
        onPress={onClose}
      />
      <View style={[sheetStyles.sheet, { paddingBottom: bottomPad }]}>
        <View style={sheetStyles.handle} />

        <View style={sheetStyles.header}>
          <View style={{ flex: 1 }}>
            <Text style={sheetStyles.title}>
              {dateStr ? formatDayLabel(dateStr) : ''}
            </Text>
            {totalCount > 0 && (
              <Text style={sheetStyles.subtitle}>
                {totalCount} item{totalCount !== 1 ? 's' : ''}
              </Text>
            )}
          </View>
          <TouchableOpacity onPress={onClose} style={sheetStyles.closeBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={22} color="#555" />
          </TouchableOpacity>
        </View>

        <ScrollView
          style={sheetStyles.scrollView}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {sections.length === 0 ? (
            <View style={sheetStyles.emptyState}>
              <Ionicons name="calendar-outline" size={44} color="#ccc" />
              <Text style={sheetStyles.emptyTitle}>No work scheduled</Text>
              <Text style={sheetStyles.emptySubtitle}>Nothing is due or active on this day</Text>
            </View>
          ) : (
            sections.map((section) => (
              <View key={section.key} style={sheetStyles.section}>
                <View style={[sheetStyles.sectionHeader, { backgroundColor: section.bg }]}>
                  <View style={[sheetStyles.sectionDot, { backgroundColor: section.color }]} />
                  <Text style={[sheetStyles.sectionLabel, { color: section.color }]}>
                    {section.label}
                  </Text>
                  <View style={[sheetStyles.sectionCount, { backgroundColor: section.color + '20' }]}>
                    <Text style={[sheetStyles.sectionCountText, { color: section.color }]}>
                      {section.tasks.length}
                    </Text>
                  </View>
                </View>

                {section.tasks.map((task) => {
                  const hasLocation = task.latitude != null && task.longitude != null;
                  return (
                    <TouchableOpacity
                      key={task.id}
                      style={sheetStyles.taskRow}
                      onPress={() => { onClose(); onTaskPress(task.id); }}
                      activeOpacity={0.7}
                      testID={`day-sheet-task-${task.id}`}
                    >
                      <View style={[sheetStyles.statusDot, { backgroundColor: section.color }]} />
                      <View style={sheetStyles.taskInfo}>
                        <Text style={sheetStyles.taskTitle} numberOfLines={2}>
                          {task.title}
                        </Text>
                        {task.origin === 'HOA' && section.key !== 'requests' && (
                          <View style={sheetStyles.hoaBadge}>
                            <Text style={sheetStyles.hoaBadgeText}>HOA</Text>
                          </View>
                        )}
                      </View>
                      <View style={sheetStyles.taskActions}>
                        {hasLocation && (
                          <TouchableOpacity
                            style={sheetStyles.mapBtn}
                            onPress={() => { onClose(); onViewOnMap(task); }}
                            activeOpacity={0.7}
                            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                          >
                            <Ionicons name="map-outline" size={14} color="#25C1AC" />
                            <Text style={sheetStyles.mapBtnText}>Map</Text>
                          </TouchableOpacity>
                        )}
                        <Ionicons name="chevron-forward" size={16} color="#ccc" />
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))
          )}
          <View style={{ height: 16 }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

const sheetStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    maxHeight: '75%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 20,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#ddd',
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
  },
  title: {
    fontSize: 19,
    fontWeight: '700',
    color: '#0C1D31',
  },
  subtitle: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollView: {
    flex: 1,
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 48,
    paddingBottom: 32,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#555',
    marginTop: 14,
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#aaa',
    marginTop: 6,
    textAlign: 'center',
  },
  section: {
    marginTop: 12,
    marginHorizontal: 16,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#eee',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 9,
    gap: 8,
  },
  sectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    flex: 1,
  },
  sectionCount: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
  },
  sectionCountText: {
    fontSize: 11,
    fontWeight: '700',
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#f3f3f3',
    gap: 10,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
  },
  taskInfo: {
    flex: 1,
    gap: 4,
  },
  taskTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#0C1D31',
    lineHeight: 20,
  },
  hoaBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#fff3e0',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  hoaBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#e65100',
  },
  taskActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  mapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#E0FAF7',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  mapBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#25C1AC',
  },
});
