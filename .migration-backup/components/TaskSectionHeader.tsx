import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export type SectionHeaderAccent = 'overdue' | 'active' | 'urgent' | 'hoa' | 'default';

type TaskSectionHeaderProps = {
  title: string;
  count: number;
  accent?: SectionHeaderAccent;
};

function getAccentColor(accent: SectionHeaderAccent): string {
  switch (accent) {
    case 'overdue': return '#c62828';
    case 'active': return '#25C1AC';
    case 'urgent': return '#c62828';
    case 'hoa': return '#6a1b9a';
    default: return '#888';
  }
}

function inferAccent(title: string): SectionHeaderAccent {
  const lower = title.toLowerCase();
  if (lower === 'overdue' || lower.includes('overdue')) return 'overdue';
  if (lower === 'active window' || lower.includes('active')) return 'active';
  if (lower.includes('urgent')) return 'urgent';
  if (lower.includes('hoa')) return 'hoa';
  return 'default';
}

export default function TaskSectionHeader({ title, count, accent }: TaskSectionHeaderProps) {
  const resolvedAccent = accent ?? inferAccent(title);
  const color = getAccentColor(resolvedAccent);

  return (
    <View style={styles.sectionHeaderRow}>
      <Text style={[styles.sectionHeader, { color }]}>
        {title}
      </Text>
      <View style={styles.sectionCountBadge}>
        <Text style={styles.sectionCountText}>{count}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionCountBadge: {
    backgroundColor: '#e8eaed',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  sectionCountText: { fontSize: 11, fontWeight: '700', color: '#666' },
});
