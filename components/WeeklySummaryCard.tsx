import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export type SummaryFilterKey = 'overdue' | 'active' | 'requests' | 'completed' | null;

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
  filter: NonNullable<SummaryFilterKey>;
};

type Props = {
  counts: SummaryCounts;
  labels?: { overdue: string; active: string; requests: string; completed: string };
  onStatPress: (filter: NonNullable<SummaryFilterKey>) => void;
  activeSummaryFilter?: SummaryFilterKey;
};

const DEFAULT_HOA_LABELS = {
  overdue: 'Overdue',
  active: 'Active Tasks',
  requests: 'Requests',
  completed: 'Completed',
};

export default function WeeklySummaryCard({ counts, labels, onStatPress, activeSummaryFilter }: Props) {
  const lbl = labels ?? DEFAULT_HOA_LABELS;

  const pills: Pill[] = [
    { color: '#E53935', count: counts.overdue,   label: lbl.overdue,   filter: 'overdue' },
    { color: '#F9A825', count: counts.active,    label: lbl.active,    filter: 'active' },
    { color: '#1E88E5', count: counts.requests,  label: lbl.requests,  filter: 'requests' },
    { color: '#43A047', count: counts.completed, label: lbl.completed, filter: 'completed' },
  ];

  return (
    <View style={styles.card}>
      {pills.map((pill) => {
        const isActive = activeSummaryFilter === pill.filter;
        return (
          <TouchableOpacity
            key={pill.filter}
            style={[styles.pill, isActive && { backgroundColor: pill.color + '18', borderColor: pill.color, borderWidth: 1.5 }]}
            onPress={() => onStatPress(pill.filter)}
            activeOpacity={0.7}
            testID={`summary-pill-${pill.filter}`}
          >
            <View style={[styles.dot, { backgroundColor: pill.color }]} />
            <Text style={[styles.count, isActive && { color: pill.color }]}>{pill.count}</Text>
            <Text style={[styles.label, isActive && { color: pill.color }]} numberOfLines={1}>{pill.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
    gap: 4,
  },
  pill: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 4,
    borderRadius: 10,
    backgroundColor: '#f5f7fa',
    gap: 2,
    borderWidth: 1.5,
    borderColor: 'transparent',
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
