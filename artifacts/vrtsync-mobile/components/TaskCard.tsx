import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { CardVariant, CardAction, MetadataField } from '@/constants/taskPageRoleConfig';

export type TaskCardItem = {
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
  createdAt: string;
  origin?: string | null;
};

type PendingCompletion = {
  taskId: string;
  state: string;
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

function toDateOnly(s: string): Date {
  const d = s.includes('T') ? s.split('T')[0] : s;
  return new Date(d + 'T00:00:00');
}

function diffDays(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

function getUrgencyChip(task: TaskCardItem, today: Date): { label: string; color: string; bg: string } | null {
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

function formatWindowRange(task: TaskCardItem): string | null {
  if (!task.windowStart || !task.windowEnd) return null;
  const s = toDateOnly(task.windowStart);
  const e = toDateOnly(task.windowEnd);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${s.toLocaleDateString('en-US', opts)} – ${e.toLocaleDateString('en-US', opts)}`;
}

type TaskCardProps = {
  item: TaskCardItem;
  cardVariant: CardVariant;
  visibleActions: CardAction[];
  visibleMetadata: MetadataField[];
  today: Date;
  pendingCompletion?: PendingCompletion | null;
  acknowledgingId?: string | null;
  onPress: () => void;
  onAcknowledge?: (task: TaskCardItem) => void;
};

export default function TaskCard({
  item,
  cardVariant,
  visibleActions,
  visibleMetadata,
  today,
  pendingCompletion,
  acknowledgingId,
  onPress,
  onAcknowledge,
}: TaskCardProps) {
  const isHoa = item.origin === 'HOA';
  const isCompleted = item.status === 'completed';
  const urgency = getUrgencyChip(item, today);
  const windowRange = visibleMetadata.includes('windowRange') ? formatWindowRange(item) : null;

  const showAcknowledge =
    visibleActions.includes('acknowledge') &&
    isHoa &&
    item.status === 'submitted' &&
    cardVariant !== 'readOnly';

  return (
    <TouchableOpacity
      style={[
        styles.taskCard,
        isHoa && styles.hoaTaskCard,
        isCompleted && styles.completedCard,
        cardVariant === 'compact' && styles.compactCard,
        cardVariant === 'readOnly' && styles.readOnlyCard,
      ]}
      onPress={onPress}
      activeOpacity={0.7}
      testID={`task-${item.id}`}
    >
      <View style={styles.taskHeader}>
        <View style={[styles.priorityDot, { backgroundColor: priorityColors[item.priority] }]} />
        <Text style={[styles.taskTitle, isCompleted && styles.completedTitle, cardVariant === 'compact' && styles.compactTitle]} numberOfLines={1}>
          {item.title}
        </Text>
        {isHoa && visibleMetadata.includes('originBadge') ? (
          <View style={styles.hoaBadge}>
            <Text style={styles.hoaBadgeText}>HOA REQUEST</Text>
          </View>
        ) : null}
        {pendingCompletion ? (
          <View style={[styles.statusBadge, {
            backgroundColor: pendingCompletion.state === 'failed' ? '#ffebee' : '#fff3e0',
          }]}>
            <Text style={[styles.statusText, {
              color: pendingCompletion.state === 'failed' ? '#c62828' : '#e65100',
            }]}>
              {pendingCompletion.state === 'failed' ? 'Sync Error' : pendingCompletion.state === 'syncing' ? 'Syncing' : 'Queued'}
            </Text>
          </View>
        ) : urgency ? (
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

      {isHoa ? (
        <View style={styles.hoaMetaRow}>
          <View style={[styles.hoaPriorityChip, item.priority === 'urgent' && styles.hoaPriorityUrgent]}>
            <Text style={[styles.hoaPriorityText, item.priority === 'urgent' && styles.hoaPriorityUrgentText]}>
              {item.priority === 'urgent' ? 'Urgent' : 'Normal'}
            </Text>
          </View>
          <View style={[styles.hoaStatusChip, { backgroundColor: statusColors[item.status] + '20' }]}>
            <Text style={[styles.hoaStatusText, { color: statusColors[item.status] }]}>
              {statusLabels[item.status]}
            </Text>
          </View>
        </View>
      ) : null}

      {cardVariant !== 'compact' && item.description ? (
        <Text style={styles.taskDescription} numberOfLines={2}>{item.description}</Text>
      ) : null}

      <View style={styles.taskFooter}>
        {windowRange ? (
          <View style={styles.taskMeta}>
            <Ionicons name="time-outline" size={12} color="#999" />
            <Text style={styles.metaText}>{windowRange}</Text>
          </View>
        ) : null}
        {visibleMetadata.includes('address') && item.address ? (
          <View style={styles.taskMeta}>
            <Ionicons name="location-outline" size={12} color="#999" />
            <Text style={styles.metaText} numberOfLines={1}>{item.address}</Text>
          </View>
        ) : null}
        {!windowRange && visibleMetadata.includes('dueDate') && item.dueDate ? (
          <View style={styles.taskMeta}>
            <Ionicons name="calendar-outline" size={12} color="#999" />
            <Text style={styles.metaText}>
              {new Date(item.dueDate).toLocaleDateString()}
            </Text>
          </View>
        ) : null}
        {visibleMetadata.includes('assignedTo') && item.assignedTo ? (
          <View style={styles.taskMeta}>
            <Ionicons name="person-outline" size={12} color="#999" />
            <Text style={styles.metaText}>{item.assignedTo}</Text>
          </View>
        ) : null}
        {showAcknowledge && onAcknowledge ? (
          <TouchableOpacity
            style={styles.acknowledgeButton}
            onPress={(e) => {
              e.stopPropagation();
              onAcknowledge(item);
            }}
            disabled={acknowledgingId === item.id}
            activeOpacity={0.7}
          >
            <Ionicons name="checkmark-circle-outline" size={16} color="#fff" />
            <Text style={styles.acknowledgeButtonText}>
              {acknowledgingId === item.id ? 'Acknowledging...' : 'Acknowledge'}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
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
  compactCard: {
    padding: 12,
    marginBottom: 8,
  },
  readOnlyCard: {
    opacity: 0.95,
  },
  hoaTaskCard: {
    borderLeftWidth: 3,
    borderLeftColor: '#7c4dff',
  },
  completedCard: {
    backgroundColor: '#fff',
    borderLeftWidth: 4,
    borderLeftColor: '#4caf50',
    borderWidth: 1,
    borderColor: '#4caf50',
  },
  taskHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  priorityDot: { width: 8, height: 8, borderRadius: 4 },
  taskTitle: { flex: 1, fontSize: 16, fontWeight: '600', color: '#0C1D31' },
  compactTitle: { fontSize: 14 },
  completedTitle: { color: '#2E7D32' },
  hoaBadge: {
    backgroundColor: '#ede7f6',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  hoaBadgeText: {
    fontSize: 9,
    fontWeight: '700' as const,
    color: '#6a1b9a',
    letterSpacing: 0.5,
  },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 11, fontWeight: '600' },
  hoaMetaRow: {
    flexDirection: 'row' as const,
    gap: 8,
    marginTop: 6,
  },
  hoaPriorityChip: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: '#e8eaed',
  },
  hoaPriorityUrgent: {
    backgroundColor: '#ffebee',
  },
  hoaPriorityText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: '#666',
  },
  hoaPriorityUrgentText: {
    color: '#c62828',
  },
  hoaStatusChip: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  hoaStatusText: {
    fontSize: 11,
    fontWeight: '600' as const,
  },
  taskDescription: { fontSize: 14, color: '#666', marginTop: 8, lineHeight: 20 },
  taskFooter: { flexDirection: 'row', gap: 16, marginTop: 12, flexWrap: 'wrap' },
  taskMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 12, color: '#999' },
  acknowledgeButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    backgroundColor: '#1565c0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginLeft: 'auto' as const,
  },
  acknowledgeButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600' as const,
  },
});
