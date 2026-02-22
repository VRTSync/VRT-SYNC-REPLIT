import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, ScrollView, Switch, ActivityIndicator } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiRequest, getQueryFn } from '@/lib/query-client';
import { useCommunity } from '@/client/contexts/CommunityContext';

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
  const { activeCommunity } = useCommunity();
  const insets = useSafeAreaInsets();
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [NativeMapComponent, setNativeMapComponent] = useState<React.ComponentType<any> | null>(null);
  const [activeCategory, setActiveCategory] = useState('community');
  const [enabledLayerIds, setEnabledLayerIds] = useState<Set<string>>(new Set());
  const [showLayerPanel, setShowLayerPanel] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<AssetInfo | null>(null);
  const [loadedGeoJSON, setLoadedGeoJSON] = useState<Record<string, any>>({});
  const [loadingGeoJSON, setLoadingGeoJSON] = useState<Set<string>>(new Set());

  const communityId = activeCommunity?.id;

  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: ['/api/tasks', { communityId }],
    queryFn: async () => {
      const route = communityId ? `/api/tasks?communityId=${communityId}` : '/api/tasks';
      const res = await apiRequest('GET', route);
      return res.json();
    },
    enabled: !!activeCommunity,
  });

  const { data: allLayers = [] } = useQuery<MapLayerMeta[]>({
    queryKey: ['/api/map-layers', { communityId }],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/map-layers?communityId=${communityId}`);
      return res.json();
    },
    enabled: !!communityId,
  });

  const categoryLayers = allLayers.filter((l) => l.layerKey === activeCategory);
  const geoTasks = tasks.filter((t) => t.latitude != null && t.longitude != null && t.status !== 'completed');

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
    if (categoryLayers.length > 0) {
      setEnabledLayerIds((prev) => {
        const next = new Set(prev);
        categoryLayers.forEach((l) => {
          if (!next.has(l.id)) next.add(l.id);
        });
        return next;
      });
    }
  }, [categoryLayers.length, activeCategory]);

  const fetchGeoJSON = useCallback(async (layerId: string) => {
    if (loadedGeoJSON[layerId] || loadingGeoJSON.has(layerId)) return;
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
  }, [loadedGeoJSON, loadingGeoJSON]);

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

  const handleFeatureTap = useCallback(async (featureRef: string, _layerKey: string) => {
    if (!communityId) return;
    try {
      const res = await apiRequest('GET', `/api/assets/by-feature?communityId=${communityId}&featureRef=${encodeURIComponent(featureRef)}`);
      const asset = await res.json();
      if (asset) {
        setSelectedAsset(asset);
      }
    } catch (err) {
      console.error('Feature tap error:', err);
    }
  }, [communityId]);

  const activeLayers = categoryLayers
    .filter((l) => enabledLayerIds.has(l.id))
    .map((l, idx) => ({
      id: l.id,
      layerKey: l.layerKey,
      subLayerKey: l.subLayerKey,
      displayName: l.displayName,
      geojson: loadedGeoJSON[l.id] || null,
      color: layerColors[idx % layerColors.length],
    }));

  if (Platform.OS === 'web') {
    return (
      <View style={[styles.container, { paddingTop: 67 + insets.top }]}>
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
            {categoryLayers.map((layer, idx) => (
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

  const mappedTasks = geoTasks.map((t) => ({
    id: t.id,
    title: t.title,
    priority: t.priority,
    latitude: t.latitude!,
    longitude: t.longitude!,
    address: t.address,
  }));

  return (
    <View style={styles.container}>
      <View style={styles.categoryBarFloat}>
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

      {categoryLayers.length > 0 && (
        <TouchableOpacity
          style={styles.layerToggleBtn}
          onPress={() => setShowLayerPanel(!showLayerPanel)}
        >
          <Ionicons name="layers-outline" size={20} color="#0C1D31" />
          <Text style={styles.layerToggleBtnText}>{categoryLayers.length}</Text>
        </TouchableOpacity>
      )}

      {showLayerPanel && (
        <View style={styles.layerPanel}>
          <Text style={styles.layerPanelTitle}>Layers</Text>
          {categoryLayers.map((layer, idx) => (
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
        </View>
      )}

      <NativeMapComponent
        tasks={mappedTasks}
        userLocation={userLocation}
        onTaskPress={(taskId: string) => router.push(`/task/${taskId}`)}
        layers={activeLayers}
        onFeatureTap={handleFeatureTap}
        selectedAsset={selectedAsset}
        onDismissAsset={() => setSelectedAsset(null)}
        onAssetDetail={(assetId: string) => {
          setSelectedAsset(null);
          router.push(`/asset/${assetId}`);
        }}
        onAssetHistory={(assetId: string) => {
          setSelectedAsset(null);
          router.push(`/asset/${assetId}/history` as any);
        }}
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
});
