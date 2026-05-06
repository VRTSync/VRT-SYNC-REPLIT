import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Community } from '@/client/contexts/CommunityContext';

type NavyHeaderProps = {
  communityName: string;
  communities: Community[];
  activeCommunityId: string | undefined;
  onSwitchCommunity: (c: Community) => void;
  syncLabel: string;
  syncColor: string;
  children?: React.ReactNode;
};

export default function NavyHeader({
  communityName,
  communities,
  activeCommunityId,
  onSwitchCommunity,
  syncLabel,
  syncColor,
  children,
}: NavyHeaderProps) {
  const [showSwitcher, setShowSwitcher] = useState(false);
  const canSwitch = communities.length > 1;

  return (
    <>
      <View style={styles.titleBar}>
        <TouchableOpacity
          style={styles.communityNameRow}
          onPress={canSwitch ? () => setShowSwitcher(!showSwitcher) : undefined}
          activeOpacity={canSwitch ? 0.7 : 1}
        >
          <Text style={styles.communityName} numberOfLines={1}>
            {communityName}
          </Text>
          {canSwitch && (
            <Ionicons
              name={showSwitcher ? 'chevron-up' : 'chevron-down'}
              size={16}
              color="rgba(255,255,255,0.5)"
            />
          )}
        </TouchableOpacity>
        <View style={styles.syncBadge}>
          <View style={[styles.syncDot, { backgroundColor: syncColor }]} />
          <Text style={styles.syncBadgeText}>{syncLabel}</Text>
        </View>
      </View>
      {showSwitcher && canSwitch && (
        <View style={styles.switcherPanel}>
          {communities.map((c) => (
            <TouchableOpacity
              key={c.id}
              style={[styles.option, c.id === activeCommunityId && styles.optionActive]}
              onPress={() => { onSwitchCommunity(c); setShowSwitcher(false); }}
            >
              <Text style={[styles.optionText, c.id === activeCommunityId && styles.optionTextActive]}>
                {c.name}
              </Text>
              {c.id === activeCommunityId && <Ionicons name="checkmark" size={16} color="#25C1AC" />}
            </TouchableOpacity>
          ))}
        </View>
      )}
      {children}
    </>
  );
}

export const subtitleStyles = StyleSheet.create({
  subtitleRow: {
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
  },
  subtitleText: { fontSize: 13, fontWeight: '700', color: '#0C1D31', letterSpacing: 1.5 },
  subtitleActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f0f2f5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIconBtnActive: {
    backgroundColor: '#25C1AC',
  },
});

const styles = StyleSheet.create({
  titleBar: {
    backgroundColor: '#0C1D31',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  communityNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  communityName: { fontSize: 20, fontWeight: '700', color: '#fff' },
  syncBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  syncBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.5)',
  },
  syncDot: { width: 6, height: 6, borderRadius: 3 },
  switcherPanel: {
    backgroundColor: '#0C1D31',
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 8,
    marginBottom: 4,
  },
  optionActive: {
    backgroundColor: 'rgba(37,193,172,0.1)',
  },
  optionText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
  },
  optionTextActive: {
    color: '#25C1AC',
    fontWeight: '600',
  },
});
