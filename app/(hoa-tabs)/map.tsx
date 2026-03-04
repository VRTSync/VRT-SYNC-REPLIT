import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, ScrollView, Switch, ActivityIndicator, Alert } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiRequest } from '@/lib/query-client';
import StatusBarFill from '@/components/StatusBarFill';
import { useCommunity } from '@/client/contexts/CommunityContext';
import LeafletMap from '@/components/LeafletMap';
import AssetDetailPanel from '@/components/AssetDetailPanel';

type MapLayerMeta = {
  id: string;
  communityId: string;
  layerKey: string;
  subLayerKey: string;
  displayName: string;
  version: number;
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

const layerColors = [
  '#25C1AC', '#3498db', '#e74c3c', '#f39c12', '#9b59b6',
  '#1abc9c', '#e67e22', '#2980b9', '#c0392b', '#27ae60',
];

export default function HoaMapScreen() {
  const params = useLocalSearchParams<{ category?: string }>();
  const { activeCommunity } = useCommunity();
  const insets = useSafeAreaInsets();
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [disabledLayerIds, setDisabledLayerIds] = useState<Set<string>>(new Set());
  const [showLayerPanel, setShowLayerPanel] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>('community');
  const [loadedGeoJSON, setLoadedGeoJSON] = useState<Record<string, any>>({});
  const [loadingGeoJSON, setLoadingGeoJSON] = useState<Set<string>>(new Set());
  const [enabledControllers, setEnabledControllers] = useState<Set<string>>(new Set());
  const [showControllerLayer, setShowControllerLayer] = useState(true);
  const [showZoneLayer, setShowZoneLayer] = useState(true);

  const communityId = activeCommunity?.id;

  const { data: controllers = [] } = useQuery<ControllerInfo[]>({
    queryKey: ['/api/communities', communityId, 'controllers'],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/communities/${communityId}/controllers`);
      return res.json();
    },
    enabled: !!communityId,
  });

  React.useEffect(() => {
    if (controllers.length > 0 && enabledControllers.size === 0) {
      const allRefs = controllers.map(c => c.featureRef || c.id);
      setEnabledControllers(new Set(allRefs));
    }
  }, [controllers.length]);

  const { data: allLayers = [] } = useQuery<MapLayerMeta[]>({
    queryKey: ['/api/map-layers', { communityId }],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/map-layers?communityId=${communityId}`);
      return res.json();
    },
    enabled: !!communityId,
  });

  useEffect(() => {
    setMapReady(true);
    if (Platform.OS !== 'web') {
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

  const loadedGeoJSONRef = useRef(loadedGeoJSON);
  loadedGeoJSONRef.current = loadedGeoJSON;
  const loadingGeoJSONRef = useRef(loadingGeoJSON);
  loadingGeoJSONRef.current = loadingGeoJSON;

  const fetchGeoJSON = useCallback(async (layerId: string) => {
    if (loadedGeoJSONRef.current[layerId] || loadingGeoJSONRef.current.has(layerId)) return;

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
  }, []);

  useEffect(() => {
    allLayers.forEach((layer) => {
      if (!loadedGeoJSONRef.current[layer.id] && !loadingGeoJSONRef.current.has(layer.id)) {
        fetchGeoJSON(layer.id);
      }
    });
  }, [allLayers, fetchGeoJSON]);

  const toggleLayer = (id: string) => {
    setDisabledLayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCategorySelect = (catKey: string) => {
    setActiveCategory(catKey);
    setShowLayerPanel(false);
    setDisabledLayerIds(new Set());
    if (catKey === 'irrigation') {
      setShowControllerLayer(true);
      setShowZoneLayer(true);
      const allRefs = controllers.map(c => c.featureRef || c.id);
      setEnabledControllers(new Set(allRefs));
    }
  };

  useEffect(() => {
    if (params.category && CATEGORY_TABS.some(c => c.key === params.category) && params.category !== activeCategory) {
      handleCategorySelect(params.category);
    }
  }, [params.category]);

  const controllerColorMap = React.useMemo(() => {
    const map = new Map<string, string>();
    controllers.forEach(c => {
      if (c.featureRef) map.set(c.featureRef, c.controllerColor);
    });
    return map;
  }, [controllers]);

  const controllerMarkers = useMemo(() => {
    if (activeCategory !== 'irrigation' || !showControllerLayer || controllers.length === 0) return [];
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
  }, [activeCategory, showControllerLayer, controllers, enabledControllers]);

  const zoneMarkers = useMemo(() => {
    if (activeCategory !== 'irrigation' || !showZoneLayer || controllers.length === 0) return [];
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
  }, [activeCategory, showZoneLayer, controllers, enabledControllers]);

  const activeLayers = React.useMemo(() => {
    return allLayers
      .filter((l) => l.layerKey === activeCategory)
      .filter((l) => !disabledLayerIds.has(l.id))
      .filter((l) => {
        if (controllers.length > 0) {
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
  }, [allLayers, activeCategory, disabledLayerIds, loadedGeoJSON, controllers, controllerColorMap]);

  const fitToContentKey = useMemo(() => {
    const parts = [
      Array.from(enabledControllers).sort().join(','),
      allLayers.filter(l => !disabledLayerIds.has(l.id)).map(l => l.id).sort().join(','),
    ];
    return parts.join('|');
  }, [enabledControllers, disabledLayerIds, allLayers]);

  const [detailPanelAssetId, setDetailPanelAssetId] = useState<string | null>(null);

  const handleViewAssetDetail = useCallback(async (featureRef: string, _layerKey: string, _meta?: { label?: string; assetType?: string; layerName?: string }) => {
    if (!communityId || !featureRef) return;
    try {
      const res = await apiRequest('GET', `/api/assets/by-feature?communityId=${communityId}&featureRef=${encodeURIComponent(featureRef)}`);
      const asset = await res.json();
      if (asset && asset.id) {
        setDetailPanelAssetId(asset.id);
      } else {
        Alert.alert('Not Available', 'No detailed record found for this feature.');
      }
    } catch (err) {
      console.error('[handleViewAssetDetail] error:', err);
      Alert.alert('Error', 'Failed to load asset details.');
    }
  }, [communityId]);

  const isWeb = Platform.OS === 'web';
  const topOffset = isWeb ? 67 : insets.top;

  const layersByCategory = useMemo(() => {
    const grouped: Record<string, MapLayerMeta[]> = {};
    CATEGORY_TABS.forEach(cat => { grouped[cat.key] = []; });
    allLayers.forEach(l => {
      if (!grouped[l.layerKey]) grouped[l.layerKey] = [];
      grouped[l.layerKey].push(l);
    });
    return grouped;
  }, [allLayers]);

  if (!mapReady) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <ActivityIndicator color="#25C1AC" size="large" />
        <Text style={[styles.loadingText, { marginTop: 12 }]}>Loading map...</Text>
      </View>
    );
  }

  const categoryBarTop = topOffset;
  const layersButtonTop = categoryBarTop + 52 + 12;
  const layerPanelTop = layersButtonTop + 40;

  return (
    <View style={styles.container}>
      {isWeb && <StatusBarFill />}

      {(allLayers.length > 0 || controllers.length > 0) && (
        <>
          <View style={[styles.categoryBar, { top: categoryBarTop }]}>
            {CATEGORY_TABS.map((cat) => {
              const isActive = activeCategory === cat.key;
              return (
                <TouchableOpacity
                  key={cat.key}
                  style={[styles.categoryTab, isActive && styles.categoryTabActive]}
                  onPress={() => handleCategorySelect(cat.key)}
                >
                  <Ionicons name={cat.icon} size={20} color={isActive ? '#25C1AC' : '#999'} />
                  <Text style={[styles.categoryTabText, isActive && styles.categoryTabTextActive]}>{cat.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity
            style={[styles.layersButton, { top: layersButtonTop }]}
            onPress={() => setShowLayerPanel(!showLayerPanel)}
          >
            <Ionicons name={showLayerPanel ? 'close' : 'layers-outline'} size={18} color="#25C1AC" />
            <Text style={styles.layersButtonText}>{showLayerPanel ? 'Close' : 'Layers'}</Text>
          </TouchableOpacity>
        </>
      )}

      <LeafletMap
        tasks={[]}
        userLocation={userLocation}
        onTaskPress={() => {}}
        layers={activeLayers}
        onViewAssetDetail={handleViewAssetDetail}
        controllerMarkers={controllerMarkers}
        zoneMarkers={zoneMarkers}
        showControllers={showControllerLayer}
        showZones={showZoneLayer}
        activeCategory={activeCategory}
        fitToContentKey={fitToContentKey}
      />

      {showLayerPanel && (
        <View style={[styles.layerPanel, { top: layerPanelTop }]}>
          <ScrollView bounces={false} style={{ maxHeight: 300 }}>
            {(() => {
              const catLayers = (layersByCategory[activeCategory] || []).filter(
                l => l.subLayerKey !== 'controller' && l.subLayerKey !== 'zone'
              );
              const hasLayers = catLayers.length > 0;
              const hasControllers = activeCategory === 'irrigation' && controllers.length > 0;
              if (!hasLayers && !hasControllers) {
                return <Text style={styles.layerPanelEmpty}>No layers available for this category.</Text>;
              }
              return (
                <>
                  {catLayers.map((layer, idx) => (
                    <View key={layer.id} style={styles.layerToggleRow}>
                      <View style={[styles.layerColorDot, { backgroundColor: layerColors[idx % layerColors.length] }]} />
                      <Text style={styles.layerToggleName} numberOfLines={1}>{layer.displayName}</Text>
                      <Switch
                        value={!disabledLayerIds.has(layer.id)}
                        onValueChange={() => toggleLayer(layer.id)}
                        trackColor={{ true: '#25C1AC', false: '#ddd' }}
                      />
                    </View>
                  ))}
                  {hasControllers && (
                    <>
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
                        <Text style={styles.controllerSectionTitle}>Controllers</Text>
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
                </>
              );
            })()}
          </ScrollView>
        </View>
      )}

      {detailPanelAssetId && (
        <AssetDetailPanel
          assetId={detailPanelAssetId}
          onClose={() => setDetailPanelAssetId(null)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa' },
  loadingContainer: { justifyContent: 'center', alignItems: 'center' },
  loadingText: { fontSize: 14, color: '#999' },
  categoryBar: {
    position: 'absolute',
    left: 8,
    right: 8,
    zIndex: 12,
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderRadius: 14,
    height: 52,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 5,
    overflow: 'hidden' as const,
  },
  categoryTab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: 6,
  },
  categoryTabActive: {
    backgroundColor: 'rgba(37,193,172,0.1)',
  },
  categoryTabText: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: '#999',
  },
  categoryTabTextActive: {
    color: '#25C1AC',
  },
  layersButton: {
    position: 'absolute',
    left: 12,
    zIndex: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 4,
  },
  layersButtonText: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: '#0C1D31',
  },
  layerPanel: {
    position: 'absolute',
    left: 8,
    right: 8,
    zIndex: 14,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 14,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 6,
  },
  layerPanelEmpty: {
    fontSize: 13,
    color: '#999',
    textAlign: 'center',
    paddingVertical: 16,
  },
  layerToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  layerColorDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  layerToggleName: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500' as const,
    color: '#333',
  },
  controllerSectionDivider: {
    height: 1,
    backgroundColor: '#ddd',
    marginVertical: 8,
  },
  controllerSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  controllerSectionTitle: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: '#0C1D31',
  },
  selectAllText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: '#25C1AC',
  },
  controllerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  controllerColorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  controllerLabel: {
    flex: 1,
    fontSize: 13,
    color: '#333',
  },
  controllerLabelDisabled: {
    color: '#bbb',
  },
  controllerZoneCount: {
    fontSize: 11,
    color: '#999',
    marginRight: 4,
  },
  controllerCheck: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#ddd',
    alignItems: 'center',
    justifyContent: 'center',
  },
  controllerCheckActive: {
    backgroundColor: '#25C1AC',
    borderColor: '#25C1AC',
  },
});
