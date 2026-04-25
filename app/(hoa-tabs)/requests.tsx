import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ScrollView, RefreshControl, ActivityIndicator, Platform, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/client/contexts/AuthContext';
import { useCommunity } from '@/client/contexts/CommunityContext';
import StatusBarFill from '@/components/StatusBarFill';
import NavyHeader, { subtitleStyles as ss } from '@/components/NavyHeader';
import { useNavyHeaderProps } from '@/components/useNavyHeaderProps';
import CreateRequestSheet from '@/components/CreateRequestSheet';
import SyncBar from '@/components/SyncBar';
import { apiRequest } from '@/lib/query-client';
import { getTaskPageConfigForRole } from '@/constants/taskPageRoleConfig';
import type { FilterKey as ConfigFilterKey } from '@/constants/taskPageRoleConfig';

let WebView: any = null;
if (Platform.OS !== 'web') {
  WebView = require('react-native-webview').WebView;
}

type ViewMode = 'list' | 'map';

type HoaRequest = {
  id: string;
  title: string;
  description?: string | null;
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

type FilterKey = ConfigFilterKey;

const AGED_THRESHOLD_DAYS = 7;

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  submitted: { bg: '#E3F2FD', text: '#1565C0' },
  acknowledged: { bg: '#FFE0B2', text: '#BF360C' },
  completed: { bg: '#ECEFF1', text: '#546E7A' },
  pending: { bg: '#F3E5F5', text: '#7B1FA2' },
  in_progress: { bg: '#E0F7FA', text: '#00838F' },
};

const URGENT_STATUS_COLOR = { bg: '#FFCDD2', text: '#B71C1C' };

const STATUS_LABELS: Record<string, string> = {
  submitted: 'Submitted',
  acknowledged: 'Acknowledged',
  completed: 'Completed',
  pending: 'Pending',
  in_progress: 'In Progress',
};

const LIFECYCLE_SUBTEXT: Record<string, string> = {
  submitted: 'Waiting for contractor',
  acknowledged: 'Contractor has seen this',
  in_progress: 'Work in progress',
  pending: 'Waiting to start',
  completed: 'Done',
};

function isUrgentReq(r: HoaRequest): boolean {
  return r.priority === 'urgent' || r.priority === 'Urgent';
}

function daysSince(dateStr: string): number {
  const ms = Date.now() - new Date(dateStr).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

function formatShortDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function formatAgingText(req: HoaRequest): string {
  const verb = req.status === 'completed' ? 'Completed' : 'Submitted';
  const refDate = req.status === 'completed' && req.completedAt ? req.completedAt : req.createdAt;
  const days = daysSince(req.createdAt);
  const ageLabel = days === 0 ? 'today' : days === 1 ? '1 day old' : `${days} days old`;
  return `${verb} ${formatShortDate(refDate)} \u2022 ${ageLabel}`;
}

function sortRequests(items: HoaRequest[]): HoaRequest[] {
  const groupOf = (r: HoaRequest): number => {
    if (r.status === 'completed') return 5;
    if (isUrgentReq(r)) return 0;
    if (r.status === 'submitted') return 1;
    if (r.status === 'acknowledged') return 2;
    return 3;
  };
  return [...items].sort((a, b) => {
    const ga = groupOf(a);
    const gb = groupOf(b);
    if (ga !== gb) return ga - gb;
    const ta = new Date(a.createdAt).getTime();
    const tb = new Date(b.createdAt).getTime();
    if (ga === 5) return tb - ta;
    return ta - tb;
  });
}

function RequestCard({
  item,
  onPress,
  onMapJump,
  onAcknowledge,
  showAcknowledgeAction = false,
  showMapJumpAction = false,
  acknowledging = false,
}: {
  item: HoaRequest;
  onPress: () => void;
  onMapJump?: () => void;
  onAcknowledge?: () => void;
  showAcknowledgeAction?: boolean;
  showMapJumpAction?: boolean;
  acknowledging?: boolean;
}) {
  const isUrgent = isUrgentReq(item);
  const isCompleted = item.status === 'completed';
  const baseStatusColor = STATUS_COLORS[item.status] ?? { bg: '#ECEFF1', text: '#546E7A' };
  const statusColor = isUrgent && !isCompleted ? URGENT_STATUS_COLOR : baseStatusColor;
  const statusLabel = isUrgent && !isCompleted
    ? 'Urgent'
    : (STATUS_LABELS[item.status] ?? item.status.replace('_', ' '));
  const lifecycle = LIFECYCLE_SUBTEXT[item.status];
  const canAcknowledge = showAcknowledgeAction && item.status === 'submitted';
  const canShowMap = showMapJumpAction && (item.latitude != null && item.longitude != null);
  const showActionRow = canAcknowledge || canShowMap;
  const showLifecycle = !isCompleted && !!lifecycle;

  return (
    <TouchableOpacity
      style={[styles.card, isCompleted && styles.completedCard, isUrgent && !isCompleted && styles.urgentCard]}
      onPress={onPress}
      activeOpacity={0.7}
      testID={`request-${item.id}`}
    >
      <View style={styles.cardTopRow}>
        <View style={styles.cardTopLeft}>
          <Text style={styles.requestLabel}>REQUEST</Text>
          {item.isArchived && <Text style={styles.archivedLabel}>ARCHIVED</Text>}
        </View>
        <View style={styles.cardTopRight}>
          <View style={[styles.statusChip, { backgroundColor: statusColor.bg }]}>
            {isUrgent && !isCompleted && (
              <Ionicons name="alert-circle" size={12} color={statusColor.text} style={{ marginRight: 4 }} />
            )}
            <Text style={[styles.statusText, { color: statusColor.text }]}>{statusLabel}</Text>
          </View>
          {showLifecycle && (
            <Text style={styles.lifecycleText} numberOfLines={1}>{lifecycle}</Text>
          )}
        </View>
      </View>

      <Text style={[styles.cardTitle, isCompleted && styles.completedTitle]} numberOfLines={2}>
        {item.title}
      </Text>

      {item.description ? (
        <Text style={styles.cardDescription} numberOfLines={2}>{item.description}</Text>
      ) : null}

      <View style={styles.metaRow}>
        <Ionicons name="time-outline" size={13} color="#999" />
        <Text style={styles.metaText}>{formatAgingText(item)}</Text>
      </View>

      <View style={styles.metaRow}>
        <Ionicons name="location-outline" size={13} color="#999" />
        <Text style={styles.metaText} numberOfLines={1}>
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

      {showActionRow && (
        <View style={styles.cardActionRow}>
          {canShowMap ? (
            <TouchableOpacity
              style={styles.mapJumpBtn}
              onPress={(e) => { e.stopPropagation(); onMapJump?.(); }}
              activeOpacity={0.7}
              testID={`map-jump-${item.id}`}
            >
              <Ionicons name="map-outline" size={14} color="#0C1D31" />
              <Text style={styles.mapJumpBtnText}>View on Map</Text>
            </TouchableOpacity>
          ) : <View />}
          {canAcknowledge && (
            <TouchableOpacity
              style={[styles.acknowledgeBtn, acknowledging && styles.acknowledgeBtnDisabled]}
              onPress={(e) => { e.stopPropagation(); onAcknowledge?.(); }}
              activeOpacity={0.7}
              disabled={acknowledging}
              testID={`acknowledge-${item.id}`}
            >
              <Ionicons name="checkmark-circle-outline" size={14} color="#fff" />
              <Text style={styles.acknowledgeBtnText}>
                {acknowledging ? 'Acknowledging\u2026' : 'Acknowledge'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
}

function generateAllRequestsMapHTML(requests: HoaRequest[], focusedId: string | null): string {
  const escaped = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, "\\'").replace(/"/g, '&quot;');
  const markersJs = requests.map(r => {
    const color = r.priority === 'urgent' ? '#e74c3c' : '#25C1AC';
    const priorityLabel = r.priority === 'urgent' ? 'Urgent' : 'General';
    const statusLabel = r.status === 'submitted' ? 'Submitted' : r.status === 'acknowledged' ? 'Acknowledged' : r.status === 'completed' ? 'Completed' : r.status.charAt(0).toUpperCase() + r.status.slice(1);
    return `addPin(${r.latitude}, ${r.longitude}, '${color}', '${escaped(r.title)}', '${priorityLabel}', '${statusLabel}', '${r.id}');`;
  }).join('\n  ');
  const focusedJs = focusedId ? `var __focusedId = ${JSON.stringify(focusedId)};` : 'var __focusedId = null;';

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

  ${focusedJs}
  var bounds = [];
  var count = 0;
  var __markerById = {};

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
    __markerById[id] = { marker: m, lat: lat, lng: lng };
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

  if (__focusedId && __markerById[__focusedId]) {
    var f = __markerById[__focusedId];
    map.setView([f.lat, f.lng], 18);
    setTimeout(function() { f.marker.openPopup(); }, 250);
  } else if (bounds.length > 0) {
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
  const config = getTaskPageConfigForRole(user?.role);
  const defaultFilterKey: FilterKey = (config.availableFilters[0]?.key ?? 'all') as FilterKey;
  const [activeFilter, setActiveFilter] = useState<FilterKey>(defaultFilterKey);
  const { requestId } = useLocalSearchParams<{ requestId?: string }>();
  const deepLinkRequestRef = useRef<string | null>(null);

  useEffect(() => {
    if (requestId && deepLinkRequestRef.current !== requestId) {
      deepLinkRequestRef.current = requestId;
      router.push({ pathname: '/task/[id]', params: { id: requestId } });
    }
  }, [requestId, router]);

  const [viewMode, setViewMode] = useState<ViewMode>(config.defaultView as ViewMode);
  const [showCreateRequest, setShowCreateRequest] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);
  const [focusedRequestId, setFocusedRequestId] = useState<string | null>(null);
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
    try {
      await queryClient.invalidateQueries({ queryKey: ['/api/map-layers'] });
    } catch {}
  }, [refetch, queryClient]);

  const filteredData = useMemo(() => {
    if (!data) return [];
    let scoped: HoaRequest[];
    switch (activeFilter) {
      case 'needs_attention':
        scoped = data.filter(r => {
          if (r.isArchived || r.status === 'completed') return false;
          if (isUrgentReq(r)) return true;
          if (r.status === 'submitted') return true;
          if (r.status !== 'completed' && daysSince(r.createdAt) >= AGED_THRESHOLD_DAYS) return true;
          return false;
        });
        break;
      case 'submitted':
        scoped = data.filter(r => r.status === 'submitted' && !r.isArchived);
        break;
      case 'acknowledged':
        scoped = data.filter(r => r.status === 'acknowledged' && !r.isArchived);
        break;
      case 'completed':
        scoped = data.filter(r => r.status === 'completed' && !r.isArchived);
        break;
      case 'archived':
        scoped = data.filter(r => r.isArchived);
        break;
      case 'active':
        scoped = data.filter(r => r.status !== 'completed' && !r.isArchived);
        break;
      case 'your_requests':
        scoped = data.filter(r => !r.isArchived);
        break;
      case 'all':
      default:
        scoped = data;
        break;
    }
    return sortRequests(scoped);
  }, [data, activeFilter]);

  const geoRequests = useMemo(() => {
    if (!data) return [];
    return data.filter(r => r.latitude != null && r.longitude != null);
  }, [data]);

  const allRequestsMapHtml = useMemo(() => {
    if (geoRequests.length === 0) return '';
    return generateAllRequestsMapHTML(geoRequests, focusedRequestId);
  }, [geoRequests, focusedRequestId]);

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

  const handleAcknowledge = useCallback(async (req: HoaRequest) => {
    if (acknowledgingId) return;
    setAcknowledgingId(req.id);
    try {
      const detailRes = await apiRequest('GET', `/api/tasks/${req.id}/detail`);
      const detail = await detailRes.json();
      const version = detail?.task?.version ?? 0;
      await apiRequest('PUT', `/api/tasks/${req.id}`, {
        status: 'acknowledged',
        version,
      });
      await queryClient.invalidateQueries({ queryKey: ['/api/hoa/requests'] });
      await queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      await queryClient.invalidateQueries({ queryKey: [`/api/tasks/${req.id}/detail`] });
      refetch();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to acknowledge request';
      Alert.alert('Error', msg);
    } finally {
      setAcknowledgingId(null);
    }
  }, [acknowledgingId, queryClient, refetch]);

  const handleMapJump = useCallback((req: HoaRequest) => {
    if (req.latitude == null || req.longitude == null) return;
    setFocusedRequestId(req.id);
    setViewMode('map');
  }, []);

  const handleOpenCreate = useCallback(() => setShowCreateRequest(true), []);

  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom + 80;

  return (
    <View style={styles.container}>
      <StatusBarFill />
      <NavyHeader {...navyHeaderProps}>
        <View style={ss.subtitleRow}>
          <Text style={ss.subtitleText}>REQUESTS</Text>
          <View style={ss.subtitleActions}>
            <TouchableOpacity
              onPress={() => {
                if (viewMode === 'map') {
                  setFocusedRequestId(null);
                  setViewMode('list');
                } else {
                  setViewMode('map');
                }
              }}
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
          {isHoaAdmin && (
            <View style={styles.topCtaContainer}>
              <TouchableOpacity
                style={styles.topCtaBtn}
                onPress={handleOpenCreate}
                activeOpacity={0.8}
                testID="top-create-request"
              >
                <Ionicons name="add-circle-outline" size={18} color="#fff" />
                <Text style={styles.topCtaText}>Create Request</Text>
              </TouchableOpacity>
            </View>
          )}
          <View style={styles.filterContainer}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterScroll}
            >
              {config.availableFilters.map((f) => {
                const isActive = activeFilter === f.key;
                const isAttention = f.key === 'needs_attention';
                return (
                  <TouchableOpacity
                    key={f.key}
                    style={[
                      styles.filterChip,
                      isAttention && styles.filterChipAttention,
                      isActive && styles.filterChipActive,
                      isActive && isAttention && styles.filterChipAttentionActive,
                    ]}
                    onPress={() => setActiveFilter(f.key as FilterKey)}
                    activeOpacity={0.7}
                    testID={`filter-${f.key}`}
                  >
                    {isAttention && (
                      <Ionicons
                        name="alert-circle-outline"
                        size={13}
                        color={isActive ? '#fff' : '#B71C1C'}
                        style={{ marginRight: 4 }}
                      />
                    )}
                    <Text
                      style={[
                        styles.filterText,
                        isAttention && styles.filterTextAttention,
                        isActive && styles.filterTextActive,
                      ]}
                    >
                      {f.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
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
                  onAcknowledge={() => handleAcknowledge(item)}
                  onMapJump={() => handleMapJump(item)}
                  showAcknowledgeAction={config.showAcknowledgmentControls && config.cardActions.includes('acknowledge')}
                  showMapJumpAction={config.showMapJump && config.cardActions.includes('mapJump')}
                  acknowledging={acknowledgingId === item.id}
                />
              )}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Ionicons name="document-text-outline" size={48} color="#ccc" />
                  <Text style={styles.emptyTitle}>
                    {(config.emptyStateMessages[activeFilter] ?? config.emptyStateMessages[defaultFilterKey])?.title ?? 'No requests found'}
                  </Text>
                  <Text style={styles.emptySubtitle}>
                    {(config.emptyStateMessages[activeFilter] ?? config.emptyStateMessages[defaultFilterKey])?.subtitle ?? `No ${activeFilter} requests`}
                  </Text>
                  {isHoaAdmin && (activeFilter === 'all' || activeFilter === 'needs_attention') && (
                    <TouchableOpacity
                      style={styles.emptyCtaBtn}
                      onPress={handleOpenCreate}
                      activeOpacity={0.8}
                      testID="empty-create-request"
                    >
                      <Ionicons name="add" size={18} color="#fff" />
                      <Text style={styles.emptyCtaText}>Create Request</Text>
                    </TouchableOpacity>
                  )}
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
  filterChipAttention: {
    backgroundColor: '#FFEBEE',
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
  },
  filterChipAttentionActive: {
    backgroundColor: '#B71C1C',
  },
  filterText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: '#666',
  },
  filterTextActive: {
    color: '#fff',
  },
  filterTextAttention: {
    color: '#B71C1C',
  },
  topCtaContainer: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  topCtaBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    backgroundColor: '#25C1AC',
    borderRadius: 10,
    paddingVertical: 10,
  },
  topCtaText: {
    color: '#fff',
    fontWeight: '600' as const,
    fontSize: 14,
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
  cardTopRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'flex-start' as const,
    marginBottom: 8,
    gap: 8,
  },
  cardTopLeft: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    flex: 1,
  },
  cardTopRight: {
    alignItems: 'flex-end' as const,
    maxWidth: 180,
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
    marginBottom: 6,
    lineHeight: 22,
  },
  cardDescription: {
    fontSize: 13,
    color: '#666',
    marginBottom: 10,
    lineHeight: 18,
  },
  statusChip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700' as const,
  },
  lifecycleText: {
    fontSize: 11,
    color: '#888',
    marginTop: 4,
    fontStyle: 'italic' as const,
  },
  urgentCard: {
    borderLeftWidth: 3,
    borderLeftColor: '#B71C1C',
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
  cardActionRow: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
  },
  mapJumpBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
  },
  mapJumpBtnText: {
    color: '#0C1D31',
    fontSize: 12,
    fontWeight: '600' as const,
  },
  acknowledgeBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    backgroundColor: '#1565c0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  acknowledgeBtnDisabled: {
    opacity: 0.6,
  },
  acknowledgeBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600' as const,
  },
  emptyCtaBtn: {
    marginTop: 16,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    backgroundColor: '#25C1AC',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  emptyCtaText: {
    color: '#fff',
    fontWeight: '600' as const,
    fontSize: 14,
  },
});
