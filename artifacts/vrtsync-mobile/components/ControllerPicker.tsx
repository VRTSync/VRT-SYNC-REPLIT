import React, { useEffect } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity,
  FlatList, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/query-client';

export type ControllerZone = {
  id: string;
  label: string;
  featureRef: string | null;
  zoneNumber: number | null;
  zoneType: string | null;
  zoneLabelShort: string | null;
  zoneColor: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type ControllerRow = {
  id: string;
  label: string;
  featureRef: string | null;
  controllerKey: string;
  controllerColor: string;
  latitude: number | null;
  longitude: number | null;
  zoneCount: number;
  zones: ControllerZone[];
};

type Props = {
  visible: boolean;
  communityId: string;
  onSelect: (controller: ControllerRow) => void;
  onAddNewController: () => void;
  onClose: () => void;
  highlightedControllerId?: string | null;
};

export default function ControllerPicker({
  visible, communityId, onSelect, onAddNewController, onClose, highlightedControllerId,
}: Props) {
  const insets = useSafeAreaInsets();

  const { data: controllers, isLoading, refetch } = useQuery<ControllerRow[]>({
    queryKey: [`/api/communities/${communityId}/controllers`],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/communities/${communityId}/controllers`);
      return res.json();
    },
    enabled: visible && !!communityId,
    staleTime: 10_000,
  });

  useEffect(() => {
    if (visible) refetch();
  }, [visible]);

  const renderController = ({ item }: { item: ControllerRow }) => {
    const isHighlighted = item.id === highlightedControllerId;
    return (
      <TouchableOpacity
        style={[styles.row, isHighlighted && styles.rowHighlighted]}
        onPress={() => onSelect(item)}
        activeOpacity={0.7}
      >
        <View style={[styles.colorCircle, { backgroundColor: item.controllerColor }]}>
          <Text style={styles.keyLetter}>{item.controllerKey}</Text>
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowLabel} numberOfLines={1}>{item.label}</Text>
          <Text style={styles.rowSub}>{item.zoneCount} zone{item.zoneCount !== 1 ? 's' : ''}</Text>
        </View>
        <View style={[styles.zoneChip, { borderColor: item.controllerColor }]}>
          <Text style={[styles.zoneChipText, { color: item.controllerColor }]}>{item.zoneCount}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#bbb" />
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <Text style={styles.title}>Select Parent Controller</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color="#6b7280" />
          </TouchableOpacity>
        </View>

        {isLoading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator size="large" color="#25C1AC" />
            <Text style={styles.loadingText}>Loading controllers…</Text>
          </View>
        ) : !controllers || controllers.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="git-network-outline" size={44} color="#d1d5db" />
            <Text style={styles.emptyTitle}>No controllers yet</Text>
            <Text style={styles.emptySub}>Add a controller first, then zones can be linked to it.</Text>
          </View>
        ) : (
          <FlatList
            data={controllers}
            keyExtractor={(item) => item.id}
            renderItem={renderController}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          />
        )}

        <TouchableOpacity style={styles.addRow} onPress={onAddNewController} activeOpacity={0.8}>
          <View style={styles.addCircle}>
            <Ionicons name="add" size={20} color="#25C1AC" />
          </View>
          <Text style={styles.addText}>+ Add a new Controller</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '75%',
    minHeight: 260,
    paddingTop: 12,
    paddingHorizontal: 0,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#e5e7eb',
    alignSelf: 'center',
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  title: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    color: '#0C1D31',
  },
  closeBtn: {
    padding: 4,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
    gap: 12,
  },
  rowHighlighted: {
    backgroundColor: '#f0fdfb',
    borderRadius: 10,
  },
  colorCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  keyLetter: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.25)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  rowBody: {
    flex: 1,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0C1D31',
  },
  rowSub: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 1,
  },
  zoneChip: {
    borderWidth: 1.5,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
    minWidth: 28,
    alignItems: 'center',
  },
  zoneChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 24,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#6b7280',
  },
  emptySub: {
    fontSize: 13,
    color: '#9ca3af',
    textAlign: 'center',
    lineHeight: 18,
  },
  loadingState: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 10,
  },
  loadingText: {
    fontSize: 14,
    color: '#9ca3af',
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
    gap: 12,
  },
  addCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: '#25C1AC',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#25C1AC',
  },
});
