import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, ScrollView, Switch, ActivityIndicator } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiRequest, getQueryFn } from '@/lib/query-client';
import StatusBarFill from '@/components/StatusBarFill';
import { useCommunity } from '@/client/contexts/CommunityContext';
import { useOffline } from '@/client/contexts/OfflineContext';
import { useOfflinePack } from '@/client/contexts/OfflinePackContext';

type Task = {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  latitude: number | null;
  longitude: number | null;
  address: string | null;
};

type MapLayerMeta = {
  id: string;
  communityId: string;
  layerKey: string;
  subLayerKey: string;
  displayName: string;
  version: number;
};

type AssetInfo = {
  id: string;
  assetType: string;
  label: string;
  featureRef: string | null;
  properties: { key: string; value: string }[];
  controllerLabel?: string;
  controllerColor?: string;
  controllerFeatureRef?: string;
  zoneNumber?: number | null;
  zoneType?: string | null;
  zoneCount?: number;
};

type ControllerInfo = {
  id: string;
  label: string;
  featureRef: string | null;
  controllerKey: string;
  controllerColor: string;
  latitude: number | null;
  longitude: number | null;
  zoneCount: number;
  zones: {
    id: string;
    label: string;
    featureRef: string | null;
    zoneNumber: number | null;
    zoneType: string | null;
    zoneLabelShort: string | null;
    latitude: number | null;
    longitude: number | null;
  }[];
};

const CATEGORY_TABS = [
  { key: 'community', label: 'Community', icon: 'business-outline' as const },
  { key: 'irrigation', label: 'Irrigation', icon: 'water-outline' as const },
  { key: 'snow', label: 'Snow', icon: 'snow-outline' as const },
  { key: 'trees', label: 'Trees', icon: 'leaf-outline' as const },
];

const priorityColors: Record<string, string> = {
  low: '#4caf50',
  medium: '#ff9800',
  high: '#f44336',
  urgent: '#9c27b0',
};

const layerColors = [
  '#25C1AC', '#3498db', '#e74c3c', '#f39c12', '#9b59b6',
  '#1abc9c', '#e67e22', '#2980b9', '#c0392b', '#27ae60',
];

export default function MapScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ category?: string; targetLat?: string; targetLng?: string; targetLabel?: string }>();
  const { activeCommunity } = useCommunity();
  const { isOnline } = useOffline();
  const { localPack, getOfflineGeoJSON, resolveFeatureToAsset, getOfflineManifest } = useOfflinePack();
  const insets = useSafeAreaInsets();
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [NativeMapComponent, setNativeMapComponent] = useState<React.ComponentType<any> | null>(null);
  const [activeCategory, setActiveCategory] = useState(params.category || 'community');
  const [enabledLayerIds, setEnabledLayerIds] = useState<Set<string>>(new Set());
  const [showLayerPanel, setShowLayerPanel] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<AssetInfo | null>(null);
  const [loadedGeoJSON, setLoadedGeoJSON] = useState<Record<string, any>>({});
  const [loadingGeoJSON, setLoadingGeoJSON] = useState<Set<string>>(new Set());
  const [targetRegion, setTargetRegion] = useState<{ latitude: number; longitude: number; label?: string } | null>(null);
  const [enabledControllers, setEnabledControllers] = useState<Set<string>>(new Set());
  const [showControllerLayer, setShowControllerLayer] = useState(true);
  const [showZoneLayer, setShowZoneLayer] = useState(true);

  const communityId = activeCommunity?.id;
  const useOfflineData = !isOnline && !!localPack;
  const offlineNoPack = !isOnline && !localPack;

  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: ['/api/tasks', { communityId }],
    queryFn: async () => {
      const route = communityId ? `/api/tasks?communityId=${communityId}` : '/api/tasks';
      const res = await apiRequest('GET', route);
      return res.json();
    },
    enabled: !!activeCommunity,
  });

  const { data: controllers = [] } = useQuery<ControllerInfo[]>({
    queryKey: ['/api/communities', communityId, 'controllers'],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/communities/${communityId}/controllers`);
      return res.json();
    },
    enabled: !!communityId && activeCategory === 'irrigation',
  });

  React.useEffect(() => {
    if (controllers.length > 0 && enabledControllers.size === 0) {
      const allRefs = controllers.map(c => c.featureRef || c.id);
      setEnabledControllers(new Set(allRefs));
    }
  }, [controllers.length]);

  const { data: onlineLayers = [] } = useQuery<MapLayerMeta[]>({
    queryKey: ['/api/map-layers', { communityId }],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/map-layers?communityId=${communityId}`);
      return res.json();
    },
    enabled: !!communityId && !useOfflineData,
  });

  const offlineLayers: MapLayerMeta[] = React.useMemo(() => {
    if (!useOfflineData) return [];
    const manifest = getOfflineManifest();
    if (!manifest?.layers) return [];
    return manifest.layers.map((l) => ({
      id: l.id,
      communityId: communityId || '',
      layerKey: l.layerKey,
      subLayerKey: l.subLayerKey,
      displayName: l.displayName,
      version: 0,
    }));
  }, [useOfflineData, localPack]);

  const allLayers = useOfflineData ? offlineLayers : onlineLayers;
  const categoryLayers = allLayers.filter((l) => l.layerKey === activeCategory);
  const geoTasks = tasks.filter((t) => t.latitude != null && t.longitude != null && t.status !== 'completed');

  useEffect(() => {
    if (params.category && CATEGORY_TABS.some(c => c.key === params.category)) {
      setActiveCategory(params.category);
    }
  }, [params.category]);

  useEffect(() => {
    if (params.targetLat && params.targetLng) {
      const lat = parseFloat(params.targetLat);
      const lng = parseFloat(params.targetLng);
      if (!isNaN(lat) && !isNaN(lng)) {
        setTargetRegion({ latitude: lat, longitude: lng, label: params.targetLabel });
      }
    }
  }, [params.targetLat, params.targetLng, params.targetLabel]);

  useEffect(() => {
    if (Platform.OS !== 'web') {
      import('@/components/NativeMap').then((mod) => {
        setNativeMapComponent(() => mod.default);
      });
      import('expo-location').then(async (Location) => {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({});
          setUserLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
        }
      });
    } else {
      try {
        navigator.geolocation.getCurrentPosition(
          (pos) => setUserLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
          () => {}
        );
      } catch {}
    }
  }, []);

  useEffect(() => {
    // no-op: layers start disabled, user opts in via the panel
  }, [categoryLayers.length, activeCategory]);

  const fetchGeoJSON = useCallback(async (layerId: string) => {
    if (loadedGeoJSON[layerId] || loadingGeoJSON.has(layerId)) return;

    if (useOfflineData) {
      const offlineData = getOfflineGeoJSON(layerId);
      if (offlineData) {
        setLoadedGeoJSON((prev) => ({ ...prev, [layerId]: offlineData }));
      }
      return;
    }

    setLoadingGeoJSON((prev) => new Set(prev).add(layerId));
    try {
      const res = await apiRequest('GET', `/api/map-layers/${layerId}/geojson`);
      const data = await res.json();
      if (data) {
        setLoadedGeoJSON((prev) => ({ ...prev, [layerId]: data }));
      }
    } catch (err) {
      console.error('Failed to fetch GeoJSON:', err);
    } finally {
      setLoadingGeoJSON((prev) => {
        const next = new Set(prev);
        next.delete(layerId);
        return next;
      });
    }
  }, [loadedGeoJSON, loadingGeoJSON, useOfflineData, getOfflineGeoJSON]);

  useEffect(() => {
    enabledLayerIds.forEach((id) => {
      if (!loadedGeoJSON[id]) fetchGeoJSON(id);
    });
  }, [enabledLayerIds]);

  const toggleLayer = (id: string) => {
    setEnabledLayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const enrichAssetInfo = useCallback((asset: any): AssetInfo => {
    const props: { key: string; value: string }[] = asset.properties || [];
    const enriched: AssetInfo = { ...asset, properties: props };

    if (asset.assetType === 'zone') {
      const ctrlRef = props.find(p => p.key === 'controllerFeatureRef')?.value;
      const zoneNum = props.find(p => p.key === 'zoneNumber')?.value;
      const zoneType = props.find(p => p.key === 'zoneType')?.value;
      enriched.zoneNumber = zoneNum ? parseInt(zoneNum, 10) : null;
      enriched.zoneType = zoneType || null;
      enriched.controllerFeatureRef = ctrlRef || undefined;

      if (ctrlRef) {
        const ctrl = controllers.find(c => c.featureRef === ctrlRef);
        if (ctrl) {
          enriched.controllerLabel = ctrl.label;
          enriched.controllerColor = ctrl.controllerColor;
        }
      }
    } else if (asset.assetType === 'controller') {
      const ctrlKey = props.find(p => p.key === 'controllerKey')?.value;
      const ctrlColor = props.find(p => p.key === 'controllerColor')?.value;
      enriched.controllerColor = ctrlColor || undefined;
      const ctrl = controllers.find(c => c.featureRef === asset.featureRef);
      if (ctrl) {
        enriched.zoneCount = ctrl.zoneCount;
        enriched.controllerColor = ctrl.controllerColor;
      }
    }

    return enriched;
  }, [controllers]);

  const handleFeatureTap = useCallback(async (featureRef: string, _layerKey: string) => {
    if (!communityId) return;
    if (!featureRef) return;

    if (useOfflineData) {
      const entry = resolveFeatureToAsset(featureRef);
      if (entry) {
        setSelectedAsset(enrichAssetInfo({
          id: entry.assetId,
          assetType: entry.assetType,
          label: entry.label,
          featureRef,
          properties: entry.properties,
        }));
      }
      return;
    }

    try {
      const res = await apiRequest('GET', `/api/assets/by-feature?communityId=${communityId}&featureRef=${encodeURIComponent(featureRef)}`);
      const asset = await res.json();
      if (asset && asset.id) {
        setSelectedAsset(enrichAssetInfo(asset));
      }
    } catch (err) {
      console.error('Feature tap error:', err);
    }
  }, [communityId, useOfflineData, resolveFeatureToAsset, enrichAssetInfo]);

  const controllerColorMap = React.useMemo(() => {
    const map = new Map<string, string>();
    controllers.forEach(c => {
      if (c.featureRef) map.set(c.featureRef, c.controllerColor);
    });
    return map;
  }, [controllers]);

  const controllerMarkers = useMemo(() => {
    if (!showControllerLayer || controllers.length === 0) return [];
    return controllers
      .filter(c => c.latitude != null && c.longitude != null && enabledControllers.has(c.featureRef || c.id))
      .map(c => ({
        id: c.id,
        featureRef: c.featureRef || c.id,
        label: c.label,
        controllerKey: c.controllerKey,
        color: c.controllerColor,
        latitude: c.latitude!,
        longitude: c.longitude!,
        zoneCount: c.zoneCount,
      }));
  }, [showControllerLayer, controllers, enabledControllers]);

  const zoneMarkers = useMemo(() => {
    if (!showZoneLayer || controllers.length === 0) return [];
    const zones: any[] = [];
    controllers.forEach(ctrl => {
      if (!enabledControllers.has(ctrl.featureRef || ctrl.id)) return;
      ctrl.zones.forEach(z => {
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
            latitude: z.latitude!,
            longitude: z.longitude!,
          });
        }
      });
    });
    return zones;
  }, [showZoneLayer, controllers, enabledControllers]);

  const activeLayers = React.useMemo(() => {
    return categoryLayers
      .filter((l) => enabledLayerIds.has(l.id))
      .filter((l) => {
        if (activeCategory === 'irrigation' && controllers.length > 0) {
          if (l.subLayerKey === 'controller' || l.subLayerKey === 'zone') return false;
        }
        return true;
      })
      .map((l, idx) => {
        const geojson = loadedGeoJSON[l.id] || null;

        return {
          id: l.id,
          layerKey: l.layerKey,
          subLayerKey: l.subLayerKey,
          displayName: l.displayName,
          geojson,
          color: layerColors[idx % layerColors.length],
          controllerColorMap: (l.subLayerKey === 'zone' || l.subLayerKey === 'controller') ? controllerColorMap : undefined,
        };
      });
  }, [categoryLayers, enabledLayerIds, loadedGeoJSON, activeCategory, controllers, controllerColorMap]);

  const fitToContentKey = useMemo(() => {
    const parts = [
      Array.from(enabledControllers).sort().join(','),
      Array.from(enabledLayerIds).sort().join(','),
    ];
    return parts.join('|');
  }, [enabledControllers, enabledLayerIds]);

  const mappedTasks = useMemo(() => geoTasks.map((t) => ({
    id: t.id,
    title: t.title,
    priority: t.priority,
    latitude: t.latitude!,
    longitude: t.longitude!,
    address: t.address,
  })), [geoTasks]);

  const handleTaskPress = useCallback((taskId: string) => {
    router.push(`/task/${taskId}`);
  }, [router]);

  const handleDismissAsset = useCallback(() => {
    setSelectedAsset(null);
  }, []);

  const handleAssetDetail = useCallback((assetId: string) => {
    setSelectedAsset(null);
    router.push(`/asset/${assetId}`);
  }, [router]);

  const handleAssetHistory = useCallback((assetId: string) => {
    setSelectedAsset(null);
    router.push(`/asset/${assetId}/history` as any);
  }, [router]);

  const handleTargetReached = useCallback(() => {
    setTargetRegion(null);
  }, []);

  const handleShowController = useCallback((controllerFeatureRef: string) => {
    const ctrl = controllers.find(c => c.featureRef === controllerFeatureRef);
    if (ctrl && ctrl.latitude != null && ctrl.longitude != null) {
      setSelectedAsset(null);
      setTargetRegion({
        latitude: ctrl.latitude,
        longitude: ctrl.longitude,
        label: ctrl.label,
      });
    }
  }, [controllers]);

  if (Platform.OS === 'web') {
    return (
      <View style={styles.container}>
        <StatusBarFill />
        <View style={styles.categoryBar}>
          {CATEGORY_TABS.map((cat) => (
            <TouchableOpacity
              key={cat.key}
              style={[styles.categoryTab, activeCategory === cat.key && styles.categoryTabActive]}
              onPress={() => setActiveCategory(cat.key)}
            >
              <Ionicons
                name={cat.icon}
                size={16}
                color={activeCategory === cat.key ? '#25C1AC' : '#999'}
              />
              <Text style={[styles.categoryLabel, activeCategory === cat.key && styles.categoryLabelActive]}>
                {cat.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {categoryLayers.length > 0 && (
          <View style={styles.layerListWeb}>
            {categoryLayers.filter(l => l.subLayerKey !== 'controller' && l.subLayerKey !== 'zone').map((layer, idx) => (
              <View key={layer.id} style={styles.layerToggleRow}>
                <View style={[styles.layerColorDot, { backgroundColor: layerColors[idx % layerColors.length] }]} />
                <Text style={styles.layerToggleName}>{layer.displayName}</Text>
                <Switch
                  value={enabledLayerIds.has(layer.id)}
                  onValueChange={() => toggleLayer(layer.id)}
                  trackColor={{ true: '#25C1AC', false: '#ddd' }}
                />
              </View>
            ))}
            {activeCategory === 'irrigation' && controllers.length > 0 && (
              <>
                <View style={styles.controllerSectionDivider} />
                <View style={styles.layerToggleRow}>
                  <Ionicons name="navigate-outline" size={16} color="#25C1AC" />
                  <Text style={styles.layerToggleName}>Controllers</Text>
                  <Switch
                    value={showControllerLayer}
                    onValueChange={(v) => setShowControllerLayer(v)}
                    trackColor={{ true: '#25C1AC', false: '#ddd' }}
                  />
                </View>
                <View style={styles.layerToggleRow}>
                  <Ionicons name="water-outline" size={16} color="#25C1AC" />
                  <Text style={styles.layerToggleName}>Zones</Text>
                  <Switch
                    value={showZoneLayer}
                    onValueChange={(v) => setShowZoneLayer(v)}
                    trackColor={{ true: '#25C1AC', false: '#ddd' }}
                  />
                </View>
                <View style={styles.controllerSectionDivider} />
                <View style={styles.controllerSectionHeader}>
                  <Text style={styles.layerPanelTitle}>Filter Controllers</Text>
                  <TouchableOpacity onPress={() => {
                    const allRefs = controllers.map(c => c.featureRef || c.id);
                    if (enabledControllers.size === allRefs.length) {
                      setEnabledControllers(new Set());
                    } else {
                      setEnabledControllers(new Set(allRefs));
                    }
                  }}>
                    <Text style={styles.selectAllText}>
                      {enabledControllers.size === controllers.length ? 'None' : 'All'}
                    </Text>
                  </TouchableOpacity>
                </View>
                {controllers.map((ctrl) => {
                  const ref = ctrl.featureRef || ctrl.id;
                  return (
                    <TouchableOpacity
                      key={ctrl.id}
                      style={styles.controllerRow}
                      onPress={() => {
                        setEnabledControllers(prev => {
                          const next = new Set(prev);
                          if (next.has(ref)) next.delete(ref);
                          else next.add(ref);
                          return next;
                        });
                      }}
                    >
                      <View style={[styles.controllerColorDot, { backgroundColor: ctrl.controllerColor }]} />
                      <Text style={[styles.controllerLabel, !enabledControllers.has(ref) && styles.controllerLabelDisabled]} numberOfLines={1}>
                        {ctrl.label}
                      </Text>
                      <Text style={styles.controllerZoneCount}>{ctrl.zoneCount}</Text>
                      <View style={[styles.controllerCheck, enabledControllers.has(ref) && styles.controllerCheckActive]}>
                        {enabledControllers.has(ref) && <Ionicons name="checkmark" size={12} color="#fff" />}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </>
            )}
          </View>
        )}

        <View style={styles.webFallback}>
          <Ionicons name="map-outline" size={48} color="#ccc" />
          <Text style={styles.webFallbackTitle}>Map View</Text>
          <Text style={styles.webFallbackText}>
            The interactive map with GeoJSON overlays is available on your mobile device via Expo Go.
          </Text>
          {geoTasks.length > 0 && (
            <View style={styles.taskListFallback}>
              <Text style={styles.taskListTitle}>{geoTasks.length} Task Location{geoTasks.length !== 1 ? 's' : ''}</Text>
              {geoTasks.map((t) => (
                <TouchableOpacity
                  key={t.id}
                  style={styles.taskListItem}
                  onPress={() => router.push(`/task/${t.id}`)}
                >
                  <View style={[styles.priorityDot, { backgroundColor: priorityColors[t.priority] }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.taskListItemTitle}>{t.title}</Text>
                    {t.address && <Text style={styles.taskListItemAddr}>{t.address}</Text>}
                  </View>
                  <Ionicons name="chevron-forward" size={14} color="#999" />
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </View>
    );
  }

  if (!NativeMapComponent) {
    return (
      <View style={[styles.container, styles.webFallback]}>
        <ActivityIndicator color="#25C1AC" size="large" />
        <Text style={[styles.webFallbackText, { marginTop: 12 }]}>Loading map...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.categoryBarFloat, { top: insets.top + 10 }]}>
        {CATEGORY_TABS.map((cat) => (
          <TouchableOpacity
            key={cat.key}
            style={[styles.categoryTabFloat, activeCategory === cat.key && styles.categoryTabFloatActive]}
            onPress={() => setActiveCategory(cat.key)}
          >
            <Ionicons
              name={cat.icon}
              size={15}
              color={activeCategory === cat.key ? '#fff' : 'rgba(255,255,255,0.7)'}
            />
            <Text style={[styles.categoryLabelFloat, activeCategory === cat.key && styles.categoryLabelFloatActive]}>
              {cat.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {(categoryLayers.length > 0 || (activeCategory === 'irrigation' && controllers.length > 0)) && (
        <TouchableOpacity
          style={[styles.layerToggleBtn, { top: insets.top + 62 }]}
          onPress={() => setShowLayerPanel(!showLayerPanel)}
        >
          <Ionicons name="layers-outline" size={20} color="#0C1D31" />
        </TouchableOpacity>
      )}

      {showLayerPanel && (
        <ScrollView style={[styles.layerPanel, { top: insets.top + 62, maxHeight: 400 }]} bounces={false}>
          <Text style={styles.layerPanelTitle}>Layers</Text>
          {categoryLayers.filter(l => l.subLayerKey !== 'controller' && l.subLayerKey !== 'zone').map((layer, idx) => (
            <View key={layer.id} style={styles.layerToggleRow}>
              <View style={[styles.layerColorDot, { backgroundColor: layerColors[idx % layerColors.length] }]} />
              <Text style={styles.layerToggleName} numberOfLines={1}>{layer.displayName}</Text>
              <Switch
                value={enabledLayerIds.has(layer.id)}
                onValueChange={() => toggleLayer(layer.id)}
                trackColor={{ true: '#25C1AC', false: '#ddd' }}
              />
            </View>
          ))}

          {activeCategory === 'irrigation' && controllers.length > 0 && (
            <>
              <View style={styles.controllerSectionDivider} />
              <View style={styles.layerToggleRow}>
                <Ionicons name="navigate-outline" size={16} color="#25C1AC" />
                <Text style={styles.layerToggleName}>Controllers</Text>
                <Switch
                  value={showControllerLayer}
                  onValueChange={(v) => setShowControllerLayer(v)}
                  trackColor={{ true: '#25C1AC', false: '#ddd' }}
                />
              </View>
              <View style={styles.layerToggleRow}>
                <Ionicons name="water-outline" size={16} color="#25C1AC" />
                <Text style={styles.layerToggleName}>Zones</Text>
                <Switch
                  value={showZoneLayer}
                  onValueChange={(v) => setShowZoneLayer(v)}
                  trackColor={{ true: '#25C1AC', false: '#ddd' }}
                />
              </View>

              <View style={styles.controllerSectionDivider} />
              <View style={styles.controllerSectionHeader}>
                <Text style={styles.layerPanelTitle}>Filter Controllers</Text>
                <TouchableOpacity onPress={() => {
                  const allRefs = controllers.map(c => c.featureRef || c.id);
                  if (enabledControllers.size === allRefs.length) {
                    setEnabledControllers(new Set());
                  } else {
                    setEnabledControllers(new Set(allRefs));
                  }
                }}>
                  <Text style={styles.selectAllText}>
                    {enabledControllers.size === controllers.length ? 'None' : 'All'}
                  </Text>
                </TouchableOpacity>
              </View>
              {controllers.map((ctrl) => {
                const ref = ctrl.featureRef || ctrl.id;
                return (
                  <TouchableOpacity
                    key={ctrl.id}
                    style={styles.controllerRow}
                    onPress={() => {
                      setEnabledControllers(prev => {
                        const next = new Set(prev);
                        if (next.has(ref)) next.delete(ref);
                        else next.add(ref);
                        return next;
                      });
                    }}
                  >
                    <View style={[styles.controllerColorDot, { backgroundColor: ctrl.controllerColor }]} />
                    <Text style={[styles.controllerLabel, !enabledControllers.has(ref) && styles.controllerLabelDisabled]} numberOfLines={1}>
                      {ctrl.label}
                    </Text>
                    <Text style={styles.controllerZoneCount}>{ctrl.zoneCount}</Text>
                    <View style={[styles.controllerCheck, enabledControllers.has(ref) && styles.controllerCheckActive]}>
                      {enabledControllers.has(ref) && <Ionicons name="checkmark" size={12} color="#fff" />}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </>
          )}

          {categoryLayers.filter(l => l.subLayerKey === 'controller' || l.subLayerKey === 'zone').length > 0 && activeCategory === 'irrigation' && (
            <>
              <View style={styles.controllerSectionDivider} />
              <Text style={[styles.layerPanelTitle, { fontSize: 12, color: '#999' }]}>GeoJSON Overlays</Text>
              {categoryLayers.filter(l => l.subLayerKey === 'controller' || l.subLayerKey === 'zone').map((layer, idx) => (
                <View key={layer.id} style={styles.layerToggleRow}>
                  <View style={[styles.layerColorDot, { backgroundColor: layerColors[idx % layerColors.length] }]} />
                  <Text style={[styles.layerToggleName, { fontSize: 12 }]} numberOfLines={1}>{layer.displayName}</Text>
                  <Switch
                    value={enabledLayerIds.has(layer.id)}
                    onValueChange={() => toggleLayer(layer.id)}
                    trackColor={{ true: '#25C1AC', false: '#ddd' }}
                  />
                </View>
              ))}
            </>
          )}
        </ScrollView>
      )}

      {useOfflineData && (
        <View style={[styles.offlineBadge, { top: insets.top + 55 }]}>
          <Ionicons name="cloud-offline-outline" size={14} color="#fff" />
          <Text style={styles.offlineBadgeText}>Offline Pack v{localPack?.packVersion}</Text>
        </View>
      )}

      {offlineNoPack && (
        <View style={[styles.offlineNoPackBanner, { top: insets.top + 55 }]}>
          <Ionicons name="cloud-offline-outline" size={18} color="#f44336" />
          <Text style={styles.offlineNoPackText}>
            Offline map pack not downloaded for this community.
          </Text>
        </View>
      )}

      <NativeMapComponent
        tasks={mappedTasks}
        userLocation={userLocation}
        onTaskPress={handleTaskPress}
        layers={activeLayers}
        onFeatureTap={handleFeatureTap}
        selectedAsset={selectedAsset}
        onDismissAsset={handleDismissAsset}
        onAssetDetail={handleAssetDetail}
        onAssetHistory={handleAssetHistory}
        onShowController={handleShowController}
        targetRegion={targetRegion}
        onTargetReached={handleTargetReached}
        controllerMarkers={controllerMarkers}
        zoneMarkers={zoneMarkers}
        showControllers={showControllerLayer}
        showZones={showZoneLayer}
        activeCategory={activeCategory}
        fitToContentKey={fitToContentKey}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa' },
  categoryBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    paddingHorizontal: 8,
  },
  categoryTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  categoryTabActive: {
    borderBottomColor: '#25C1AC',
  },
  categoryLabel: { fontSize: 13, color: '#999', fontWeight: '500' },
  categoryLabelActive: { color: '#25C1AC', fontWeight: '600' },
  categoryBarFloat: {
    position: 'absolute',
    top: 60,
    left: 12,
    right: 12,
    zIndex: 10,
    flexDirection: 'row',
    backgroundColor: 'rgba(12,29,49,0.9)',
    borderRadius: 12,
    padding: 4,
  },
  categoryTabFloat: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    borderRadius: 8,
  },
  categoryTabFloatActive: {
    backgroundColor: '#25C1AC',
  },
  categoryLabelFloat: { fontSize: 12, color: 'rgba(255,255,255,0.7)', fontWeight: '500' },
  categoryLabelFloatActive: { color: '#fff', fontWeight: '600' },
  layerToggleBtn: {
    position: 'absolute',
    top: 112,
    right: 12,
    zIndex: 10,
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  layerToggleBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0C1D31',
  },
  layerPanel: {
    position: 'absolute',
    top: 112,
    right: 56,
    zIndex: 10,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    minWidth: 200,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 5,
  },
  layerPanelTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0C1D31',
    marginBottom: 8,
  },
  layerToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 8,
  },
  layerColorDot: { width: 10, height: 10, borderRadius: 5 },
  layerToggleName: { flex: 1, fontSize: 13, color: '#333' },
  layerListWeb: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  webFallback: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  webFallbackTitle: { fontSize: 20, fontWeight: '600', color: '#666', marginTop: 12 },
  webFallbackText: { fontSize: 14, color: '#999', textAlign: 'center', marginTop: 8 },
  taskListFallback: { width: '100%', marginTop: 24 },
  taskListTitle: { fontSize: 16, fontWeight: '600', color: '#0C1D31', marginBottom: 12 },
  taskListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  priorityDot: { width: 10, height: 10, borderRadius: 5 },
  taskListItemTitle: { fontSize: 15, fontWeight: '500', color: '#0C1D31' },
  taskListItemAddr: { fontSize: 12, color: '#888', marginTop: 2 },
  offlineBadge: {
    position: 'absolute',
    top: 105,
    left: 12,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#f39c12',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  offlineBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#fff',
  },
  offlineNoPackBanner: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#f44336',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  offlineNoPackText: {
    flex: 1,
    fontSize: 13,
    color: '#f44336',
    fontWeight: '500',
  },
  controllerSectionDivider: {
    height: 1,
    backgroundColor: '#eee',
    marginVertical: 8,
  },
  controllerSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  selectAllText: {
    fontSize: 12,
    color: '#25C1AC',
    fontWeight: '600',
  },
  controllerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 8,
  },
  controllerColorDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  controllerLabel: {
    flex: 1,
    fontSize: 13,
    color: '#333',
    fontWeight: '500',
  },
  controllerLabelDisabled: {
    color: '#bbb',
  },
  controllerZoneCount: {
    fontSize: 11,
    color: '#999',
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  controllerCheck: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#ddd',
    alignItems: 'center',
    justifyContent: 'center',
  },
  controllerCheckActive: {
    backgroundColor: '#25C1AC',
    borderColor: '#25C1AC',
  },
});
