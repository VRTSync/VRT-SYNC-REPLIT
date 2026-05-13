import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Modal, ScrollView, ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCommunity } from '@/client/contexts/CommunityContext';
import { useHighAccuracyLocation } from '@/hooks/useHighAccuracyLocation';
import { apiRequest } from '@/lib/query-client';
import { getDefaultLayerColor, CONTROLLER_COLORS } from '@/shared/layerColors';
import StatusBarFill from '@/components/StatusBarFill';
import Toast from '@/components/Toast';
import LeafletMap, { type PendingPinMarker } from '@/components/LeafletMap';
import MapCreatorOverlay from '@/components/MapCreatorOverlay';
import ControllerPicker, { type ControllerRow } from '@/components/ControllerPicker';
import PinDropSheet from '@/components/PinDropSheet';
import { MC_LAYER_MAP, type McLayerKey } from '@/lib/mcAssetTypeCatalog';
import { usePinQueue } from '@/client/contexts/PinQueueContext';
import { type PendingPinEntry } from '@/lib/pinCreationQueue';

type MapLayerMeta = {
  id: string;
  communityId: string;
  layerKey: string;
  subLayerKey: string;
  displayName: string;
  version: number;
  color?: string;
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

export default function McWorkspaceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { communities, setActiveCommunity } = useCommunity();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  // MC7: sync queue
  const { pendingEntries, syncNow, retryEntry, refreshList } = usePinQueue();
  const [sheetVisible, setSheetVisible] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [mapTapEnabled, setMapTapEnabled] = useState(false);
  const [pinDropCoords, setPinDropCoords] = useState<{ latitude: number; longitude: number } | null>(null);

  const community = communities.find((c) => c.id === id) ?? null;

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

  // ─── MC4: map / GPS state ────────────────────────────────────────────────
  const [activeLayer, setActiveLayer] = useState<McLayerKey>('trees');
  const [armedType, setArmedType] = useState<string | null>(null);
  const [loadedGeoJSON, setLoadedGeoJSON] = useState<Record<string, any>>({});
  const loadedGeoJSONRef = useRef(loadedGeoJSON);
  loadedGeoJSONRef.current = loadedGeoJSON;
  const loadingGeoJSONRef = useRef<Set<string>>(new Set());

  const gps = useHighAccuracyLocation();

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
  const [pinLat, setPinLat] = useState<number | null>(null);
  const [pinLng, setPinLng] = useState<number | null>(null);
  const [pinDropVisible, setPinDropVisible] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error'>('success');
  const [toastKey, setToastKey] = useState(0);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const { data: assetsData } = useQuery<any[]>({
    queryKey: [`/api/communities/${communityId}/assets`],
    enabled: !!communityId,
  });

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
  }, [allLayers, loadedGeoJSON, controllers, controllerColorMap]);

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

  const haloColor = LOCK_COLORS[gps.lockState] ?? '#F44336';

  const userLocationHalo = useMemo(() => {
    if (!armedType || gps.latitude == null || gps.longitude == null || gps.accuracy == null) {
      return null;
    }
    return { lat: gps.latitude, lng: gps.longitude, accuracyMetres: gps.accuracy, color: haloColor };
  }, [armedType, gps.latitude, gps.longitude, gps.accuracy, haloColor]);

  const userLocation = useMemo(() => {
    if (gps.latitude == null || gps.longitude == null) return null;
    return { latitude: gps.latitude, longitude: gps.longitude };
  }, [gps.latitude, gps.longitude]);

  const armedTypeDef = useMemo(() => {
    if (!armedType) return null;
    for (const layerKey of Object.keys(MC_LAYER_MAP) as McLayerKey[]) {
      const found = MC_LAYER_MAP[layerKey].types.find((t) => t.key === armedType);
      if (found) return found;
    }
    return null;
  }, [armedType]);

  const existingLabels = useMemo(() => {
    if (!assetsData) return [];
    return assetsData.map((a: any) => a.label ?? '').filter(Boolean);
  }, [assetsData]);

  const existingZoneNumbers = useMemo(() => {
    if (!controllers.length || !selectedController) return [];
    const ctrl = controllers.find((c) => c.id === selectedController.id);
    if (!ctrl) return [];
    return ctrl.zones
      .map((z) => z.zoneNumber)
      .filter((n): n is number => typeof n === 'number');
  }, [controllers, selectedController]);

  // ─── Creation flow handlers ────────────────────────────────────────────────

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastMessage(message);
    setToastType(type);
    setToastKey((k) => k + 1);
    setToastVisible(true);
    toastTimeoutRef.current = setTimeout(() => setToastVisible(false), 3500);
  }, []);

  const disarm = () => {
    setArmedType(null);
    setSelectedController(null);
    setAddingControllerForZone(false);
    setPinLat(null);
    setPinLng(null);
    setPinDropVisible(false);
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

  /** "Lock Pin Here" — captures current GPS position and opens PinDropSheet. */
  const handleLockPin = () => {
    if (gps.latitude == null || gps.longitude == null) return;
    if (!armedType) return;
    if (armedType === 'zone' && !selectedController) {
      setPickerVisible(true);
      return;
    }
    setPinLat(gps.latitude);
    setPinLng(gps.longitude);
    setPinDropVisible(true);
  };

  const handlePinSave = (assetId: string, label: string) => {
    setPinDropVisible(false);
    const savedType = armedType;
    const wasAddingForZone = addingControllerForZone;

    disarm();

    if (savedType === 'controller') {
      queryClient.invalidateQueries({ queryKey: ['/api/communities', communityId, 'controllers'] });
      setNewlyAddedControllerId(assetId);
      if (wasAddingForZone) {
        setTimeout(() => {
          setArmedType('zone');
          setPickerVisible(true);
        }, 600);
      }
    }

    showToast(`${label} saved`, 'success');
  };

  const handlePinClose = () => {
    setPinDropVisible(false);
    setPinLat(null);
    setPinLng(null);
  };

  const canLockPin =
    !!armedType &&
    gps.lockState === 'green' &&
    gps.latitude != null &&
    gps.longitude != null &&
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
    try {
      await syncNow();
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

  const SyncChip = pendingCount > 0 ? (
    <TouchableOpacity
      style={[
        styles.syncChip,
        hasFailedEntries ? styles.syncChipFailed : styles.syncChipPending,
      ]}
      onPress={() => setSheetVisible(true)}
      activeOpacity={0.7}
    >
      <Ionicons
        name={hasFailedEntries ? 'warning-outline' : 'cloud-upload-outline'}
        size={13}
        color={hasFailedEntries ? '#7f1d1d' : '#713f12'}
      />
      <Text
        style={[
          styles.syncChipText,
          hasFailedEntries ? styles.syncChipTextFailed : styles.syncChipTextPending,
        ]}
      >
        {pendingCount}
      </Text>
    </TouchableOpacity>
  ) : null;

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

  return (
    <View style={styles.container}>
      <StatusBarFill />

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
        <View style={styles.headerRight}>
          <View style={[styles.lockPill, { backgroundColor: haloColor + '22' }]}>
            <View style={[styles.lockDot, { backgroundColor: haloColor }]} />
            <Text style={[styles.lockLabel, { color: haloColor }]}>
              {LOCK_LABELS[gps.lockState]}
            </Text>
          </View>
          {SyncChip}
        </View>
      </View>

      <View style={styles.mapContainer}>
        <LeafletMap
          tasks={[]}
          userLocation={userLocation}
          onTaskPress={() => {}}
          layers={activeLayers}
          initialBounds={boundsData?.bounds ?? null}
          controllerMarkers={controllerMarkers}
          zoneMarkers={zoneMarkers}
          showControllers={controllerMarkers.length > 0}
          showZones={zoneMarkers.length > 0}
          userLocationHalo={userLocationHalo}
          pendingPins={pendingPinMarkers}
          mapTapEnabled={mapTapEnabled}
          onMapTap={handleMapTap}
        />

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
          lockState={gps.lockState}
        />

        {mapTapEnabled && (
          <View style={styles.tapOverlay} pointerEvents="none">
            <View style={styles.tapHint}>
              <Ionicons name="locate-outline" size={15} color="#fff" />
              <Text style={styles.tapHintText}>Tap the map to place a pin</Text>
            </View>
          </View>
        )}

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
      </View>

      {armedType && armedTypeDef && !mapTapEnabled && (
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
              {gps.lockState !== 'green' ? 'Waiting for GPS lock…' : 'GPS locked — ready to place.'}
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

      {/* PinDropSheet — opened via Lock Pin Here button */}
      {armedType && pinLat !== null && pinLng !== null && (
        <PinDropSheet
          visible={pinDropVisible}
          assetType={armedType}
          assetColor={armedColor}
          latitude={pinLat}
          longitude={pinLng}
          communityId={communityId}
          existingLabels={existingLabels}
          parentController={armedType === 'zone' ? selectedController : null}
          existingZoneNumbers={existingZoneNumbers}
          onClose={handlePinClose}
          onSave={handlePinSave}
        />
      )}

      <Toast
        visible={toastVisible}
        message={toastMessage}
        type={toastType}
        toastKey={toastKey}
      />

      <PendingSheet
        visible={sheetVisible}
        onClose={() => setSheetVisible(false)}
        entries={communityPendingEntries}
        onRetry={handleRetry}
        onSyncAll={handleSyncAll}
        isSyncing={isSyncing}
      />

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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f7fa',
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingBottom: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    zIndex: 10,
  },
  backBtn: {
    padding: 4,
    marginRight: 8,
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
