import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

type FilterKey = 'all' | 'overdue' | 'requests' | 'scheduled' | 'completed';

export type SummaryCounts = {
  overdue: number;
  active: number;
  requests: number;
  completed: number;
};

type Pill = {
  color: string;
  count: number;
  label: string;
  filter: FilterKey;
};

type Props = {
  counts: SummaryCounts;
  labels?: { overdue: string; active: string; requests: string; completed: string };
  onStatPress: (filter: FilterKey) => void;
  activeFilter?: FilterKey;
};

const DEFAULT_HOA_LABELS = {
  overdue: 'Overdue',
  active: 'Active Tasks',
  requests: 'Requests',
  completed: 'Completed',
};

export default function WeeklySummaryCard({ counts, labels, onStatPress, activeFilter }: Props) {
  const lbl = labels ?? DEFAULT_HOA_LABELS;

  const pills: Pill[] = [
    { color: '#E53935', count: counts.overdue,   label: lbl.overdue,   filter: 'overdue' },
    { color: '#F9A825', count: counts.active,    label: lbl.active,    filter: 'scheduled' },
    { color: '#1E88E5', count: counts.requests,  label: lbl.requests,  filter: 'requests' },
    { color: '#43A047', count: counts.completed, label: lbl.completed, filter: 'completed' },
  ];

  return (
    <View style={styles.card}>
      {pills.map((pill, i) => (
        <TouchableOpacity
          key={pill.filter + i}
          style={[styles.pill, activeFilter === pill.filter && styles.pillActive]}
          onPress={() => onStatPress(pill.filter)}
          activeOpacity={0.7}
          testID={`summary-pill-${pill.filter}`}
        >
          <View style={[styles.dot, { backgroundColor: pill.color }]} />
          <Text style={styles.count}>{pill.count}</Text>
          <Text style={styles.label} numberOfLines={1}>{pill.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
    gap: 4,
  },
  pill: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 10,
    backgroundColor: '#f5f7fa',
    gap: 2,
  },
  pillActive: {
    backgroundColor: '#EBF9F7',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginBottom: 2,
  },
  count: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0C1D31',
    lineHeight: 24,
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    color: '#777',
    textAlign: 'center',
    letterSpacing: 0.2,
  },
});
