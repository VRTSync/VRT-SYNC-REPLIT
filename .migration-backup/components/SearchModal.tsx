import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, FlatList, TouchableOpacity, Modal,
  StyleSheet, ActivityIndicator, Platform, Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '@/lib/theme';
import { apiRequest } from '@/lib/query-client';
import { useCommunity } from '@/client/contexts/CommunityContext';
import { useOffline } from '@/client/contexts/OfflineContext';
import { useOfflinePack } from '@/client/contexts/OfflinePackContext';

type SearchResult = {
  id: string;
  type: 'asset' | 'task';
  label: string;
  assetType?: string;
  status?: string;
  priority?: string;
  dueDate?: string | null;
  communityId: string;
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
  relevance: number;
  matchField?: string;
  isOffline?: boolean;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onSelectAsset?: (asset: SearchResult) => void;
  onSelectTask?: (task: SearchResult) => void;
  onShowOnMap?: (result: SearchResult) => void;
};

const assetTypeIcons: Record<string, string> = {
  controller: 'hardware-chip-outline',
  backflow: 'git-network-outline',
  zone: 'water-outline',
  tree: 'leaf-outline',
  pet_station: 'paw-outline',
  landscape_bed: 'flower-outline',
  bluegrass_area: 'grid-outline',
  native_area: 'earth-outline',
  snow_area: 'snow-outline',
};

const statusColors: Record<string, string> = {
  pending: Colors.warning,
  in_progress: Colors.accent,
  completed: Colors.success,
};

const priorityColors: Record<string, string> = {
  low: Colors.success,
  medium: Colors.warning,
  high: Colors.error,
  urgent: Colors.purple,
};

export default function SearchModal({ visible, onClose, onSelectAsset, onSelectTask, onShowOnMap }: Props) {
  const insets = useSafeAreaInsets();
  const { activeCommunity } = useCommunity();
  const { isOnline } = useOffline();
  const { searchOffline, hasSearchIndex } = useOfflinePack();
  const inputRef = useRef<TextInput>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [usingOffline, setUsingOffline] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (visible) {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setQuery('');
      setResults([]);
      setSearched(false);
      setUsingOffline(false);
    }
  }, [visible]);

  const doSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    setSearched(true);

    if (!isOnline && hasSearchIndex) {
      setUsingOffline(true);
      setLoading(false);
      const offlineResults = searchOffline(q);
      setResults(offlineResults);
      return;
    }

    setUsingOffline(false);
    setLoading(true);
    try {
      const params = new URLSearchParams({ q: q.trim() });
      if (activeCommunity?.id) params.set('communityId', activeCommunity.id);
      const res = await apiRequest('GET', `/api/search?${params.toString()}`);
      const data = await res.json();
      setResults(data);
    } catch {
      if (hasSearchIndex) {
        setUsingOffline(true);
        const offlineResults = searchOffline(q);
        setResults(offlineResults);
      } else {
        setResults([]);
      }
    } finally {
      setLoading(false);
    }
  }, [activeCommunity?.id, isOnline, hasSearchIndex, searchOffline]);

  const handleChangeText = (text: string) => {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(text), 300);
  };

  const assetResults = results.filter(r => r.type === 'asset');
  const taskResults = results.filter(r => r.type === 'task');

  const renderAssetItem = (item: SearchResult) => (
    <TouchableOpacity
      key={item.id}
      style={styles.resultItem}
      onPress={() => { onSelectAsset?.(item); onClose(); }}
      activeOpacity={0.7}
    >
      <View style={styles.resultIcon}>
        <Ionicons
          name={(assetTypeIcons[item.assetType || ''] || 'cube-outline') as any}
          size={20}
          color={Colors.accent}
        />
      </View>
      <View style={styles.resultContent}>
        <Text style={styles.resultLabel} numberOfLines={1}>{item.label}</Text>
        <View style={styles.resultMeta}>
          <View style={[styles.badge, { backgroundColor: Colors.accentLight }]}>
            <Text style={[styles.badgeText, { color: Colors.accent }]}>
              {(item.assetType || 'asset').replace(/_/g, ' ')}
            </Text>
          </View>
          {item.isOffline && (
            <View style={[styles.badge, { backgroundColor: Colors.warning + '20' }]}>
              <Text style={[styles.badgeText, { color: Colors.warning }]}>offline</Text>
            </View>
          )}
          {item.matchField && item.matchField !== 'label' && (
            <Text style={styles.matchHint}>matched: {item.matchField}</Text>
          )}
        </View>
      </View>
      {item.latitude && item.longitude && onShowOnMap && (
        <TouchableOpacity
          style={styles.mapButton}
          onPress={(e) => { e.stopPropagation(); onShowOnMap(item); onClose(); }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="navigate-outline" size={18} color={Colors.accent} />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );

  const renderTaskItem = (item: SearchResult) => (
    <TouchableOpacity
      key={item.id}
      style={styles.resultItem}
      onPress={() => { onSelectTask?.(item); onClose(); }}
      activeOpacity={0.7}
    >
      <View style={styles.resultIcon}>
        <Ionicons name="checkmark-circle-outline" size={20} color={statusColors[item.status || 'pending'] || Colors.textMuted} />
      </View>
      <View style={styles.resultContent}>
        <Text style={styles.resultLabel} numberOfLines={1}>{item.label}</Text>
        <View style={styles.resultMeta}>
          <View style={[styles.badge, { backgroundColor: (statusColors[item.status || ''] || Colors.textMuted) + '20' }]}>
            <Text style={[styles.badgeText, { color: statusColors[item.status || ''] || Colors.textMuted }]}>
              {(item.status || 'pending').replace(/_/g, ' ')}
            </Text>
          </View>
          {item.priority && (
            <View style={[styles.priorityDot, { backgroundColor: priorityColors[item.priority] || Colors.textMuted }]} />
          )}
          {item.address && (
            <Text style={styles.addressText} numberOfLines={1}>{item.address}</Text>
          )}
        </View>
      </View>
      {item.latitude && item.longitude && onShowOnMap && (
        <TouchableOpacity
          style={styles.mapButton}
          onPress={(e) => { e.stopPropagation(); onShowOnMap(item); onClose(); }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="navigate-outline" size={18} color={Colors.accent} />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );

  const sections: { title: string; icon: string; data: SearchResult[]; render: (item: SearchResult) => React.ReactElement }[] = [];
  if (assetResults.length > 0) sections.push({ title: 'Assets', icon: 'cube-outline', data: assetResults, render: renderAssetItem });
  if (taskResults.length > 0) sections.push({ title: 'Tasks', icon: 'checkmark-done-outline', data: taskResults, render: renderTaskItem });

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.container, { paddingTop: Platform.OS === 'web' ? 67 : insets.top }]}>
        <View style={styles.header}>
          <View style={styles.searchBar}>
            <Ionicons name="search" size={18} color={Colors.textMuted} style={{ marginRight: 8 }} />
            <TextInput
              ref={inputRef}
              style={styles.searchInput}
              placeholder="Search assets, tasks..."
              placeholderTextColor={Colors.textMuted}
              value={query}
              onChangeText={handleChangeText}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              onSubmitEditing={() => doSearch(query)}
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => { setQuery(''); setResults([]); setSearched(false); inputRef.current?.focus(); }}>
                <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity onPress={onClose} style={styles.cancelButton}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>

        {usingOffline && searched && (
          <View style={styles.offlineBanner}>
            <Ionicons name="cloud-offline-outline" size={14} color={Colors.warning} />
            <Text style={styles.offlineBannerText}>Searching offline data</Text>
          </View>
        )}

        {!isOnline && !hasSearchIndex && searched && (
          <View style={styles.offlineBanner}>
            <Ionicons name="warning-outline" size={14} color={Colors.error} />
            <Text style={styles.offlineBannerText}>No offline search data — download a map pack first</Text>
          </View>
        )}

        {loading && (
          <View style={styles.centerState}>
            <ActivityIndicator size="small" color={Colors.accent} />
          </View>
        )}

        {!loading && searched && results.length === 0 && (
          <View style={styles.centerState}>
            <Ionicons name="search-outline" size={40} color={Colors.border} />
            <Text style={styles.emptyText}>No results found</Text>
          </View>
        )}

        {!loading && !searched && (
          <View style={styles.centerState}>
            <Ionicons name="search" size={40} color={Colors.border} />
            <Text style={styles.emptyText}>Search by name, serial number, address...</Text>
          </View>
        )}

        {!loading && results.length > 0 && (
          <FlatList
            data={sections}
            keyExtractor={(section) => section.title}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
            renderItem={({ item: section }) => (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons name={section.icon as any} size={16} color={Colors.textSecondary} />
                  <Text style={styles.sectionTitle}>{section.title}</Text>
                  <Text style={styles.sectionCount}>{section.data.length}</Text>
                </View>
                {section.data.map(section.render)}
              </View>
            )}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.backgroundSecondary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: Colors.background,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 40,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: Colors.text,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}),
  },
  cancelButton: {
    marginLeft: 12,
    paddingVertical: 6,
  },
  cancelText: {
    fontSize: 16,
    color: Colors.accent,
    fontWeight: '500',
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.textMuted,
  },
  section: {
    marginTop: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionCount: {
    fontSize: 12,
    color: Colors.textMuted,
    marginLeft: 4,
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  resultIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.backgroundSecondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  resultContent: {
    flex: 1,
  },
  resultLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: Colors.text,
    marginBottom: 4,
  },
  resultMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  matchHint: {
    fontSize: 11,
    color: Colors.textMuted,
    fontStyle: 'italic',
  },
  priorityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  addressText: {
    fontSize: 12,
    color: Colors.textMuted,
    flex: 1,
  },
  mapButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: Colors.warning + '10',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.warning + '30',
  },
  offlineBannerText: {
    fontSize: 12,
    color: Colors.warning,
    fontWeight: '500',
  },
});
