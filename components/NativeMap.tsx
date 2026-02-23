import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import MapView, { Marker, Callout, Polygon, Polyline, Region } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';

type Task = {
  id: string;
  title: string;
  priority: string;
  latitude: number;
  longitude: number;
  address: string | null;
};

type GeoJSONFeature = {
  type: 'Feature';
  id?: string;
  properties: Record<string, any>;
  geometry: {
    type: string;
    coordinates: any;
  };
};

type LayerData = {
  id: string;
  layerKey: string;
  subLayerKey: string;
  displayName: string;
  geojson: any;
  color: string;
  controllerColorMap?: Map<string, string>;
};

type ControllerMarkerData = {
  id: string;
  featureRef: string;
  label: string;
  controllerKey: string;
  color: string;
  latitude: number;
  longitude: number;
  zoneCount: number;
};

type ZoneMarkerData = {
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

const REGION_BUFFER = 1.2;
const MAX_VISIBLE_FEATURES = 100;
const ZOOM_IN_THRESHOLD = 0.008;
const ZOOM_OUT_THRESHOLD = 0.014;
const FAR_ZOOM_THRESHOLD = 0.08;
const MAX_INDIVIDUAL_ZONES = 400;
const CLUSTER_GRID_SIZE = 0.003;
const REGION_CHANGE_DEBOUNCE_MS = 300;

const CLEAN_MAP_STYLE = [
  { featureType: 'poi', elementType: 'all', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry.fill', stylers: [{ visibility: 'on' }, { color: '#e6f4e1' }] },
  { featureType: 'transit', elementType: 'all', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
];

function parseGeoJSONCoords(coords: number[]): { latitude: number; longitude: number } {
  return { latitude: coords[1], longitude: coords[0] };
}

function parseRing(ring: number[][]): { latitude: number; longitude: number }[] {
  return ring.map(parseGeoJSONCoords);
}

function isPointInRegion(lat: number, lng: number, region: Region | null): boolean {
  if (!region) return true;
  const latDelta = region.latitudeDelta * REGION_BUFFER;
  const lngDelta = region.longitudeDelta * REGION_BUFFER;
  return (
    lat >= region.latitude - latDelta &&
    lat <= region.latitude + latDelta &&
    lng >= region.longitude - lngDelta &&
    lng <= region.longitude + lngDelta
  );
}

function getFeatureCentroid(geom: any): { lat: number; lng: number } | null {
  if (!geom) return null;
  if (geom.type === 'Point') {
    return { lat: geom.coordinates[1], lng: geom.coordinates[0] };
  }
  if (geom.type === 'Polygon' && geom.coordinates?.[0]?.length > 0) {
    const ring = geom.coordinates[0];
    let sumLat = 0, sumLng = 0;
    for (const c of ring) { sumLng += c[0]; sumLat += c[1]; }
    return { lat: sumLat / ring.length, lng: sumLng / ring.length };
  }
  if (geom.type === 'MultiPolygon' && geom.coordinates?.[0]?.[0]?.length > 0) {
    const ring = geom.coordinates[0][0];
    let sumLat = 0, sumLng = 0;
    for (const c of ring) { sumLng += c[0]; sumLat += c[1]; }
    return { lat: sumLat / ring.length, lng: sumLng / ring.length };
  }
  if (geom.type === 'LineString' && geom.coordinates?.length > 0) {
    const mid = geom.coordinates[Math.floor(geom.coordinates.length / 2)];
    return { lat: mid[1], lng: mid[0] };
  }
  if (geom.type === 'MultiLineString' && geom.coordinates?.[0]?.length > 0) {
    const mid = geom.coordinates[0][Math.floor(geom.coordinates[0].length / 2)];
    return { lat: mid[1], lng: mid[0] };
  }
  return null;
}

const ASSET_TYPE_LABELS: Record<string, string> = {
  controller: 'Controller', backflow: 'Backflow', zone: 'Zone', tree: 'Tree',
  pet_station: 'Pet Station', landscape_bed: 'Landscape Bed', bluegrass_area: 'Bluegrass Area',
  native_area: 'Native Area', snow_area: 'Snow Area',
};

type ZoneCluster = {
  key: string;
  latitude: number;
  longitude: number;
  count: number;
  colors: Set<string>;
  zones: ZoneMarkerData[];
};

function clusterZones(zones: ZoneMarkerData[], gridSize: number): ZoneCluster[] {
  const grid = new Map<string, ZoneCluster>();
  for (const z of zones) {
    const gx = Math.floor(z.latitude / gridSize);
    const gy = Math.floor(z.longitude / gridSize);
    const key = `${gx}:${gy}`;
    if (!grid.has(key)) {
      grid.set(key, { key, latitude: 0, longitude: 0, count: 0, colors: new Set(), zones: [] });
    }
    const cluster = grid.get(key)!;
    cluster.zones.push(z);
    cluster.count++;
    cluster.latitude += z.latitude;
    cluster.longitude += z.longitude;
    cluster.colors.add(z.controllerColor);
  }
  for (const cluster of grid.values()) {
    cluster.latitude /= cluster.count;
    cluster.longitude /= cluster.count;
  }
  return Array.from(grid.values());
}

const ControllerMarkerMemo = React.memo(function ControllerMarkerMemo({
  ctrl,
  onPress,
}: {
  ctrl: ControllerMarkerData;
  onPress: (featureRef: string) => void;
}) {
  return (
    <Marker
      key={`ctrl-${ctrl.featureRef}`}
      coordinate={{ latitude: ctrl.latitude, longitude: ctrl.longitude }}
      tracksViewChanges={false}
      anchor={{ x: 0.5, y: 0.5 }}
      onPress={() => onPress(ctrl.featureRef)}
      zIndex={10}
    >
      <View style={[styles.controllerMarker, { backgroundColor: ctrl.color, borderColor: '#fff' }]}>
        <Text style={styles.controllerMarkerLabel}>{ctrl.controllerKey}</Text>
      </View>
    </Marker>
  );
});

const ZoneRingMarkerMemo = React.memo(function ZoneRingMarkerMemo({
  zone,
  onPress,
}: {
  zone: ZoneMarkerData;
  onPress: (featureRef: string) => void;
}) {
  return (
    <Marker
      key={`zone-${zone.featureRef || zone.id}`}
      coordinate={{ latitude: zone.latitude, longitude: zone.longitude }}
      tracksViewChanges={false}
      anchor={{ x: 0.5, y: 0.5 }}
      onPress={() => onPress(zone.featureRef)}
      zIndex={5}
    >
      <View style={[styles.zoneRing, { borderColor: zone.controllerColor }]} />
    </Marker>
  );
});

const ClusterMarkerMemo = React.memo(function ClusterMarkerMemo({
  cluster,
  onPress,
}: {
  cluster: ZoneCluster;
  onPress: (cluster: ZoneCluster) => void;
}) {
  const isMixed = cluster.colors.size > 1;
  const bgColor = isMixed ? '#6b7280' : Array.from(cluster.colors)[0];
  const borderCol = isMixed ? '#d1d5db' : '#fff';
  return (
    <Marker
      key={`zcluster-${cluster.key}`}
      coordinate={{ latitude: cluster.latitude, longitude: cluster.longitude }}
      tracksViewChanges={false}
      anchor={{ x: 0.5, y: 0.5 }}
      onPress={() => onPress(cluster)}
      zIndex={6}
    >
      <View style={[styles.clusterBadge, { backgroundColor: bgColor, borderColor: borderCol }]}>
        <Text style={styles.clusterBadgeText}>{cluster.count}</Text>
      </View>
    </Marker>
  );
});

type NativeMapProps = {
  tasks: Task[];
  userLocation: { latitude: number; longitude: number } | null;
  onTaskPress: (id: string) => void;
  layers?: LayerData[];
  onFeatureTap?: (featureRef: string, layerKey: string) => void;
  selectedAsset?: AssetInfo | null;
  onDismissAsset?: () => void;
  onAssetDetail?: (assetId: string) => void;
  onAssetHistory?: (assetId: string) => void;
  onShowController?: (controllerFeatureRef: string) => void;
  onShowControllerZones?: (controllerFeatureRef: string) => void;
  targetRegion?: { latitude: number; longitude: number; label?: string } | null;
  onTargetReached?: () => void;
  controllerMarkers?: ControllerMarkerData[];
  zoneMarkers?: ZoneMarkerData[];
  showControllers?: boolean;
  showZones?: boolean;
  activeCategory?: string;
  fitToContentKey?: string;
};

function NativeMap({
  tasks,
  userLocation,
  onTaskPress,
  layers = [],
  onFeatureTap,
  selectedAsset,
  onDismissAsset,
  onAssetDetail,
  onAssetHistory,
  onShowController,
  onShowControllerZones,
  targetRegion,
  onTargetReached,
  controllerMarkers = [],
  zoneMarkers = [],
  showControllers = false,
  showZones = false,
  activeCategory = 'community',
  fitToContentKey,
}: NativeMapProps) {
  const mapRef = useRef<MapView>(null);
  const [visibleRegion, setVisibleRegion] = useState<Region | null>(null);
  const regionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const [isZoomedIn, setIsZoomedIn] = useState(false);
  const [isFarZoom, setIsFarZoom] = useState(true);
  const isZoomedInRef = useRef(false);
  const isFarZoomRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (regionTimerRef.current) clearTimeout(regionTimerRef.current);
    };
  }, []);

  const isIrrigation = activeCategory === 'irrigation';
  const isIrrigationActive = isIrrigation && (showControllers || showZones);

  const handleRegionChange = useCallback((region: Region) => {
    if (regionTimerRef.current) clearTimeout(regionTimerRef.current);
    regionTimerRef.current = setTimeout(() => {
      if (!mountedRef.current) return;
      setVisibleRegion(region);
      if (!isIrrigationActive) return;
      const delta = region.latitudeDelta;
      const wasZoomed = isZoomedInRef.current;
      if (!wasZoomed && delta < ZOOM_IN_THRESHOLD) {
        isZoomedInRef.current = true;
        setIsZoomedIn(true);
      } else if (wasZoomed && delta > ZOOM_OUT_THRESHOLD) {
        isZoomedInRef.current = false;
        setIsZoomedIn(false);
      }
      const wasFar = isFarZoomRef.current;
      if (wasFar && delta < FAR_ZOOM_THRESHOLD * 0.8) {
        isFarZoomRef.current = false;
        setIsFarZoom(false);
      } else if (!wasFar && delta > FAR_ZOOM_THRESHOLD) {
        isFarZoomRef.current = true;
        setIsFarZoom(true);
      }
    }, REGION_CHANGE_DEBOUNCE_MS);
  }, [isIrrigationActive]);

  useEffect(() => {
    if (targetRegion && mapRef.current) {
      setTimeout(() => {
        mapRef.current?.animateToRegion({
          latitude: targetRegion.latitude,
          longitude: targetRegion.longitude,
          latitudeDelta: 0.005,
          longitudeDelta: 0.005,
        }, 800);
        onTargetReached?.();
      }, 600);
      return;
    }
    if (tasks.length > 0 && mapRef.current && !fitToContentKey) {
      const coords = tasks.map((t) => ({
        latitude: t.latitude,
        longitude: t.longitude,
      }));
      if (userLocation) coords.push(userLocation);
      setTimeout(() => {
        mapRef.current?.fitToCoordinates(coords, {
          edgePadding: { top: 80, right: 40, bottom: 80, left: 40 },
          animated: true,
        });
      }, 500);
    }
  }, [tasks.length, userLocation, targetRegion]);

  useEffect(() => {
    if (!fitToContentKey || !mapRef.current) return;
    const allCoords: { latitude: number; longitude: number }[] = [];

    if (showControllers) {
      for (const c of controllerMarkers) {
        allCoords.push({ latitude: c.latitude, longitude: c.longitude });
      }
    }
    if (showZones) {
      for (const z of zoneMarkers) {
        allCoords.push({ latitude: z.latitude, longitude: z.longitude });
      }
    }

    for (const layer of layers) {
      if (!layer.geojson) continue;
      const features: GeoJSONFeature[] = layer.geojson.type === 'FeatureCollection'
        ? layer.geojson.features || [] : layer.geojson.type === 'Feature' ? [layer.geojson] : [];
      for (const f of features) {
        const c = getFeatureCentroid(f.geometry);
        if (c) allCoords.push({ latitude: c.lat, longitude: c.lng });
      }
    }

    for (const t of tasks) {
      allCoords.push({ latitude: t.latitude, longitude: t.longitude });
    }

    if (allCoords.length > 0) {
      setTimeout(() => {
        mapRef.current?.fitToCoordinates(allCoords, {
          edgePadding: { top: 120, right: 60, bottom: 120, left: 60 },
          animated: true,
        });
      }, 300);
    }
  }, [fitToContentKey]);

  const initialRegion = userLocation
    ? { ...userLocation, latitudeDelta: 0.05, longitudeDelta: 0.05 }
    : { latitude: 39.8283, longitude: -98.5795, latitudeDelta: 30, longitudeDelta: 30 };

  const geoJSONElements = useMemo(() => {
    if (isIrrigationActive) return [];
    const elements: React.ReactNode[] = [];
    let featureCount = 0;

    for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
      const layer = layers[layerIndex];
      if (!layer.geojson) continue;
      const color = layer.color || layerColors[layerIndex % layerColors.length];

      const features: GeoJSONFeature[] = layer.geojson.type === 'FeatureCollection'
        ? layer.geojson.features || []
        : layer.geojson.type === 'Feature'
          ? [layer.geojson]
          : [];

      for (let fIdx = 0; fIdx < features.length; fIdx++) {
        if (featureCount >= MAX_VISIBLE_FEATURES) break;

        const feature = features[fIdx];
        const geom = feature.geometry;
        if (!geom) continue;

        const centroid = getFeatureCentroid(geom);
        if (centroid && !isPointInRegion(centroid.lat, centroid.lng, visibleRegion)) {
          continue;
        }

        const key = `${layer.id}-${fIdx}`;
        const featureRef = feature.properties?.featureRef || feature.properties?.featureId || feature.properties?.id || feature.properties?.name;

        let featureColor = color;
        if (layer.controllerColorMap) {
          if (layer.subLayerKey === 'controller') {
            const ctrlColor = layer.controllerColorMap.get(feature.properties?.featureId || feature.id);
            if (ctrlColor) featureColor = ctrlColor;
          } else if (layer.subLayerKey === 'zone') {
            const ctrlRef = feature.properties?.controllerFeatureRef;
            if (ctrlRef) {
              const ctrlColor = layer.controllerColorMap.get(ctrlRef);
              if (ctrlColor) featureColor = ctrlColor;
            }
          }
        }
        const featureFillColor = featureColor + '40';

        if (geom.type === 'Polygon') {
          const outerRing = parseRing(geom.coordinates[0]);
          elements.push(
            <Polygon
              key={key}
              coordinates={outerRing}
              fillColor={featureFillColor}
              strokeColor={featureColor}
              strokeWidth={2}
              tappable={!!onFeatureTap}
              onPress={() => onFeatureTap?.(featureRef || `polygon-${key}`, layer.layerKey)}
            />
          );
        } else if (geom.type === 'MultiPolygon') {
          geom.coordinates.forEach((poly: number[][][], pIdx: number) => {
            const outerRing = parseRing(poly[0]);
            elements.push(
              <Polygon
                key={`${key}-${pIdx}`}
                coordinates={outerRing}
                fillColor={featureFillColor}
                strokeColor={featureColor}
                strokeWidth={2}
                tappable={!!onFeatureTap}
                onPress={() => onFeatureTap?.(featureRef || `polygon-${key}-${pIdx}`, layer.layerKey)}
              />
            );
          });
        } else if (geom.type === 'LineString') {
          elements.push(
            <Polyline
              key={key}
              coordinates={parseRing(geom.coordinates)}
              strokeColor={featureColor}
              strokeWidth={3}
              tappable={!!featureRef && !!onFeatureTap}
              onPress={() => featureRef && onFeatureTap?.(featureRef, layer.layerKey)}
            />
          );
        } else if (geom.type === 'MultiLineString') {
          geom.coordinates.forEach((line: number[][], lIdx: number) => {
            elements.push(
              <Polyline
                key={`${key}-${lIdx}`}
                coordinates={parseRing(line)}
                strokeColor={featureColor}
                strokeWidth={3}
                tappable={!!featureRef && !!onFeatureTap}
                onPress={() => featureRef && onFeatureTap?.(featureRef, layer.layerKey)}
              />
            );
          });
        } else if (geom.type === 'Point') {
          if (layer.subLayerKey !== 'controller' && layer.subLayerKey !== 'zone') {
            const coord = parseGeoJSONCoords(geom.coordinates);
            elements.push(
              <Marker
                key={key}
                coordinate={coord}
                pinColor={featureColor}
                tracksViewChanges={false}
                onPress={() => featureRef && onFeatureTap?.(featureRef, layer.layerKey)}
              />
            );
          }
        }

        featureCount++;
      }
      if (featureCount >= MAX_VISIBLE_FEATURES) break;
    }

    return elements;
  }, [layers, onFeatureTap, visibleRegion, isIrrigationActive]);

  const visibleControllers = useMemo(() => {
    if (!isIrrigationActive || !showControllers) return [];
    return controllerMarkers;
  }, [isIrrigationActive, showControllers, controllerMarkers]);

  const clusteredZones = useMemo(() => {
    if (!isIrrigationActive || zoneMarkers.length === 0) return [];
    return clusterZones(zoneMarkers, CLUSTER_GRID_SIZE);
  }, [isIrrigationActive, zoneMarkers]);

  const emptyZones = useMemo(() => ({ individual: [] as ZoneMarkerData[], clusters: [] as ZoneCluster[] }), []);

  const visibleZones = useMemo(() => {
    if (!isIrrigationActive || !showZones || zoneMarkers.length === 0) return emptyZones;
    if (isFarZoom) return emptyZones;
    if (isZoomedIn && zoneMarkers.length <= MAX_INDIVIDUAL_ZONES) {
      return { individual: zoneMarkers, clusters: [] as ZoneCluster[] };
    }
    return { individual: [] as ZoneMarkerData[], clusters: clusteredZones };
  }, [isIrrigationActive, showZones, zoneMarkers, isZoomedIn, isFarZoom, clusteredZones, emptyZones]);

  const devPrevCountRef = useRef({ ctrl: 0, zoneInd: 0, zoneCl: 0 });
  if (__DEV__) {
    const ctrlCount = visibleControllers.length;
    const zoneIndCount = visibleZones.individual.length;
    const zoneClCount = visibleZones.clusters.length;
    if (ctrlCount !== devPrevCountRef.current.ctrl || zoneIndCount !== devPrevCountRef.current.zoneInd || zoneClCount !== devPrevCountRef.current.zoneCl) {
      devPrevCountRef.current = { ctrl: ctrlCount, zoneInd: zoneIndCount, zoneCl: zoneClCount };
      console.log(`[Map] Markers: ${ctrlCount} ctrl, ${zoneIndCount} zone rings, ${zoneClCount} clusters | zoomed=${isZoomedIn} far=${isFarZoom}`);
    }
  }

  const handleIrrigationTap = useCallback((featureRef: string) => {
    onFeatureTap?.(featureRef, 'irrigation');
  }, [onFeatureTap]);

  const zoomToCluster = useCallback((cluster: ZoneCluster) => {
    const lats = cluster.zones.map(z => z.latitude);
    const lngs = cluster.zones.map(z => z.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    mapRef.current?.animateToRegion({
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: Math.max((maxLat - minLat) * 1.5, 0.003),
      longitudeDelta: Math.max((maxLng - minLng) * 1.5, 0.003),
    }, 500);
  }, []);

  const handleClusterPress = useCallback((cluster: ZoneCluster) => {
    if (cluster.count === 1) {
      const z = cluster.zones[0];
      handleIrrigationTap(z.featureRef);
      return;
    }
    const breakdown = new Map<string, { label: string; count: number }>();
    for (const z of cluster.zones) {
      const key = z.controllerFeatureRef;
      if (!breakdown.has(key)) {
        breakdown.set(key, { label: z.controllerLabel || z.controllerKey, count: 0 });
      }
      breakdown.get(key)!.count++;
    }
    const lines = Array.from(breakdown.values())
      .sort((a, b) => b.count - a.count)
      .map(b => `${b.label}: ${b.count}`)
      .join('\n');
    Alert.alert(
      `${cluster.count} zones`,
      lines,
      [
        { text: 'Zoom In', onPress: () => zoomToCluster(cluster) },
        { text: 'Close', style: 'cancel' },
      ],
    );
  }, [handleIrrigationTap, zoomToCluster]);

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={initialRegion}
        mapType="mutedStandard"
        customMapStyle={CLEAN_MAP_STYLE}
        showsUserLocation
        showsMyLocationButton
        showsPointsOfInterest={false}
        showsBuildings={false}
        showsTraffic={false}
        onRegionChangeComplete={handleRegionChange}
        moveOnMarkerPress={false}
      >
        {geoJSONElements}

        {isIrrigationActive && (
          <>
            {visibleControllers.map((ctrl) => (
              <ControllerMarkerMemo
                key={`ctrl-${ctrl.featureRef}`}
                ctrl={ctrl}
                onPress={handleIrrigationTap}
              />
            ))}

            {visibleZones.individual.map((z) => (
              <ZoneRingMarkerMemo
                key={`zone-${z.featureRef || z.id}`}
                zone={z}
                onPress={handleIrrigationTap}
              />
            ))}

            {visibleZones.clusters.map((cluster) => (
              <ClusterMarkerMemo
                key={`zcluster-${cluster.key}`}
                cluster={cluster}
                onPress={handleClusterPress}
              />
            ))}
          </>
        )}

        {tasks.map((task) => (
          <Marker
            key={task.id}
            coordinate={{ latitude: task.latitude, longitude: task.longitude }}
            pinColor={priorityColors[task.priority]}
            tracksViewChanges={false}
          >
            <Callout onPress={() => onTaskPress(task.id)}>
              <View style={styles.callout}>
                <Text style={styles.calloutTitle}>{task.title}</Text>
                {task.address ? <Text style={styles.calloutAddress}>{task.address}</Text> : null}
                <Text style={styles.calloutAction}>Tap to view details</Text>
              </View>
            </Callout>
          </Marker>
        ))}
        {targetRegion && (
          <Marker
            coordinate={{ latitude: targetRegion.latitude, longitude: targetRegion.longitude }}
            pinColor="#25C1AC"
            tracksViewChanges={false}
          >
            {targetRegion.label ? (
              <Callout>
                <View style={styles.callout}>
                  <Text style={styles.calloutTitle}>{targetRegion.label}</Text>
                </View>
              </Callout>
            ) : null}
          </Marker>
        )}
      </MapView>

      {isIrrigationActive && showZones && isFarZoom && zoneMarkers.length > 0 && (
        <View style={styles.zoomHint}>
          <Ionicons name="search-outline" size={14} color="#fff" />
          <Text style={styles.zoomHintText}>Zoom in to see zones for each controller</Text>
        </View>
      )}

      <View style={styles.legend}>
        {Object.entries(priorityColors).map(([label, color]) => (
          <View key={label} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: color }]} />
            <Text style={styles.legendText}>{label}</Text>
          </View>
        ))}
      </View>

      {selectedAsset && (
        <View style={styles.assetPopup}>
          {selectedAsset.assetType === 'zone' ? (
            <>
              <View style={styles.assetPopupHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.assetPopupLabel}>{selectedAsset.label}</Text>
                  <View style={styles.zoneSubHeader}>
                    {selectedAsset.controllerColor && (
                      <View style={[styles.controllerDotInline, { backgroundColor: selectedAsset.controllerColor }]} />
                    )}
                    <Text style={styles.zoneControllerText}>
                      {selectedAsset.controllerLabel || 'Controller'}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity onPress={onDismissAsset} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Ionicons name="close-circle" size={24} color="#999" />
                </TouchableOpacity>
              </View>

              <View style={styles.zoneDetailsRow}>
                {selectedAsset.zoneNumber != null && (
                  <View style={styles.zoneDetailChip}>
                    <Ionicons name="water-outline" size={13} color="#25C1AC" />
                    <Text style={styles.zoneDetailChipText}>Zone {selectedAsset.zoneNumber}</Text>
                  </View>
                )}
                {selectedAsset.zoneType && (
                  <View style={styles.zoneDetailChip}>
                    <Ionicons name="options-outline" size={13} color="#25C1AC" />
                    <Text style={styles.zoneDetailChipText}>{selectedAsset.zoneType}</Text>
                  </View>
                )}
              </View>

              {selectedAsset.properties.length > 0 && (
                <View style={styles.assetProps}>
                  {selectedAsset.properties.filter(p => p.key !== 'zoneNumber' && p.key !== 'zoneType' && p.key !== 'controllerFeatureRef' && p.key !== 'controllerKey' && p.key !== 'controllerColor' && p.key !== 'zoneLabelShort').slice(0, 3).map((p) => (
                    <View key={p.key} style={styles.assetPropRow}>
                      <Text style={styles.assetPropKey}>{p.key}:</Text>
                      <Text style={styles.assetPropVal}>{p.value}</Text>
                    </View>
                  ))}
                </View>
              )}

              <View style={styles.assetBtnRow}>
                {selectedAsset.controllerFeatureRef && onShowController && (
                  <TouchableOpacity
                    style={[styles.assetDetailBtn, styles.showControllerBtn]}
                    onPress={() => onShowController(selectedAsset.controllerFeatureRef!)}
                  >
                    <Ionicons name="locate-outline" size={16} color="#0C1D31" />
                    <Text style={styles.showControllerBtnText}>Show Controller</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.assetDetailBtn}
                  onPress={() => onAssetDetail?.(selectedAsset.id)}
                >
                  <Ionicons name="information-circle-outline" size={16} color="#fff" />
                  <Text style={styles.assetDetailBtnText}>Details</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.assetDetailBtn, styles.assetHistoryBtn]}
                  onPress={() => onAssetHistory?.(selectedAsset.id)}
                >
                  <Ionicons name="time-outline" size={16} color="#fff" />
                  <Text style={styles.assetDetailBtnText}>History</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : selectedAsset.assetType === 'controller' ? (
            <>
              <View style={styles.assetPopupHeader}>
                <View style={{ flex: 1 }}>
                  <View style={styles.controllerPopupTitle}>
                    {selectedAsset.controllerColor && (
                      <View style={[styles.controllerDotLarge, { backgroundColor: selectedAsset.controllerColor }]} />
                    )}
                    <Text style={styles.assetPopupLabel}>{selectedAsset.label}</Text>
                  </View>
                  <Text style={styles.assetPopupType}>Controller</Text>
                </View>
                <TouchableOpacity onPress={onDismissAsset} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Ionicons name="close-circle" size={24} color="#999" />
                </TouchableOpacity>
              </View>

              {selectedAsset.zoneCount != null && (
                <View style={styles.controllerZoneBadge}>
                  <Ionicons name="water-outline" size={14} color="#25C1AC" />
                  <Text style={styles.controllerZoneBadgeText}>
                    {selectedAsset.zoneCount} zone{selectedAsset.zoneCount !== 1 ? 's' : ''}
                  </Text>
                </View>
              )}

              {selectedAsset.properties.length > 0 && (
                <View style={styles.assetProps}>
                  {selectedAsset.properties.filter(p => p.key !== 'controllerKey' && p.key !== 'controllerColor').slice(0, 4).map((p) => (
                    <View key={p.key} style={styles.assetPropRow}>
                      <Text style={styles.assetPropKey}>{p.key}:</Text>
                      <Text style={styles.assetPropVal}>{p.value}</Text>
                    </View>
                  ))}
                </View>
              )}

              <View style={styles.assetBtnRow}>
                {selectedAsset.featureRef && onShowControllerZones && (
                  <TouchableOpacity
                    style={[styles.assetDetailBtn, styles.showControllerBtn]}
                    onPress={() => onShowControllerZones(selectedAsset.featureRef!)}
                  >
                    <Ionicons name="water-outline" size={16} color="#0C1D31" />
                    <Text style={styles.showControllerBtnText}>Zones</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.assetDetailBtn}
                  onPress={() => onAssetDetail?.(selectedAsset.id)}
                >
                  <Ionicons name="information-circle-outline" size={16} color="#fff" />
                  <Text style={styles.assetDetailBtnText}>Details</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.assetDetailBtn, styles.assetHistoryBtn]}
                  onPress={() => onAssetHistory?.(selectedAsset.id)}
                >
                  <Ionicons name="time-outline" size={16} color="#fff" />
                  <Text style={styles.assetDetailBtnText}>History</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <View style={styles.assetPopupHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.assetPopupLabel}>{selectedAsset.label}</Text>
                  <Text style={styles.assetPopupType}>
                    {ASSET_TYPE_LABELS[selectedAsset.assetType] || selectedAsset.assetType}
                  </Text>
                </View>
                <TouchableOpacity onPress={onDismissAsset} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Ionicons name="close-circle" size={24} color="#999" />
                </TouchableOpacity>
              </View>

              {selectedAsset.properties.length > 0 && (
                <View style={styles.assetProps}>
                  {selectedAsset.properties.slice(0, 4).map((p) => (
                    <View key={p.key} style={styles.assetPropRow}>
                      <Text style={styles.assetPropKey}>{p.key}:</Text>
                      <Text style={styles.assetPropVal}>{p.value}</Text>
                    </View>
                  ))}
                  {selectedAsset.properties.length > 4 && (
                    <Text style={styles.assetPropMore}>+{selectedAsset.properties.length - 4} more</Text>
                  )}
                </View>
              )}

              <View style={styles.assetBtnRow}>
                <TouchableOpacity
                  style={styles.assetDetailBtn}
                  onPress={() => onAssetDetail?.(selectedAsset.id)}
                >
                  <Ionicons name="information-circle-outline" size={18} color="#fff" />
                  <Text style={styles.assetDetailBtnText}>Details</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.assetDetailBtn, styles.assetHistoryBtn]}
                  onPress={() => onAssetHistory?.(selectedAsset.id)}
                >
                  <Ionicons name="time-outline" size={18} color="#fff" />
                  <Text style={styles.assetDetailBtnText}>History</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      )}
    </View>
  );
}

export default React.memo(NativeMap);

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  callout: { width: 200, padding: 4 },
  calloutTitle: { fontSize: 14, fontWeight: '600', color: '#0C1D31' },
  calloutAddress: { fontSize: 12, color: '#666', marginTop: 2 },
  calloutAction: { fontSize: 11, color: '#25C1AC', marginTop: 4, fontWeight: '500' },
  legend: {
    position: 'absolute',
    bottom: 100,
    left: 16,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 12,
    padding: 10,
    flexDirection: 'row',
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11, color: '#666', textTransform: 'capitalize' },

  controllerMarker: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 3,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 5,
  },
  controllerMarkerLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: '#fff',
    textAlign: 'center',
  },
  zoneRing: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2.5,
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
  clusterBadge: {
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
  },
  clusterBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#fff',
  },

  assetPopup: {
    position: 'absolute',
    bottom: 100,
    left: 16,
    right: 16,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  assetPopupHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  assetPopupLabel: { fontSize: 17, fontWeight: '700', color: '#0C1D31' },
  assetPopupType: { fontSize: 13, color: '#25C1AC', marginTop: 2, fontWeight: '500' },

  zoneSubHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
    gap: 6,
  },
  controllerDotInline: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  zoneControllerText: {
    fontSize: 13,
    color: '#666',
    fontWeight: '500',
  },
  zoneDetailsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  zoneDetailChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#f0faf8',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  zoneDetailChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0C1D31',
  },
  controllerPopupTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  controllerDotLarge: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1,
    elevation: 2,
  },
  controllerZoneBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#f0faf8',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignSelf: 'flex-start',
    marginBottom: 10,
  },
  controllerZoneBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0C1D31',
  },
  showControllerBtn: {
    backgroundColor: '#f0f0f0',
  },
  showControllerBtnText: {
    color: '#0C1D31',
    fontSize: 12,
    fontWeight: '600',
  },

  assetProps: { marginBottom: 12 },
  assetPropRow: { flexDirection: 'row', marginBottom: 4 },
  assetPropKey: { fontSize: 13, color: '#666', fontWeight: '500', marginRight: 6 },
  assetPropVal: { fontSize: 13, color: '#333', flex: 1 },
  assetPropMore: { fontSize: 12, color: '#888', fontStyle: 'italic', marginTop: 2 },
  assetBtnRow: {
    flexDirection: 'row',
    gap: 8,
  },
  assetDetailBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#25C1AC',
    borderRadius: 10,
    paddingVertical: 10,
    gap: 5,
  },
  assetHistoryBtn: {
    backgroundColor: '#0C1D31',
  },
  assetDetailBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  zoomHint: {
    position: 'absolute',
    top: 16,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(12,29,49,0.8)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  zoomHintText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
});
