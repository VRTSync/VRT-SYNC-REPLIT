import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ScrollView, RefreshControl, ActivityIndicator, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/client/contexts/AuthContext';
import { useCommunity } from '@/client/contexts/CommunityContext';
import StatusBarFill from '@/components/StatusBarFill';
import NavyHeader, { subtitleStyles as ss } from '@/components/NavyHeader';
import { useNavyHeaderProps } from '@/components/useNavyHeaderProps';
import CreateRequestSheet from '@/components/CreateRequestSheet';
import SyncBar from '@/components/SyncBar';

let WebView: any = null;
if (Platform.OS !== 'web') {
  WebView = require('react-native-webview').WebView;
}

type ViewMode = 'list' | 'map';

type HoaRequest = {
  id: string;
  title: string;
  status: string;
  priority: string;
  createdAt: string;
  completedAt: string | null;
  isArchived: boolean;
  assetId: string | null;
  assetLabel: string | null;
  latitude: number | null;
  longitude: number | null;
  attachmentCount: number;
  category: string | null;
};

type FilterKey = 'all' | 'submitted' | 'acknowledged' | 'completed' | 'archived';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'acknowledged', label: 'Acknowledged' },
  { key: 'completed', label: 'Completed' },
  { key: 'archived', label: 'Archived' },
];

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  submitted: { bg: '#E3F2FD', text: '#1565C0' },
  acknowledged: { bg: '#FFF3E0', text: '#E65100' },
  completed: { bg: '#E8F5E9', text: '#2E7D32' },
  pending: { bg: '#F3E5F5', text: '#7B1FA2' },
  in_progress: { bg: '#E0F7FA', text: '#00838F' },
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function RequestCard({ item, onPress }: { item: HoaRequest; onPress: () => void }) {
  const statusColor = STATUS_COLORS[item.status] ?? { bg: '#ECEFF1', text: '#546E7A' };
  const isUrgent = item.priority === 'urgent' || item.priority === 'Urgent';
  const isCompleted = item.status === 'completed';

  return (
    <TouchableOpacity style={[styles.card, isCompleted && styles.completedCard]} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.cardTop}>
        <Text style={styles.requestLabel}>REQUEST</Text>
        {item.isArchived && <Text style={styles.archivedLabel}>ARCHIVED</Text>}
      </View>
      <Text style={[styles.cardTitle, isCompleted && styles.completedTitle]} numberOfLines={2}>{item.title}</Text>
      <View style={styles.badgeRow}>
        <View style={[styles.priorityBadge, { backgroundColor: isUrgent ? '#FFEBEE' : '#E0F2F1' }]}>
          <Ionicons
            name={isUrgent ? 'alert-circle' : 'flag'}
            size={12}
            color={isUrgent ? '#D32F2F' : '#25C1AC'}
          />
          <Text style={[styles.priorityText, { color: isUrgent ? '#D32F2F' : '#25C1AC' }]}>
            {isUrgent ? 'Urgent' : 'General'}
          </Text>
        </View>
        {!isCompleted && (
          <View style={[styles.statusChip, { backgroundColor: statusColor.bg }]}>
            <Text style={[styles.statusText, { color: statusColor.text }]}>
              {item.status.replace('_', ' ')}
            </Text>
          </View>
        )}
      </View>
      <View style={styles.metaRow}>
        <Ionicons name="time-outline" size={13} color="#999" />
        <Text style={styles.metaText}>{formatDate(item.createdAt)}</Text>
      </View>
      <View style={styles.metaRow}>
        <Ionicons name="location-outline" size={13} color="#999" />
        <Text style={styles.metaText}>
          {item.assetId ? (item.assetLabel || 'Attached asset') : 'Pinned location'}
        </Text>
        {item.attachmentCount > 0 && (
          <View style={styles.photoIndicator}>
            <Ionicons name="camera-outline" size={13} color="#25C1AC" />
            <Text style={styles.photoCount}>{item.attachmentCount}</Text>
          </View>
        )}
      </View>
      {item.category && (
        <View style={styles.metaRow}>
          <Ionicons name="pricetag-outline" size={13} color="#999" />
          <Text style={styles.metaText}>{item.category}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

function generateAllRequestsMapHTML(requests: HoaRequest[]): string {
  const escaped = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, "\\'").replace(/"/g, '&quot;');
  const markersJs = requests.map(r => {
    const color = r.priority === 'urgent' ? '#e74c3c' : '#25C1AC';
    const priorityLabel = r.priority === 'urgent' ? 'Urgent' : 'General';
    const statusLabel = r.status === 'submitted' ? 'Submitted' : r.status === 'acknowledged' ? 'Acknowledged' : r.status === 'completed' ? 'Completed' : r.status.charAt(0).toUpperCase() + r.status.slice(1);
    return `addPin(${r.latitude}, ${r.longitude}, '${color}', '${escaped(r.title)}', '${priorityLabel}', '${statusLabel}', '${r.id}');`;
  }).join('\n  ');

  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body, #map { width: 100%; height: 100%; }
  .pin-marker { width: 28px; height: 28px; position: relative; }
  .pin-inner {
    width: 28px; height: 28px; border-radius: 50% 50% 50% 0;
    border: 2.5px solid #fff;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    transform: rotate(-45deg);
    display: flex; align-items: center; justify-content: center;
  }
  .pin-icon {
    transform: rotate(45deg);
    color: #fff; font-size: 12px; font-weight: bold;
  }
  .leaflet-popup-content-wrapper {
    border-radius: 12px !important;
    box-shadow: 0 4px 20px rgba(0,0,0,0.15) !important;
  }
  .popup-content {
    font-family: -apple-system, system-ui, sans-serif;
    min-width: 170px;
  }
  .popup-label {
    font-size: 10px; font-weight: 700; letter-spacing: 1px;
    margin-bottom: 4px;
  }
  .popup-title {
    font-size: 14px; font-weight: 600; color: #0C1D31;
    margin-bottom: 8px; line-height: 1.3;
  }
  .popup-row { display: flex; gap: 6px; margin-bottom: 4px; }
  .popup-badge {
    display: inline-block; padding: 2px 8px; border-radius: 10px;
    font-size: 11px; font-weight: 600;
  }
  .popup-open-btn {
    display: block; margin-top: 10px; padding: 8px 0;
    text-align: center; background: #0C1D31; color: #fff;
    border-radius: 8px; font-size: 13px; font-weight: 600;
    cursor: pointer; border: none; width: 100%;
  }
  .user-dot {
    width: 14px; height: 14px; border-radius: 50%;
    background: #4285F4; border: 3px solid #fff;
    box-shadow: 0 1px 6px rgba(66,133,244,0.5);
  }
  .count-badge {
    position: fixed; top: 12px; right: 12px; z-index: 1000;
    background: #0C1D31; color: #fff; padding: 6px 14px;
    border-radius: 20px; font-size: 13px; font-weight: 600;
    font-family: -apple-system, system-ui, sans-serif;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  }
</style>
</head>
<body>
<div id="map"></div>
<div class="count-badge" id="count"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
(function() {
  var map = L.map('map', { zoomControl: false, attributionControl: false })
    .setView([33.5, -112], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 20 }).addTo(map);

  var bounds = [];
  var count = 0;

  function addPin(lat, lng, color, title, priority, status, id) {
    var icon = L.divIcon({
      html: '<div class="pin-marker"><div class="pin-inner" style="background:' + color + '"><span class="pin-icon">!</span></div></div>',
      className: '',
      iconSize: [28, 28],
      iconAnchor: [14, 28],
      popupAnchor: [0, -30]
    });
    var m = L.marker([lat, lng], { icon: icon }).addTo(map);
    var priStyle = 'background:' + color + '20;color:' + color;
    m.bindPopup(
      '<div class="popup-content">' +
        '<div class="popup-label" style="color:' + color + '">HOA REQUEST</div>' +
        '<div class="popup-title">' + title + '</div>' +
        '<div class="popup-row">' +
          '<span class="popup-badge" style="' + priStyle + '">' + priority + '</span>' +
          '<span class="popup-badge" style="background:#0C1D3115;color:#0C1D31">' + status + '</span>' +
        '</div>' +
        '<button class="popup-open-btn" onclick="openReq(\\'' + id + '\\')">View Request</button>' +
      '</div>',
      { closeButton: true, maxWidth: 220 }
    );
    bounds.push([lat, lng]);
    count++;
  }

  function openReq(id) {
    var msg = JSON.stringify({ type: 'openRequest', data: { id: id } });
    if (typeof window !== 'undefined' && window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === 'function') {
      window.ReactNativeWebView.postMessage(msg);
    } else {
      window.parent.postMessage(msg, '*');
    }
  }

  ${markersJs}

  document.getElementById('count').textContent = count + ' request' + (count !== 1 ? 's' : '');

  if (bounds.length > 0) {
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
  }

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(function(pos) {
      var userIcon = L.divIcon({
        html: '<div class="user-dot"></div>',
        className: '',
        iconSize: [14, 14],
        iconAnchor: [7, 7]
      });
      L.marker([pos.coords.latitude, pos.coords.longitude], { icon: userIcon, interactive: false }).addTo(map);
    }, function() {}, { enableHighAccuracy: false, timeout: 5000 });
  }

  setTimeout(function() { map.invalidateSize(); }, 200);
})();
</script>
</body>
</html>`;
}

export default function HoaRequestsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { activeCommunity } = useCommunity();
  const navyHeaderProps = useNavyHeaderProps();
  const queryClient = useQueryClient();
  const [activeFilter, setActiveFilter] = useState<FilterKey>('submitted');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [showCreateRequest, setShowCreateRequest] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const isHoaAdmin = user?.role === 'hoa_admin';

  const { data, isLoading, isRefetching, refetch, dataUpdatedAt } = useQuery<HoaRequest[]>({
    queryKey: ['/api/hoa/requests'],
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

  React.useEffect(() => {
    if (!data) return;
    data.forEach(req => {
      const existing = queryClient.getQueryData([`/api/tasks/${req.id}/detail`]);
      if (!existing) {
        queryClient.setQueryData([`/api/tasks/${req.id}/detail`], {
          task: {
            id: req.id,
            title: req.title,
            status: req.status,
            priority: req.priority,
            createdAt: req.createdAt,
            latitude: req.latitude ?? null,
            longitude: req.longitude ?? null,
            description: null,
            communityId: '',
            address: null,
            assignedTo: null,
            createdBy: '',
            dueDate: null,
            windowStart: null,
            windowEnd: null,
            version: 0,
            origin: 'HOA',
            updatedAt: req.createdAt,
          },
          completions: [],
          taskAttachments: [],
          taskLink: null,
        });
      }
    });
  }, [data, queryClient]);

  const handleSyncNow = useCallback(async () => {
    const result = await refetch();
    if (result.error) throw result.error;
    setLastSyncedAt(new Date());
  }, [refetch]);

  const filteredData = useMemo(() => {
    if (!data) return [];
    switch (activeFilter) {
      case 'submitted':
        return data.filter(r => r.status === 'submitted' && !r.isArchived);
      case 'acknowledged':
        return data.filter(r => r.status === 'acknowledged' && !r.isArchived);
      case 'completed':
        return data.filter(r => r.status === 'completed' && !r.isArchived);
      case 'archived':
        return data.filter(r => r.isArchived);
      case 'all':
      default:
        return data;
    }
  }, [data, activeFilter]);

  const geoRequests = useMemo(() => {
    if (!data) return [];
    return data.filter(r => r.latitude != null && r.longitude != null);
  }, [data]);

  const allRequestsMapHtml = useMemo(() => {
    if (geoRequests.length === 0) return '';
    return generateAllRequestsMapHTML(geoRequests);
  }, [geoRequests]);

  const handleMapMessage = useCallback((event: any) => {
    try {
      const raw = typeof event === 'string' ? event :
        event?.nativeEvent?.data ? event.nativeEvent.data :
        typeof event?.data === 'string' ? event.data : null;
      if (!raw) return;
      const msg = JSON.parse(raw);
      if (msg?.type === 'openRequest' && msg?.data?.id) {
        router.push(`/task/${msg.data.id}`);
      }
    } catch {}
  }, [router]);

  React.useEffect(() => {
    if (Platform.OS !== 'web' || viewMode !== 'map') return;
    const handler = (event: MessageEvent) => {
      handleMapMessage(event);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [viewMode, handleMapMessage]);

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom + 80;

  return (
    <View style={styles.container}>
      <StatusBarFill />
      <NavyHeader {...navyHeaderProps}>
        <View style={ss.subtitleRow}>
          <Text style={ss.subtitleText}>REQUESTS</Text>
          <View style={ss.subtitleActions}>
            <TouchableOpacity
              onPress={() => setViewMode(viewMode === 'list' ? 'map' : 'list')}
              style={[ss.headerIconBtn, viewMode === 'map' && ss.headerIconBtnActive]}
            >
              <Ionicons
                name={viewMode === 'list' ? 'map-outline' : 'list-outline'}
                size={20}
                color={viewMode === 'map' ? '#fff' : '#555'}
              />
            </TouchableOpacity>
          </View>
        </View>
      </NavyHeader>

      {viewMode === 'list' && (
        <SyncBar
          onSync={handleSyncNow}
          isSyncing={isRefetching}
          lastSyncedAt={lastSyncedAt}
        />
      )}

      {viewMode === 'map' ? (
        isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color="#25C1AC" />
          </View>
        ) : geoRequests.length === 0 ? (
          <View style={styles.centered}>
            <Ionicons name="location-outline" size={48} color="#ccc" />
            <Text style={styles.emptyTitle}>No locations to show</Text>
            <Text style={styles.emptySubtitle}>No requests have location data yet</Text>
          </View>
        ) : (
          <View style={styles.mapWrapper}>
            {Platform.OS === 'web' ? (
              <iframe
                srcDoc={allRequestsMapHtml}
                style={{ width: '100%', height: '100%', border: 'none' } as any}
              />
            ) : WebView ? (
              <WebView
                source={{ html: allRequestsMapHtml }}
                style={styles.mapFill}
                onMessage={(event: any) => handleMapMessage(event)}
                javaScriptEnabled
                scrollEnabled={false}
              />
            ) : (
              <View style={[styles.mapFill, styles.centered]}>
                <Text style={{ color: '#999' }}>Map not available</Text>
              </View>
            )}
          </View>
        )
      ) : (
        <>
          <View style={styles.filterContainer}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterScroll}
            >
              {FILTERS.map((f) => (
                <TouchableOpacity
                  key={f.key}
                  style={[styles.filterChip, activeFilter === f.key && styles.filterChipActive]}
                  onPress={() => setActiveFilter(f.key)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.filterText, activeFilter === f.key && styles.filterTextActive]}>
                    {f.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {isLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color="#25C1AC" />
            </View>
          ) : (
            <FlatList
              data={filteredData}
              keyExtractor={(item) => item.id}
              contentContainerStyle={[
                styles.listContent,
                { paddingBottom: bottomPad },
                filteredData.length === 0 && styles.emptyList,
              ]}
              scrollEnabled={filteredData.length > 0}
              refreshControl={
                <RefreshControl
                  refreshing={isRefetching}
                  onRefresh={handleRefresh}
                  tintColor="#25C1AC"
                  colors={['#25C1AC']}
                />
              }
              renderItem={({ item }) => (
                <RequestCard
                  item={item}
                  onPress={() => router.push(`/task/${item.id}`)}
                />
              )}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Ionicons name="document-text-outline" size={48} color="#ccc" />
                  <Text style={styles.emptyTitle}>No requests found</Text>
                  <Text style={styles.emptySubtitle}>
                    {activeFilter === 'all'
                      ? 'No HOA requests have been created yet'
                      : `No ${activeFilter} requests`}
                  </Text>
                </View>
              }
            />
          )}
        </>
      )}

      {isHoaAdmin && (
        <TouchableOpacity
          style={[styles.fab, { bottom: Platform.OS === 'web' ? 100 : insets.bottom + 90 }]}
          onPress={() => setShowCreateRequest(true)}
          activeOpacity={0.8}
        >
          <Ionicons name="add" size={28} color="#fff" />
        </TouchableOpacity>
      )}

      <CreateRequestSheet
        visible={showCreateRequest}
        onClose={() => {
          setShowCreateRequest(false);
          queryClient.invalidateQueries({ queryKey: ['/api/hoa/requests'] });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  mapWrapper: { flex: 1, backgroundColor: '#e0e0e0' },
  mapFill: { flex: 1 },
  filterContainer: {
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e8e8e8',
  },
  filterScroll: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#f0f0f0',
    marginRight: 8,
  },
  filterChipActive: {
    backgroundColor: '#0C1D31',
  },
  filterText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: '#666',
  },
  filterTextActive: {
    color: '#fff',
  },
  listContent: {
    padding: 16,
  },
  emptyList: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cardTop: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginBottom: 6,
  },
  requestLabel: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: '#25C1AC',
    letterSpacing: 1.2,
  },
  archivedLabel: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: '#999',
    letterSpacing: 1,
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: '#1a1a1a',
    marginBottom: 10,
    lineHeight: 22,
  },
  badgeRow: {
    flexDirection: 'row' as const,
    gap: 8,
    marginBottom: 10,
  },
  priorityBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  priorityText: {
    fontSize: 12,
    fontWeight: '600' as const,
  },
  statusChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600' as const,
    textTransform: 'capitalize' as const,
  },
  metaRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginBottom: 4,
  },
  metaText: {
    fontSize: 13,
    color: '#777',
    flex: 1,
  },
  photoIndicator: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 3,
  },
  photoCount: {
    fontSize: 12,
    color: '#25C1AC',
    fontWeight: '600' as const,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    paddingTop: 60,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: '#555',
    marginTop: 12,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#999',
    marginTop: 4,
    textAlign: 'center' as const,
  },
  fab: {
    position: 'absolute' as const,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#25C1AC',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
    zIndex: 999,
  },
  completedCard: {
    backgroundColor: '#fff',
    borderLeftWidth: 4,
    borderLeftColor: '#4caf50',
    borderWidth: 1,
    borderColor: '#4caf50',
  },
  completedTitle: {
    color: '#2E7D32',
  },
});
