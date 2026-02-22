import React, { useRef, useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView } from 'react-native';
import MapView, { Marker, Callout, Polygon, Polyline } from 'react-native-maps';
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
};

type AssetInfo = {
  id: string;
  assetType: string;
  label: string;
  featureRef: string | null;
  properties: { key: string; value: string }[];
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

function parseGeoJSONCoords(coords: number[]): { latitude: number; longitude: number } {
  return { latitude: coords[1], longitude: coords[0] };
}

function parseRing(ring: number[][]): { latitude: number; longitude: number }[] {
  return ring.map(parseGeoJSONCoords);
}

export default function NativeMap({
  tasks,
  userLocation,
  onTaskPress,
  layers = [],
  onFeatureTap,
  selectedAsset,
  onDismissAsset,
  onAssetDetail,
}: {
  tasks: Task[];
  userLocation: { latitude: number; longitude: number } | null;
  onTaskPress: (id: string) => void;
  layers?: LayerData[];
  onFeatureTap?: (featureRef: string, layerKey: string) => void;
  selectedAsset?: AssetInfo | null;
  onDismissAsset?: () => void;
  onAssetDetail?: (assetId: string) => void;
}) {
  const mapRef = useRef<MapView>(null);

  useEffect(() => {
    if (tasks.length > 0 && mapRef.current) {
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
  }, [tasks.length, userLocation]);

  const initialRegion = userLocation
    ? { ...userLocation, latitudeDelta: 0.05, longitudeDelta: 0.05 }
    : { latitude: 39.8283, longitude: -98.5795, latitudeDelta: 30, longitudeDelta: 30 };

  const renderGeoJSONFeatures = useCallback(() => {
    const elements: React.ReactNode[] = [];

    layers.forEach((layer, layerIndex) => {
      if (!layer.geojson) return;
      const color = layer.color || layerColors[layerIndex % layerColors.length];
      const fillColor = color + '40';

      const features: GeoJSONFeature[] = layer.geojson.type === 'FeatureCollection'
        ? layer.geojson.features || []
        : layer.geojson.type === 'Feature'
          ? [layer.geojson]
          : [];

      features.forEach((feature, fIdx) => {
        const key = `${layer.id}-${fIdx}`;
        const geom = feature.geometry;
        if (!geom) return;
        const featureRef = feature.properties?.featureRef || feature.properties?.id || feature.properties?.name;

        if (geom.type === 'Polygon') {
          const outerRing = parseRing(geom.coordinates[0]);
          elements.push(
            <Polygon
              key={key}
              coordinates={outerRing}
              fillColor={fillColor}
              strokeColor={color}
              strokeWidth={2}
              tappable={!!featureRef && !!onFeatureTap}
              onPress={() => featureRef && onFeatureTap?.(featureRef, layer.layerKey)}
            />
          );
        } else if (geom.type === 'MultiPolygon') {
          geom.coordinates.forEach((poly: number[][][], pIdx: number) => {
            const outerRing = parseRing(poly[0]);
            elements.push(
              <Polygon
                key={`${key}-${pIdx}`}
                coordinates={outerRing}
                fillColor={fillColor}
                strokeColor={color}
                strokeWidth={2}
                tappable={!!featureRef && !!onFeatureTap}
                onPress={() => featureRef && onFeatureTap?.(featureRef, layer.layerKey)}
              />
            );
          });
        } else if (geom.type === 'LineString') {
          elements.push(
            <Polyline
              key={key}
              coordinates={parseRing(geom.coordinates)}
              strokeColor={color}
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
                strokeColor={color}
                strokeWidth={3}
                tappable={!!featureRef && !!onFeatureTap}
                onPress={() => featureRef && onFeatureTap?.(featureRef, layer.layerKey)}
              />
            );
          });
        } else if (geom.type === 'Point') {
          const coord = parseGeoJSONCoords(geom.coordinates);
          elements.push(
            <Marker
              key={key}
              coordinate={coord}
              pinColor={color}
              onPress={() => featureRef && onFeatureTap?.(featureRef, layer.layerKey)}
            >
              <Callout>
                <View style={styles.callout}>
                  <Text style={styles.calloutTitle}>{feature.properties?.name || featureRef || 'Feature'}</Text>
                </View>
              </Callout>
            </Marker>
          );
        }
      });
    });

    return elements;
  }, [layers, onFeatureTap]);

  const ASSET_TYPE_LABELS: Record<string, string> = {
    controller: 'Controller', backflow: 'Backflow', zone: 'Zone', tree: 'Tree',
    pet_station: 'Pet Station', landscape_bed: 'Landscape Bed', bluegrass_area: 'Bluegrass Area',
    native_area: 'Native Area', snow_area: 'Snow Area',
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={initialRegion}
        showsUserLocation
        showsMyLocationButton
      >
        {renderGeoJSONFeatures()}
        {tasks.map((task) => (
          <Marker
            key={task.id}
            coordinate={{ latitude: task.latitude, longitude: task.longitude }}
            pinColor={priorityColors[task.priority]}
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
      </MapView>

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

          <TouchableOpacity
            style={styles.assetDetailBtn}
            onPress={() => onAssetDetail?.(selectedAsset.id)}
          >
            <Ionicons name="information-circle-outline" size={18} color="#fff" />
            <Text style={styles.assetDetailBtnText}>View Full Details</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

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
  assetProps: { marginBottom: 12 },
  assetPropRow: { flexDirection: 'row', marginBottom: 4 },
  assetPropKey: { fontSize: 13, color: '#666', fontWeight: '500', marginRight: 6 },
  assetPropVal: { fontSize: 13, color: '#333', flex: 1 },
  assetPropMore: { fontSize: 12, color: '#888', fontStyle: 'italic', marginTop: 2 },
  assetDetailBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#25C1AC',
    borderRadius: 10,
    paddingVertical: 10,
    gap: 6,
  },
  assetDetailBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
