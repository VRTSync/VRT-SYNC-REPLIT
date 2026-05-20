import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Modal, ScrollView, Alert, ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCommunity } from '@/client/contexts/CommunityContext';
import { useHighAccuracyLocation } from '@/hooks/useHighAccuracyLocation';
import { apiRequest } from '@/lib/query-client';
import { getDefaultLayerColor, CONTROLLER_COLORS } from '@workspace/layer-colors';
import StatusBarFill from '@/components/StatusBarFill';
import Toast from '@/components/Toast';
import TallyPanel from '@/components/TallyPanel';
import ReshootList from '@/components/ReshootList';
import LeafletMap, { type PendingPinMarker } from '@/components/LeafletMap';
import MapCreatorOverlay from '@/components/MapCreatorOverlay';
import MapCreatorChrome from '@/components/MapCreatorChrome';
import ControllerPicker, { type ControllerRow } from '@/components/ControllerPicker';
import PinDropSheet from '@/components/PinDropSheet';
import { MC_LAYER_MAP, type McLayerKey } from '@/lib/mcAssetTypeCatalog';
import { usePinQueue } from '@/client/contexts/PinQueueContext';
import { type PendingPinEntry } from '@/lib/pinCreationQueue';
import LockPinSheet from '@/components/LockPinSheet';
import type { Fix, CaptureMode } from '@/hooks/useHighAccuracyLocation';
import { MC_UX_V2 } from '@/lib/featureFlags';

// --- Types ---

type MapLayerMeta = {
  id: string;
  communityId: string;
  layerKey: string;
  subLayerKey: string;
  displayName: string;
  version: number;
  color?: string;
};

type Asset = {
  id: string;
  assetType: string;
  label: string;
  latitude: number | null;
  longitude: number | null;
  isArchived: boolean;
  version: number;
  properties?: Record<string, string>;
  gpsAccuracy?: number | null;
};

type SimpleController = {
  id: string;
  label: string;
  controllerKey: string;
  zoneCount: number;
};

type ReshootContext = {
  assetId: string;
  assetVersion: number;
  label: string;
  assetType: string;
  description: string;
  parentControllerFeatureRef: string | null;
};


const LOCK_COLORS: Record<string, string> = {
  red: '#F44336',
  yellow: '#FFC107',
  green: '#4CAF50',
};

const LOCK_LABELS: Record<string, string> = {
  red: 'No GPS',
  yellow: 'Acquiring',
  green: 'Locked',
};

const RESHOOT_ACCURACY_THRESHOLD = 3;

// --- MC7: PendingSheet helpers ---

function getRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return `${Math.floor(diffHrs / 24)}d ago`;
}

function PendingSheet({
  visible,
  onClose,
  entries,
  onRetry,
  onSyncAll,
  isSyncing,
}: {
  visible: boolean;
  onClose: () => void;
  entries: PendingPinEntry[];
  onRetry: (id: string) => Promise<void>;
  onSyncAll: () => Promise<void>;
  isSyncing: boolean;
}) {
  const insets = useSafeAreaInsets();

  const activeEntries = entries.filter(
    (e) => e.state === 'queued' || e.state === 'failed' || e.state === 'syncing',
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={sheetStyles.overlay}>
        <TouchableOpacity style={sheetStyles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={[sheetStyles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={sheetStyles.handle} />
          <View style={sheetStyles.header}>
            <Text style={sheetStyles.title}>Pending Pins</Text>
            <TouchableOpacity onPress={onClose} style={sheetStyles.closeBtn}>
              <Ionicons name="close" size={22} color="#6b7280" />
            </TouchableOpacity>
          </View>

          {activeEntries.length > 0 && (
            <TouchableOpacity
              style={[sheetStyles.syncAllBtn, isSyncing && sheetStyles.syncAllBtnDisabled]}
              onPress={onSyncAll}
              disabled={isSyncing}
              activeOpacity={0.8}
            >
              {isSyncing ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="cloud-upload-outline" size={16} color="#fff" />
              )}
              <Text style={sheetStyles.syncAllBtnText}>
                {isSyncing ? 'Syncing…' : 'Sync All Now'}
              </Text>
            </TouchableOpacity>
          )}

          <ScrollView style={sheetStyles.list} showsVerticalScrollIndicator={false}>
            {activeEntries.length === 0 ? (
              <View style={sheetStyles.emptyState}>
                <Ionicons name="checkmark-circle-outline" size={40} color="#25C1AC" />
                <Text style={sheetStyles.emptyText}>All pins are synced!</Text>
              </View>
            ) : (
              activeEntries.map((entry) => (
                <View key={entry.id} style={sheetStyles.row}>
                  <View
                    style={[
                      sheetStyles.stateIndicator,
                      entry.state === 'failed'
                        ? sheetStyles.stateFailed
                        : entry.state === 'syncing'
                        ? sheetStyles.stateSyncing
                        : sheetStyles.stateQueued,
                    ]}
                  />
                  <View style={sheetStyles.rowContent}>
                    <Text style={sheetStyles.rowLabel} numberOfLines={1}>
                      {entry.label}
                    </Text>
                    <Text style={sheetStyles.rowMeta}>
                      {entry.assetType} · {getRelativeTime(entry.createdAt)}
                      {entry.state === 'failed' ? ` · ${entry.attempts} attempt${entry.attempts !== 1 ? 's' : ''}` : ''}
                    </Text>
                    {entry.state === 'failed' && entry.lastError ? (
                      <Text style={sheetStyles.rowError} numberOfLines={2}>
                        {entry.lastError}
                      </Text>
                    ) : null}
                  </View>
                  {entry.state === 'failed' && (
                    <TouchableOpacity
                      style={sheetStyles.retryBtn}
                      onPress={() => onRetry(entry.id)}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="refresh" size={14} color="#25C1AC" />
                      <Text style={sheetStyles.retryBtnText}>Retry</Text>
                    </TouchableOpacity>
                  )}
                  {entry.state === 'syncing' && (
                    <ActivityIndicator size="small" color="#25C1AC" style={{ marginLeft: 8 }} />
                  )}
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// --- Component ---

export default function McWorkspaceScreen() {
  const { id, targetPinId, targetPinLabel } = useLocalSearchParams<{
    id: string;
    targetPinId?: string;
    targetPinLabel?: string;
  }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { communities, setActiveCommunity, refresh: refreshCommunities } = useCommunity();
  const insets = useSafeAreaInsets();

  // MC7: sync queue
  const { pendingEntries, syncNow, retryEntry, refreshList } = usePinQueue();
  const [sheetVisible, setSheetVisible] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showSyncSuccess, setShowSyncSuccess] = useState(false);
  const [mapTapEnabled, setMapTapEnabled] = useState(false);
  const [pinDropCoords, setPinDropCoords] = useState<{ latitude: number; longitude: number } | null>(null);

  const community = communities.find((c) => c.id === id) ?? null;

  // --- Review mode state (MC8) ---
  const [reviewMode, setReviewMode] = useState(false);
  const [reviewTab, setReviewTab] = useState<'tally' | 'reshoot'>('tally');
  const [locking, setLocking] = useState(false);
  const [targetRegion, setTargetRegion] = useState<{ latitude: number; longitude: number; label?: string } | null>(null);
  const [reshootContext, setReshootContext] = useState<ReshootContext | null>(null);
  const [reshootHighlight, setReshootHighlight] = useState<{ latitude: number; longitude: number } | null>(null);

  // --- Toast state ---
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error'>('success');
  const [toastKey, setToastKey] = useState(0);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastMessage(message);
    setToastType(type);
    setToastKey((k) => k + 1);
    setToastVisible(true);
    toastTimeoutRef.current = setTimeout(() => setToastVisible(false), 4000);
  }, []);

  useEffect(() => {
    if (community) {
      setActiveCommunity(community);
    }
  }, [community?.id]);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  // MC4: map state
  const communityId = id ?? '';

  // ─── MC4: map / GPS state + MC6: Controller→Zone creation state ──────────

  const [activeLayer, setActiveLayer] = useState<McLayerKey>('trees');
  const [armedType, setArmedType] = useState<string | null>(null);
  const [lockPinFix, setLockPinFix] = useState<Fix | null>(null);
  const [savedRing, setSavedRing] = useState<{ latitude: number; longitude: number; accuracyM: number } | null>(null);
  const [loadedGeoJSON, setLoadedGeoJSON] = useState<Record<string, any>>({});
  const loadedGeoJSONRef = useRef(loadedGeoJSON);
  loadedGeoJSONRef.current = loadedGeoJSON;
  const loadingGeoJSONRef = useRef<Set<string>>(new Set());


  // --- MC_UX_V2 capture mode (declared here so it can be passed to the GPS hook) ---
  const [captureMode, setCaptureMode] = useState<CaptureMode>('strict');

  // --- GPS (MC4) — receives captureMode so thresholds update live ---
  const gps = useHighAccuracyLocation({ mode: captureMode });

  useFocusEffect(
    useCallback(() => {
      gps.start();
      return () => { gps.stop(); };
    }, [])
  );

  // ─── MC6: Controller→Zone creation state ─────────────────────────────────
  const [pickerVisible, setPickerVisible] = useState(false);
  const [addingControllerForZone, setAddingControllerForZone] = useState(false);
  const [selectedController, setSelectedController] = useState<ControllerRow | null>(null);
  const [newlyAddedControllerId, setNewlyAddedControllerId] = useState<string | null>(null);

  // ─── Data fetching ────────────────────────────────────────────────────────

  const { data: boundsData } = useQuery<{
    bounds: [[number, number], [number, number]];
    center: [number, number];
  } | null>({
    queryKey: ['/api/communities', communityId, 'bounds'],
    enabled: !!communityId,
  });

  const { data: onlineLayers = [] } = useQuery<MapLayerMeta[]>({
    queryKey: ['/api/map-layers', { communityId }],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/map-layers?communityId=${communityId}`);
      return res.json();
    },
    enabled: !!communityId,
  });

  const { data: controllers = [], refetch: refetchControllers } = useQuery<ControllerRow[]>({
    queryKey: ['/api/communities', communityId, 'controllers'],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/communities/${communityId}/controllers`);
      return res.json();
    },
    enabled: !!communityId,
  });

  // MC8: full-detail asset query for review mode (tally + reshoot)
  const assetsQuery = useQuery<Asset[]>({
    queryKey: ['mc-assets', communityId],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/assets?communityId=${communityId}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!communityId && (reviewMode || !!targetPinId),
  });

  const activeAssets = useMemo(
    () => (assetsQuery.data ?? []).filter((a) => !a.isArchived),
    [assetsQuery.data],
  );

  const reshootAssets = useMemo(
    () => activeAssets
      .filter((a) => a.gpsAccuracy == null || a.gpsAccuracy > RESHOOT_ACCURACY_THRESHOLD)
      .map((a) => ({ ...a, gpsAccuracy: a.gpsAccuracy ?? null })),
    [activeAssets],
  );

  // Wrap controllers in a query-shaped object for review panel compatibility
  const reviewControllersQuery = useMemo(
    () => ({ data: controllers }),
    [controllers],
  );

  const { data: communityAssets = [] } = useQuery<{ id: string; label: string; assetType: string }[]>({
    queryKey: ['/api/assets', { communityId }],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/assets?communityId=${communityId}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!communityId,
  });


  const existingLabelsByType = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const a of communityAssets) {
      if (!map[a.assetType]) map[a.assetType] = [];
      map[a.assetType].push(a.label);
    }
    return map;
  }, [communityAssets]);


  const allLayers = useMemo(
    () => onlineLayers.filter((l) => l.layerKey !== 'outline'),
    [onlineLayers]
  );

  const fetchGeoJSON = useCallback(async (layerId: string) => {
    if (loadedGeoJSONRef.current[layerId] || loadingGeoJSONRef.current.has(layerId)) return;
    loadingGeoJSONRef.current.add(layerId);
    try {
      const res = await apiRequest('GET', `/api/map-layers/${layerId}/geojson`);
      const data = await res.json();
      if (data) {
        setLoadedGeoJSON((prev) => ({ ...prev, [layerId]: data }));
      }
    } catch (_err) {
    } finally {
      loadingGeoJSONRef.current.delete(layerId);
    }
  }, []);

  useEffect(() => {
    allLayers.forEach((layer) => {
      if (!loadedGeoJSONRef.current[layer.id] && !loadingGeoJSONRef.current.has(layer.id)) {
        fetchGeoJSON(layer.id);
      }
    });
  }, [allLayers, fetchGeoJSON]);

  // ─── Derived map data ─────────────────────────────────────────────────────
  const controllerColorMap = useMemo(() => {
    const map = new Map<string, string>();
    controllers.forEach((c) => {
      if (c.featureRef) map.set(c.featureRef, c.controllerColor);
    });
    return map;
  }, [controllers]);

  const activeLayers = useMemo(() => {
    return allLayers
      .filter((l) => {
        // MC4 (MC_UX_V2): only show layers for the currently selected layer pill
        if (MC_UX_V2 && l.layerKey !== activeLayer) return false;
        if (controllers.length > 0) {
          if (l.subLayerKey === 'controller' || l.subLayerKey === 'zone') return false;
        }
        return true;
      })
      .map((l, idx) => ({
        id: l.id,
        layerKey: l.layerKey,
        subLayerKey: l.subLayerKey,
        displayName: l.displayName,
        geojson: loadedGeoJSON[l.id] || null,
        color: l.color || getDefaultLayerColor(l.subLayerKey, idx),
        controllerColorMap: (l.subLayerKey === 'zone' || l.subLayerKey === 'controller')
          ? controllerColorMap
          : undefined,
      }));
  }, [allLayers, loadedGeoJSON, controllers, controllerColorMap, activeLayer]);

  const controllerMarkers = useMemo(() => {
    return controllers
      .filter((c) => c.latitude != null && c.longitude != null)
      .map((c) => ({
        id: c.id,
        featureRef: c.featureRef || c.id,
        label: c.label,
        controllerKey: c.controllerKey,
        color: c.controllerColor,
        latitude: c.latitude!,
        longitude: c.longitude!,
        zoneCount: c.zoneCount,
      }));
  }, [controllers]);

  const zoneMarkers = useMemo(() => {
    const zones: {
      id: string;
      featureRef: string;
      label: string;
      zoneNumber: number | null;
      zoneType: string | null;
      controllerFeatureRef: string;
      controllerLabel: string;
      controllerKey: string;
      controllerColor: string;
      latitude: number;
      longitude: number;
    }[] = [];
    controllers.forEach((ctrl) => {
      ctrl.zones.forEach((z) => {
        if (z.latitude != null && z.longitude != null) {
          zones.push({
            id: z.id,
            featureRef: z.featureRef || z.id,
            label: z.label,
            zoneNumber: z.zoneNumber,
            zoneType: z.zoneType,
            controllerFeatureRef: ctrl.featureRef || ctrl.id,
            controllerLabel: ctrl.label,
            controllerKey: ctrl.controllerKey,
            controllerColor: ctrl.controllerColor,
            latitude: z.latitude,
            longitude: z.longitude,
          });
        }
      });
    });
    return zones;
  }, [controllers]);

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    allLayers.forEach((layer) => {
      if (layer.subLayerKey === 'controller' || layer.subLayerKey === 'zone') return;
      const geojson = loadedGeoJSON[layer.id];
      if (geojson?.features?.length) {
        const key = layer.subLayerKey;
        counts[key] = (counts[key] ?? 0) + geojson.features.length;
      }
    });
    if (controllers.length > 0) {
      counts['controller'] = controllers.length;
      counts['zone'] = controllers.reduce((sum, c) => sum + c.zoneCount, 0);
    }
    return counts;
  }, [allLayers, loadedGeoJSON, controllers]);

  const countSubtitle = useMemo(() => {
    const DISPLAY: Record<string, string> = {
      controller: 'controllers',
      zone: 'zones',
      tree: 'trees',
      pet_station: 'pet stations',
      backflow: 'backflows',
      pump: 'pumps',
      master_valve: 'master valves',
      flow_meter: 'flow meters',
      quick_connect: 'quick connects',
      isolation_valve: 'isolation valves',
    };
    return Object.entries(typeCounts)
      .filter(([, n]) => n > 0)
      .map(([key, n]) => `${n} ${DISPLAY[key] ?? key}`)
      .join(' · ');
  }, [typeCounts]);

  const haloColor = LOCK_COLORS[gps.fix?.lockState ?? 'red'] ?? '#F44336';

  const userLocationHalo = useMemo(() => {
    if (!armedType || gps.fix == null) {
      return null;
    }
    return { lat: gps.fix.latitude, lng: gps.fix.longitude, accuracyMetres: gps.fix.accuracy, color: haloColor };
  }, [armedType, gps.fix, haloColor]);

  const userLocation = useMemo(() => {
    if (gps.fix == null) return null;
    return { latitude: gps.fix.latitude, longitude: gps.fix.longitude };
  }, [gps.fix]);

  const armedTypeDef = useMemo(() => {
    if (!armedType) return null;
    for (const layerKey of Object.keys(MC_LAYER_MAP) as McLayerKey[]) {
      const found = MC_LAYER_MAP[layerKey].types.find((t) => t.key === armedType);
      if (found) return found;
    }
    return null;
  }, [armedType]);

  const existingZoneNumbers = useMemo(() => {
    if (!controllers.length || !selectedController) return [];
    const ctrl = controllers.find((c) => c.id === selectedController.id);
    if (!ctrl) return [];
    return ctrl.zones
      .map((z) => z.zoneNumber)
      .filter((n): n is number => typeof n === 'number');
  }, [controllers, selectedController]);

  // ─── Creation flow handlers ────────────────────────────────────────────────

  const disarm = () => {
    setArmedType(null);
    setSelectedController(null);
    setAddingControllerForZone(false);
    setLockPinFix(null);
    setReshootContext(null);
    setReshootHighlight(null);
  };

  /** Called by MapCreatorOverlay's arm-type tap. */
  const handleArmType = (type: string | null) => {
    if (type === 'zone') {
      setArmedType('zone');
      setSelectedController(null);
      setAddingControllerForZone(false);
      setPickerVisible(true);
    } else {
      setArmedType(type);
      setSelectedController(null);
      setAddingControllerForZone(false);
    }
  };

  const handleControllerSelected = (controller: ControllerRow) => {
    setSelectedController(controller);
    setPickerVisible(false);
  };

  const handleAddNewController = () => {
    setPickerVisible(false);
    setAddingControllerForZone(true);
    setArmedType('controller');
    setSelectedController(null);
  };

  const handlePickerClose = () => {
    setPickerVisible(false);
    if (!selectedController) {
      setArmedType(null);
    }
  };

  // ─── MC_UX_V2 capture state ──────────────────────────────────────────────
  const [isCaptureRunning, setIsCaptureRunning] = useState(false);
  const [captureProgress, setCaptureProgress] = useState(0);
  const [captureSamplesCount, setCaptureSamplesCount] = useState(0);
  const [captureSecondsLeft, setCaptureSecondsLeft] = useState(30);
  const [captureTimeoutCount, setCaptureTimeoutCount] = useState(0);
  const captureCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const CAPTURE_TARGET_SAMPLES = 15;
  const CAPTURE_TIMEOUT_S = 30;

  const handleCaptureHere = useCallback(async (mode: CaptureMode) => {
    if (isCaptureRunning || !armedType) return;
    if (armedType === 'zone' && !selectedController) {
      setPickerVisible(true);
      return;
    }
    setIsCaptureRunning(true);
    setCaptureProgress(0);
    setCaptureSamplesCount(0);
    setCaptureSecondsLeft(CAPTURE_TIMEOUT_S);
    if (captureCountdownRef.current) clearInterval(captureCountdownRef.current);
    captureCountdownRef.current = setInterval(() => {
      setCaptureSecondsLeft((prev) => {
        if (prev <= 1) {
          if (captureCountdownRef.current) {
            clearInterval(captureCountdownRef.current);
            captureCountdownRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    try {
      const result = await gps.captureStationary({
        mode,
        onProgress: (count, total) => {
          setCaptureSamplesCount(count);
          setCaptureProgress(count / total);
        },
      });
      if ('aborted' in result) {
        const msgs: Record<string, string> = {
          moved: 'Hold steady — you moved during capture.',
          timeout: 'Capture timed out. Hold still and try again, or switch to Canopy mode.',
          permission: 'Location permission required.',
        };
        showToast(msgs[result.aborted] ?? 'Capture aborted', 'error');
        if (result.aborted === 'timeout') {
          setCaptureTimeoutCount((prev) => prev + 1);
        }
      } else {
        setLockPinFix(result);
      }
    } finally {
      if (captureCountdownRef.current) {
        clearInterval(captureCountdownRef.current);
        captureCountdownRef.current = null;
      }
      setIsCaptureRunning(false);
      setCaptureProgress(0);
      setCaptureSamplesCount(0);
      setCaptureSecondsLeft(CAPTURE_TIMEOUT_S);
    }
  }, [armedType, selectedController, gps, isCaptureRunning, showToast]);

  /**
   * Legacy "Lock Pin Here" — snapshots GPS and opens LockPinSheet for all types.
   * Zone type requires a selectedController before reaching this point.
   * Only used when MC_UX_V2 = false.
   */
  const handleLockPin = useCallback(() => {
    if (!armedType) return;
    if (armedType === 'zone' && !selectedController) {
      setPickerVisible(true);
      return;
    }
    const fix = gps.snapshot();
    if (!fix) return;
    setLockPinFix(fix);
  }, [armedType, selectedController, gps]);

  const canLockPin =
    !!armedType &&
    gps.fix != null &&
    (gps.fix.lockState === 'green' || gps.fix.lockState === 'yellow') &&
    !(armedType === 'zone' && !selectedController);

  const armedColor = useMemo(() => {
    if (!armedType) return '#25C1AC';
    if (armedType === 'zone' && selectedController) return selectedController.controllerColor;
    if (armedType === 'controller') return CONTROLLER_COLORS[0];
    return '#25C1AC';
  }, [armedType, selectedController]);

  // ─── Render ────────────────────────────────────────────────────────────────

  // MC7: sync queue derived state
  const communityPendingEntries = useMemo(
    () =>
      pendingEntries.filter(
        (e) =>
          e.communityId === id &&
          (e.state === 'queued' || e.state === 'failed' || e.state === 'syncing'),
      ),
    [pendingEntries, id],
  );

  const hasFailedEntries = communityPendingEntries.some((e) => e.state === 'failed');
  const pendingCount = communityPendingEntries.length;
  const syncingCount = communityPendingEntries.filter((e) => e.state === 'syncing').length;
  const failedCount = communityPendingEntries.filter((e) => e.state === 'failed').length;
  const queuedCount = communityPendingEntries.filter((e) => e.state === 'queued').length;

  const pendingPinMarkers = useMemo<PendingPinMarker[]>(
    () =>
      communityPendingEntries
        .filter((e) => e.latitude != null && e.longitude != null)
        .map((e) => ({
          id: e.id,
          label: e.label,
          assetType: e.assetType,
          latitude: e.latitude!,
          longitude: e.longitude!,
          state: e.state as 'queued' | 'syncing' | 'failed',
        })),
    [communityPendingEntries],
  );

  const handleSyncAll = async () => {
    setIsSyncing(true);
    setShowSyncSuccess(false);
    try {
      await syncNow();
      setShowSyncSuccess(true);
      setTimeout(() => setShowSyncSuccess(false), 2000);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleRetry = async (entryId: string) => {
    await retryEntry(entryId);
  };

  const handleDropPinPress = useCallback(() => {
    setMapTapEnabled(true);
  }, []);

  const handleCancelTapMode = useCallback(() => {
    setMapTapEnabled(false);
  }, []);

  const handleMapTap = useCallback((latitude: number, longitude: number) => {
    setMapTapEnabled(false);
    setPinDropCoords({ latitude, longitude });
  }, []);

  const SyncChip =
    showSyncSuccess && pendingCount === 0 ? (
      <View style={[styles.syncChip, styles.syncChipSuccess]}>
        <Ionicons name="checkmark-circle-outline" size={13} color="#14532d" />
        <Text style={[styles.syncChipText, styles.syncChipTextSuccess]}>Synced</Text>
      </View>
    ) : pendingCount > 0 || isSyncing ? (
      <TouchableOpacity
        style={[
          styles.syncChip,
          hasFailedEntries
            ? styles.syncChipFailed
            : isSyncing
              ? styles.syncChipSyncing
              : styles.syncChipPending,
        ]}
        onPress={hasFailedEntries ? handleSyncAll : () => setSheetVisible(true)}
        activeOpacity={0.7}
      >
        {isSyncing && syncingCount > 0 ? (
          <ActivityIndicator size="small" color="#1e3a5f" style={{ width: 13, height: 13 }} />
        ) : (
          <Ionicons
            name={hasFailedEntries ? 'warning-outline' : 'cloud-upload-outline'}
            size={13}
            color={hasFailedEntries ? '#7f1d1d' : isSyncing ? '#1e3a5f' : '#713f12'}
          />
        )}
        <Text
          style={[
            styles.syncChipText,
            hasFailedEntries
              ? styles.syncChipTextFailed
              : isSyncing
                ? styles.syncChipTextSyncing
                : styles.syncChipTextPending,
          ]}
        >
          {isSyncing && syncingCount > 0
            ? `${syncingCount} syncing…`
            : hasFailedEntries
              ? `${failedCount} failed — retry`
              : `${queuedCount} queued`}
        </Text>
      </TouchableOpacity>
    ) : null;

  // MC8: review handlers
  const handleShowOnMap = useCallback((asset: { id: string; latitude: number | null; longitude: number | null; label: string }) => {
    if (asset.latitude == null || asset.longitude == null) {
      showToast(`No coordinates recorded for "${asset.label}"`, 'error');
      return;
    }
    setTargetRegion({ latitude: asset.latitude, longitude: asset.longitude, label: asset.label });
    setReviewMode(false);
  }, [showToast]);

  const handleReshoot = useCallback((asset: {
    id: string;
    label: string;
    assetType: string;
    version: number;
    latitude: number | null;
    longitude: number | null;
    properties?: Record<string, string>;
  }) => {
    if (asset.latitude == null || asset.longitude == null) {
      showToast(`No coordinates recorded for "${asset.label}"`, 'error');
      return;
    }

    const description = asset.properties?.description ?? '';
    const parentControllerFeatureRef =
      asset.assetType === 'zone' ? (asset.properties?.controllerFeatureRef ?? null) : null;

    setReshootContext({
      assetId: asset.id,
      assetVersion: asset.version,
      label: asset.label,
      assetType: asset.assetType,
      description,
      parentControllerFeatureRef,
    });

    setReviewMode(false);
    setTargetRegion({ latitude: asset.latitude, longitude: asset.longitude, label: `Re-shoot: ${asset.label}` });
    setReshootHighlight({ latitude: asset.latitude, longitude: asset.longitude });

    if (asset.assetType === 'zone') {
      setArmedType('zone');
      if (parentControllerFeatureRef) {
        const parentCtrl =
          controllers.find((c) => (c.featureRef ?? c.id) === parentControllerFeatureRef) ?? null;
        if (parentCtrl) {
          setSelectedController(parentCtrl);
        } else {
          setPickerVisible(true);
        }
      } else {
        setPickerVisible(true);
      }
    } else {
      setArmedType(asset.assetType);
    }

    showToast(`"${asset.label}" — drop a replacement pin when ready`, 'success');
  }, [showToast, controllers]);

  // Quality deep-link: when opened with a targetPinId, surface an explicit
  // "Re-capture this pin" CTA banner rather than auto-entering reshoot mode.
  const targetPinHandledRef = useRef(false);
  const [targetPinAsset, setTargetPinAsset] = useState<Asset | null>(null);
  useEffect(() => {
    if (!targetPinId || !MC_UX_V2 || targetPinHandledRef.current) return;
    const asset = activeAssets.find((a) => a.id === targetPinId);
    if (!asset) return;
    targetPinHandledRef.current = true;
    setTargetPinAsset(asset);
  }, [targetPinId, activeAssets]);

  const handleLockCommunity = useCallback(() => {
    Alert.alert(
      'Mark customer complete & lock?',
      `This will lock ${community?.name} for map editing. Admins can unlock it later if changes are needed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Lock',
          style: 'destructive',
          onPress: async () => {
            setLocking(true);
            try {
              const res = await apiRequest('PATCH', `/api/communities/${id}/map-creator-lock`, { locked: true });
              if (!res.ok) {
                const body: { error?: string } = await res.json().catch(() => ({}));
                showToast(body.error ?? 'Failed to lock community', 'error');
                return;
              }
              showToast('Customer locked', 'success');
              await refreshCommunities();
              setTimeout(() => {
                router.replace('/(mc-tabs)' as any);
              }, 1200);
            } catch {
              showToast('Failed to lock community', 'error');
            } finally {
              setLocking(false);
            }
          },
        },
      ]
    );
  }, [id, community?.name, showToast, refreshCommunities, router]);

  // --- Not found guard ---
  if (!community) {
    return (
      <View style={styles.container}>
        <StatusBarFill />
        <View style={[styles.headerBar, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity onPress={() => router.replace('/(mc-tabs)' as any)} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color="#0C1D31" />
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>Workspace</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.centeredState}>
          <Ionicons name="alert-circle-outline" size={52} color="#f44336" />
          <Text style={styles.notFoundTitle}>Customer not found</Text>
          <TouchableOpacity style={styles.ctaBtn} onPress={() => router.replace('/(mc-tabs)' as any)} activeOpacity={0.8}>
            <Ionicons name="arrow-back" size={16} color="#fff" />
            <Text style={styles.ctaBtnText}>Back to Customers</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const isLocked = community.isMapCreatorLocked === true;
  const lockedDate = community.mapCreatorLockedAt
    ? new Date(community.mapCreatorLockedAt).toLocaleDateString()
    : null;

  return (
    <View style={styles.container}>
      <StatusBarFill />

      {/* Header: back | center | GPS pill + SyncChip (MC7) + Review toggle (MC8) */}
      <View style={[styles.headerBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.replace('/(mc-tabs)' as any)} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#0C1D31" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>{community.name}</Text>
          {countSubtitle ? (
            <Text style={styles.headerSubtitle} numberOfLines={1}>{countSubtitle}</Text>
          ) : null}
        </View>
        {!isLocked && (
          <View style={styles.headerRight}>
            <View style={[styles.lockPill, { backgroundColor: haloColor + '22' }]}>
              <View style={[styles.lockDot, { backgroundColor: haloColor }]} />
              <Text style={[styles.lockLabel, { color: haloColor }]}>
                {LOCK_LABELS[gps.fix?.lockState ?? 'red']}
              </Text>
            </View>
            {SyncChip}
            <TouchableOpacity
              style={[styles.reviewToggle, reviewMode && styles.reviewToggleActive]}
              onPress={() => setReviewMode(v => !v)}
              activeOpacity={0.7}
            >
              <Ionicons name={reviewMode ? 'eye' : 'eye-outline'} size={16} color={reviewMode ? '#fff' : '#25C1AC'} />
              <Text style={[styles.reviewToggleText, reviewMode && styles.reviewToggleTextActive]}>Review</Text>
            </TouchableOpacity>
          </View>
        )}
        {isLocked && <View style={styles.headerSpacer} />}
      </View>

      {/* GPS permission denied banner */}
      {gps.permissionDenied && !isLocked && (
        <View style={styles.permissionBanner}>
          <Ionicons name="location-outline" size={16} color="#92400e" />
          <Text style={styles.permissionBannerText}>
            Location access is off. GPS is required to place assets.
          </Text>
          <TouchableOpacity onPress={gps.openSettings} style={styles.permissionBannerBtn} activeOpacity={0.8}>
            <Text style={styles.permissionBannerBtnText}>Open Settings</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Locked banner (MC8) */}
      {isLocked && (
        <View style={styles.lockedBanner}>
          <Ionicons name="lock-closed" size={16} color="#b45309" />
          <Text style={styles.lockedBannerText}>
            {lockedDate ? `Locked on ${lockedDate}.` : 'Locked.'} Ask an admin to unlock if changes are needed.
          </Text>
        </View>
      )}

      {/* Re-capture CTA banner — shown when arriving from Quality tab deep-link */}
      {targetPinAsset && MC_UX_V2 && !isLocked && (
        <View style={styles.recaptureBanner}>
          <Ionicons name="location-outline" size={14} color="#25C1AC" />
          <Text style={styles.recaptureLabel} numberOfLines={1}>{targetPinAsset.label}</Text>
          <TouchableOpacity
            style={styles.recaptureBtn}
            onPress={() => { handleReshoot(targetPinAsset); setTargetPinAsset(null); }}
            activeOpacity={0.8}
          >
            <Text style={styles.recaptureBtnText}>Re-capture</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setTargetPinAsset(null)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="close" size={16} color="#6b7280" />
          </TouchableOpacity>
        </View>
      )}

      {/* Map — always mounted so flyTo (MC8) works even when review panel is open */}
      <View style={styles.mapContainer}>
        <LeafletMap
          tasks={[]}
          userLocation={userLocation}
          onTaskPress={() => {}}
          layers={activeLayers}
          initialBounds={boundsData?.bounds ?? null}
          controllerMarkers={controllerMarkers}
          zoneMarkers={zoneMarkers}
          showControllers={activeLayer === 'irrigation' && controllerMarkers.length > 0}
          showZones={activeLayer === 'irrigation' && zoneMarkers.length > 0}
          userLocationHalo={userLocationHalo}
          pendingPins={pendingPinMarkers}
          mapTapEnabled={mapTapEnabled}
          onMapTap={handleMapTap}
          targetRegion={targetRegion}
          reshootHighlight={reshootHighlight}
          accuracyRing={savedRing}
          showSatelliteToggle
        />

        {/* MC4/MC6/MC7 overlays — hidden when review mode is active */}
        {!reviewMode && (
          <>
            {MC_UX_V2 ? (
              <MapCreatorChrome
                activeLayer={activeLayer}
                onLayerChange={(layer) => {
                  setActiveLayer(layer);
                  setArmedType(null);
                  setSelectedController(null);
                }}
                armedType={armedType}
                onArmType={(type) => {
                  if (type === 'zone') {
                    setArmedType('zone');
                    setSelectedController(null);
                    setPickerVisible(true);
                  } else {
                    setArmedType(type);
                    setSelectedController(null);
                    setAddingControllerForZone(false);
                  }
                }}
                lockState={gps.fix?.lockState ?? 'red'}
                typeCounts={typeCounts}
                isLocked={isLocked}
                hasControllers={controllers.length > 0}
                captureMode={captureMode}
                onCaptureModeChange={(mode) => {
                  setCaptureMode(mode);
                  setCaptureTimeoutCount(0);
                }}
                onCaptureHere={handleCaptureHere}
                isCaptureRunning={isCaptureRunning}
                captureProgress={captureProgress}
                captureSamplesCount={captureSamplesCount}
                captureTotalTarget={CAPTURE_TARGET_SAMPLES}
                captureSecondsLeft={captureSecondsLeft}
                captureTimeoutCount={captureTimeoutCount}
                zoneNeedsController={armedType === 'zone' && !selectedController}
                onArmController={() => setPickerVisible(true)}
                onCanopySuggest={() =>
                  showToast('Weak GPS signal — tap 🍃 Canopy for better accuracy under tree cover.', 'success')
                }
              />
            ) : (
              <>
                <MapCreatorOverlay
                  activeLayer={activeLayer}
                  onLayerChange={(layer) => {
                    setActiveLayer(layer);
                    setArmedType(null);
                    setSelectedController(null);
                  }}
                  armedType={armedType}
                  onArmType={handleArmType}
                  typeCounts={typeCounts}
                  lockState={gps.fix?.lockState ?? 'red'}
                />

                {mapTapEnabled && (
                  <View style={styles.tapOverlay} pointerEvents="none">
                    <View style={styles.tapHint}>
                      <Ionicons name="locate-outline" size={15} color="#fff" />
                      <Text style={styles.tapHintText}>Tap the map to place a pin</Text>
                    </View>
                  </View>
                )}

                {!isLocked && (
                  <TouchableOpacity
                    style={[styles.dropPinFab, mapTapEnabled && styles.dropPinFabCancel]}
                    onPress={mapTapEnabled ? handleCancelTapMode : handleDropPinPress}
                    activeOpacity={0.85}
                  >
                    <Ionicons
                      name={mapTapEnabled ? 'close' : 'add'}
                      size={18}
                      color="#fff"
                    />
                    <Text style={styles.dropPinFabText}>
                      {mapTapEnabled ? 'Cancel' : 'Drop Pin'}
                    </Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </>
        )}

        {/* MC8: Review panel overlays map so LeafletMap stays mounted for flyTo */}
        {reviewMode && (
          <View style={styles.reviewOverlay}>
            <View style={styles.tabBar}>
              <TouchableOpacity
                style={[styles.tab, reviewTab === 'tally' && styles.tabActive]}
                onPress={() => setReviewTab('tally')}
                activeOpacity={0.7}
              >
                <Ionicons name="bar-chart-outline" size={16} color={reviewTab === 'tally' ? '#25C1AC' : '#9ca3af'} />
                <Text style={[styles.tabText, reviewTab === 'tally' && styles.tabTextActive]}>Tally</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tab, reviewTab === 'reshoot' && styles.tabActive]}
                onPress={() => setReviewTab('reshoot')}
                activeOpacity={0.7}
              >
                <Ionicons name="camera-outline" size={16} color={reviewTab === 'reshoot' ? '#25C1AC' : '#9ca3af'} />
                <Text style={[styles.tabText, reviewTab === 'reshoot' && styles.tabTextActive]}>
                  Re-shoot
                  {reshootAssets.length > 0 && (
                    <Text style={styles.reshootBadge}> {reshootAssets.length}</Text>
                  )}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.panelContent}>
              {assetsQuery.isLoading ? (
                <View style={styles.centeredState}>
                  <ActivityIndicator size="large" color="#25C1AC" />
                </View>
              ) : reviewTab === 'tally' ? (
                <TallyPanel
                  assets={activeAssets}
                  controllers={reviewControllersQuery.data ?? []}
                />
              ) : (
                <ReshootList
                  assets={reshootAssets}
                  onShowOnMap={handleShowOnMap}
                  onReshoot={handleReshoot}
                />
              )}
            </View>

            <View style={styles.lockBtnContainer}>
              <TouchableOpacity
                style={[styles.lockBtn, locking && styles.lockBtnDisabled]}
                onPress={handleLockCommunity}
                disabled={locking}
                activeOpacity={0.8}
              >
                {locking ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="lock-closed" size={18} color="#fff" />
                )}
                <Text style={styles.lockBtnText}>Mark customer complete & lock</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      {/* Pin hint card — only shown when armed and not in review mode (legacy V1 flow) */}
      {!MC_UX_V2 && armedType && armedTypeDef && !reviewMode && !mapTapEnabled && (
        <View style={[styles.hintCard, { paddingBottom: insets.bottom + 12 }]}>
          {armedType === 'zone' && !selectedController ? (
            <Text style={styles.hintText}>
              Select a <Text style={styles.hintTypeName}>Controller</Text> for this zone.
            </Text>
          ) : (
            <Text style={styles.hintText}>
              Drop a <Text style={styles.hintTypeName}>{armedTypeDef.label}</Text>{' '}
              {armedType === 'zone' && selectedController
                ? `in Controller ${selectedController.controllerKey}. `
                : ''}
              {(gps.fix?.lockState ?? 'red') === 'red' ? 'No GPS signal — move outdoors.' : gps.fix?.lockState === 'yellow' ? 'Acquiring GPS lock…' : 'GPS locked — ready to place.'}
            </Text>
          )}

          {armedType === 'zone' && !selectedController ? (
            <TouchableOpacity
              style={[styles.lockPinBtn, { backgroundColor: '#25C1AC10', borderColor: '#25C1AC' }]}
              onPress={() => setPickerVisible(true)}
              activeOpacity={0.8}
            >
              <Ionicons name="git-network-outline" size={16} color="#25C1AC" />
              <Text style={[styles.lockPinBtnText, { color: '#25C1AC' }]}>
                Select Controller
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[
                styles.lockPinBtn,
                canLockPin && { backgroundColor: armedColor + '18', borderColor: armedColor },
              ]}
              onPress={handleLockPin}
              disabled={!canLockPin}
              activeOpacity={0.8}
            >
              <Ionicons
                name="pin"
                size={16}
                color={canLockPin ? armedColor : '#9ca3af'}
              />
              <Text style={[styles.lockPinBtnText, canLockPin && { color: armedColor }]}>
                Lock Pin Here
              </Text>
            </TouchableOpacity>
          )}

          {armedType && (
            <TouchableOpacity onPress={disarm} style={styles.disarmLink}>
              <Text style={styles.disarmLinkText}>Cancel</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* ControllerPicker — shown when arming Zone or adding controller for zone */}
      <ControllerPicker
        visible={pickerVisible}
        communityId={communityId}
        onSelect={handleControllerSelected}
        onAddNewController={handleAddNewController}
        onClose={handlePickerClose}
        highlightedControllerId={newlyAddedControllerId}
      />

      <Toast
        visible={toastVisible}
        message={toastMessage}
        type={toastType}
        toastKey={toastKey}
      />

      {/* MC7: Pending pins sheet */}
      <PendingSheet
        visible={sheetVisible}
        onClose={() => setSheetVisible(false)}
        entries={communityPendingEntries}
        onRetry={handleRetry}
        onSyncAll={handleSyncAll}
        isSyncing={isSyncing}
      />

      {/* MC7: Pin drop sheet */}
      {pinDropCoords && (
        <PinDropSheet
          visible={pinDropCoords !== null}
          onClose={() => setPinDropCoords(null)}
          communityId={communityId}
          latitude={pinDropCoords.latitude}
          longitude={pinDropCoords.longitude}
          onPinCreated={() => {
            setPinDropCoords(null);
            refreshList();
          }}
        />
      )}

      {lockPinFix && armedType && (
        <LockPinSheet
          visible={lockPinFix !== null}
          fix={lockPinFix}
          armedType={armedType}
          communityId={communityId}
          existingLabels={existingLabelsByType[armedType] ?? []}
          parentController={armedType === 'zone' ? selectedController : null}
          existingZoneNumbers={armedType === 'zone' ? existingZoneNumbers : []}
          onDismiss={() => setLockPinFix(null)}
          capturedUnderCanopy={captureMode === 'canopy'}
          existingAssetId={reshootContext?.assetId}
          existingAssetVersion={reshootContext?.assetVersion}
          initialLabel={reshootContext?.label}
          initialDescription={reshootContext?.description}
          onSaved={(asset) => {
            const savedType = armedType;
            const wasAddingForZone = addingControllerForZone;
            if (lockPinFix && lockPinFix.accuracy && asset.latitude != null && asset.longitude != null) {
              const ring = { latitude: asset.latitude, longitude: asset.longitude, accuracyM: lockPinFix.accuracy };
              setSavedRing(ring);
              setTimeout(() => setSavedRing(null), 3200);
            }
            disarm();
            // LockPinSheet invalidates map-layers and controllers internally.
            // Invalidate the workspace asset list and quality tab list here.
            queryClient.invalidateQueries({ queryKey: ['/api/assets', { communityId }] });
            queryClient.invalidateQueries({ queryKey: ['mc-assets', id] });
            refreshList();
            const ctx = reshootContext;
            if (ctx) {
              // In-place GPS recapture: LockPinSheet already PATCHed the asset.
              // Just clear the reshoot state — no archive step needed.
              setReshootContext(null);
              setReshootHighlight(null);
            } else if (savedType === 'controller') {
                setNewlyAddedControllerId(asset.id);
                if (wasAddingForZone) {
                  setTimeout(() => {
                    setArmedType('zone');
                    setPickerVisible(true);
                  }, 600);
                }
              }
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f7fa',
  },
  recaptureBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#f0fdf9',
    borderBottomWidth: 1,
    borderBottomColor: '#d1fae5',
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  recaptureLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#0C1D31',
    minWidth: 0,
  },
  recaptureBtn: {
    backgroundColor: '#25C1AC',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  recaptureBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingBottom: 6,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    zIndex: 10,
    gap: 8,
  },
  backBtn: {
    padding: 4,
  },
  headerCenter: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0C1D31',
  },
  headerSubtitle: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  headerSpacer: {
    width: 30,
  },
  lockPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 20,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  lockDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  lockLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
  syncChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
    minWidth: 36,
  },
  syncChipPending: {
    backgroundColor: '#fef3c7',
  },
  syncChipFailed: {
    backgroundColor: '#fee2e2',
  },
  syncChipSyncing: {
    backgroundColor: '#dbeafe',
  },
  syncChipSuccess: {
    backgroundColor: '#dcfce7',
  },
  syncChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  syncChipTextPending: {
    color: '#713f12',
  },
  syncChipTextFailed: {
    color: '#7f1d1d',
  },
  syncChipTextSyncing: {
    color: '#1e3a5f',
  },
  syncChipTextSuccess: {
    color: '#14532d',
  },
  reviewToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1.5,
    borderColor: '#25C1AC',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  reviewToggleActive: {
    backgroundColor: '#25C1AC',
    borderColor: '#25C1AC',
  },
  reviewToggleText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#25C1AC',
  },
  reviewToggleTextActive: {
    color: '#fff',
  },
  permissionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fef3c7',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#fde68a',
  },
  permissionBannerText: {
    flex: 1,
    fontSize: 13,
    color: '#92400e',
    lineHeight: 18,
  },
  permissionBannerBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    backgroundColor: '#d97706',
    borderRadius: 8,
  },
  permissionBannerBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  lockedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fef3c7',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#fde68a',
  },
  lockedBannerText: {
    flex: 1,
    fontSize: 13,
    color: '#92400e',
    lineHeight: 18,
  },
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
  tapOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 14,
    pointerEvents: 'none' as any,
  },
  tapHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.62)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  tapHintText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  dropPinFab: {
    position: 'absolute',
    bottom: 88,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#25C1AC',
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 6,
  },
  dropPinFabCancel: {
    backgroundColor: '#6b7280',
  },
  dropPinFabText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  reviewOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#f5f7fa',
    flexDirection: 'column',
  },
  hintCard: {
    backgroundColor: '#fff',
    paddingTop: 14,
    paddingHorizontal: 18,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 4,
  },
  hintText: {
    fontSize: 13,
    color: '#374151',
    lineHeight: 19,
    textAlign: 'center',
  },
  hintTypeName: {
    fontWeight: '700',
    color: '#0C1D31',
  },
  lockPinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: '#f3f4f6',
    borderRadius: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  lockPinBtnEnabled: {
    backgroundColor: '#4CAF50',
    borderColor: '#388E3C',
    opacity: 1,
  },
  lockPinBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#9ca3af',
  },
  disarmLink: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  disarmLinkText: {
    fontSize: 13,
    color: '#9ca3af',
  },
  centeredState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 10,
  },
  notFoundTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0C1D31',
  },
  ctaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#25C1AC',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 22,
    marginTop: 4,
  },
  ctaBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: '#25C1AC',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9ca3af',
  },
  tabTextActive: {
    color: '#25C1AC',
  },
  reshootBadge: {
    color: '#ea580c',
  },
  panelContent: {
    flex: 1,
  },
  lockBtnContainer: {
    padding: 16,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  lockBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#0C1D31',
    borderRadius: 14,
    paddingVertical: 16,
  },
  lockBtnDisabled: {
    opacity: 0.6,
  },
  lockBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
});

const sheetStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '75%',
    paddingTop: 10,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 12,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#e5e7eb',
    alignSelf: 'center',
    marginBottom: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: '#0C1D31',
  },
  closeBtn: {
    padding: 4,
  },
  syncAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#25C1AC',
    borderRadius: 10,
    paddingVertical: 11,
    marginBottom: 14,
  },
  syncAllBtnDisabled: {
    backgroundColor: '#9ca3af',
  },
  syncAllBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  list: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
    gap: 10,
  },
  stateIndicator: {
    width: 10,
    height: 10,
    borderRadius: 5,
    flexShrink: 0,
  },
  stateQueued: {
    backgroundColor: '#fbbf24',
  },
  stateSyncing: {
    backgroundColor: '#60a5fa',
  },
  stateFailed: {
    backgroundColor: '#f87171',
  },
  rowContent: {
    flex: 1,
  },
  rowLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0C1D31',
  },
  rowMeta: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 2,
  },
  rowError: {
    fontSize: 11,
    color: '#ef4444',
    marginTop: 2,
    lineHeight: 15,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#25C1AC',
    backgroundColor: '#f0fdfb',
  },
  retryBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#25C1AC',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 10,
  },
  emptyText: {
    fontSize: 15,
    color: '#6b7280',
    fontWeight: '500',
  },
});
