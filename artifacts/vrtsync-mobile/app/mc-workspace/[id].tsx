import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCommunity } from '@/client/contexts/CommunityContext';
import { useHighAccuracyLocation } from '@/hooks/useHighAccuracyLocation';
import { apiRequest } from '@/lib/query-client';
import { getDefaultLayerColor } from '@/shared/layerColors';
import StatusBarFill from '@/components/StatusBarFill';
import LeafletMap from '@/components/LeafletMap';
import MapCreatorOverlay from '@/components/MapCreatorOverlay';
import { MC_LAYER_MAP, type McLayerKey } from '@/lib/mcAssetTypeCatalog';

type MapLayerMeta = {
  id: string;
  communityId: string;
  layerKey: string;
  subLayerKey: string;
  displayName: string;
  version: number;
  color?: string;
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

export default function McWorkspaceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { communities, setActiveCommunity } = useCommunity();
  const insets = useSafeAreaInsets();

  const community = communities.find((c) => c.id === id) ?? null;

  useEffect(() => {
    if (community) {
      setActiveCommunity(community);
    }
  }, [community?.id]);

  const communityId = id;

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
      return () => {
        gps.stop();
      };
    }, [])
  );

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

  const { data: controllers = [] } = useQuery<ControllerInfo[]>({
    queryKey: ['/api/communities', communityId, 'controllers'],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/communities/${communityId}/controllers`);
      return res.json();
    },
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

  const controllerColorMap = useMemo(() => {
    const map = new Map<string, string>();
    controllers.forEach((c) => {
      if (c.featureRef) map.set(c.featureRef, c.controllerColor);
    });
    return map;
  }, [controllers]);

  // All layers are always visible in the MC workspace (no category filter).
  // Controller/zone sublayer GeoJSON is suppressed when structured controller
  // markers are available, mirroring the parity logic from (tabs)/map.tsx.
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

  // All controllers and zones are shown at all times in the MC workspace.
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

  // Derive per-type counts from loaded GeoJSON (by subLayerKey) and from
  // structured controller/zone data so badges show accurate numbers even
  // when raw controller/zone GeoJSON sublayers are suppressed.
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
    return {
      lat: gps.latitude,
      lng: gps.longitude,
      accuracyMetres: gps.accuracy,
      color: haloColor,
    };
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

  if (!community) {
    return (
      <View style={styles.container}>
        <StatusBarFill />
        <View style={[styles.headerBar, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity
            onPress={() => router.replace('/(mc-tabs)' as any)}
            style={styles.backBtn}
          >
            <Ionicons name="arrow-back" size={22} color="#0C1D31" />
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>Workspace</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.centeredState}>
          <Ionicons name="alert-circle-outline" size={52} color="#f44336" />
          <Text style={styles.notFoundTitle}>Customer not found</Text>
          <Text style={styles.notFoundSubtitle}>
            This customer may have been removed or you may not have access.
          </Text>
          <TouchableOpacity
            style={styles.backLinkBtn}
            onPress={() => router.replace('/(mc-tabs)' as any)}
            activeOpacity={0.8}
          >
            <Ionicons name="arrow-back" size={16} color="#fff" />
            <Text style={styles.backLinkBtnText}>Back to Customers</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBarFill />

      <View style={[styles.headerBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={() => router.replace('/(mc-tabs)' as any)}
          style={styles.backBtn}
        >
          <Ionicons name="arrow-back" size={22} color="#0C1D31" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>{community.name}</Text>
          {countSubtitle ? (
            <Text style={styles.headerSubtitle} numberOfLines={1}>{countSubtitle}</Text>
          ) : null}
        </View>
        <View style={[styles.lockPill, { backgroundColor: haloColor + '22' }]}>
          <View style={[styles.lockDot, { backgroundColor: haloColor }]} />
          <Text style={[styles.lockLabel, { color: haloColor }]}>
            {LOCK_LABELS[gps.lockState]}
          </Text>
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
        />

        <MapCreatorOverlay
          activeLayer={activeLayer}
          onLayerChange={(layer) => {
            setActiveLayer(layer);
            setArmedType(null);
          }}
          armedType={armedType}
          onArmType={setArmedType}
          typeCounts={typeCounts}
          lockState={gps.lockState}
        />
      </View>

      {armedType && armedTypeDef && (
        <View style={[styles.hintCard, { paddingBottom: insets.bottom + 12 }]}>
          <Text style={styles.hintText}>
            Drop a <Text style={styles.hintTypeName}>{armedTypeDef.label}</Text> when GPS is green.
            Coming in MC5: tap Lock Pin to save.
          </Text>
          <TouchableOpacity
            style={styles.lockPinBtn}
            disabled
            activeOpacity={1}
          >
            <Ionicons name="pin-outline" size={16} color="#9ca3af" />
            <Text style={styles.lockPinBtnText}>Lock Pin Here</Text>
          </TouchableOpacity>
          <Text style={styles.hintHelper}>Save flow lands in MC5.</Text>
        </View>
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
    zIndex: 1,
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
    marginLeft: 8,
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
  mapContainer: {
    flex: 1,
    position: 'relative',
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
    opacity: 0.7,
  },
  lockPinBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#9ca3af',
  },
  hintHelper: {
    fontSize: 11,
    color: '#9ca3af',
    textAlign: 'center',
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
  notFoundSubtitle: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 20,
  },
  backLinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#25C1AC',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 22,
    alignSelf: 'center',
  },
  backLinkBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
});
