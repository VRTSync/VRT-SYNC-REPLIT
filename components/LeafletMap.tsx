import React, { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getApiUrl } from '@/lib/query-client';
/**
 * The Leaflet map HTML is imported from the canonical shared template.
 * To change map styling, marker shapes, popup layout, or any map CSS,
 * edit ONLY shared/leaflet-map-template.ts — it is the single source of truth
 * used by both this mobile component and the web portal iframe.
 */
import { LEAFLET_MAP_HTML } from '@/shared/leaflet-map-template';

let WebView: any = null;
if (Platform.OS !== 'web') {
  WebView = require('react-native-webview').WebView;
}

type Task = {
  id: string;
  title: string;
  priority: string;
  latitude: number;
  longitude: number;
  address: string | null;
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

type LeafletMapProps = {
  tasks: Task[];
  userLocation: { latitude: number; longitude: number } | null;
  onTaskPress: (id: string) => void;
  layers?: LayerData[];
  onViewAssetDetail?: (featureRef: string, layerKey: string, meta?: { label?: string; assetType?: string; layerName?: string }) => void;
  targetRegion?: { latitude: number; longitude: number; label?: string } | null;
  onTargetReached?: () => void;
  controllerMarkers?: ControllerMarkerData[];
  zoneMarkers?: ZoneMarkerData[];
  showControllers?: boolean;
  showZones?: boolean;
  activeCategory?: string;
  fitToContentKey?: string;
  initialBounds?: [[number, number], [number, number]] | null;
};

const priorityColors: Record<string, string> = {
  low: '#4caf50',
  medium: '#ff9800',
  high: '#f44336',
  urgent: '#9c27b0',
};

export default function LeafletMap({
  tasks,
  userLocation,
  onTaskPress,
  layers = [],
  onViewAssetDetail,
  targetRegion,
  onTargetReached,
  controllerMarkers = [],
  zoneMarkers = [],
  showControllers = false,
  showZones = false,
  activeCategory = 'community',
  fitToContentKey,
  initialBounds,
}: LeafletMapProps) {
  const webViewRef = useRef<any>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const mapReadyRef = useRef(false);
  const pendingRef = useRef<string[]>([]);
  const onViewAssetDetailRef = useRef(onViewAssetDetail);
  onViewAssetDetailRef.current = onViewAssetDetail;
  const onTargetReachedRef = useRef(onTargetReached);
  onTargetReachedRef.current = onTargetReached;
  const onTaskPressRef = useRef(onTaskPress);
  onTaskPressRef.current = onTaskPress;
  const isWeb = Platform.OS === 'web';

  const runJS = useCallback((js: string) => {
    if (mapReadyRef.current) {
      if (isWeb && iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage({ type: 'eval', code: js }, '*');
      } else if (!isWeb && webViewRef.current) {
        webViewRef.current.injectJavaScript(js + '; true;');
      }
    } else {
      pendingRef.current.push(js);
    }
  }, [isWeb]);

  const flushPending = useCallback(() => {
    if (pendingRef.current.length > 0) {
      const batch = pendingRef.current.join('; ');
      pendingRef.current = [];
      if (isWeb && iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage({ type: 'eval', code: batch }, '*');
      } else if (!isWeb && webViewRef.current) {
        webViewRef.current.injectJavaScript(batch + '; true;');
      }
    }
  }, [isWeb]);

  const initialBoundsRef = useRef(initialBounds);
  initialBoundsRef.current = initialBounds;
  const initialBoundsAppliedRef = useRef(false);

  const processMsg = useCallback((msg: any) => {
    switch (msg.type) {
      case 'mapReady':
        mapReadyRef.current = true;
        if (!initialBoundsAppliedRef.current && initialBoundsRef.current) {
          initialBoundsAppliedRef.current = true;
          const b = initialBoundsRef.current;
          const js = `window.mapBridge.fitBounds([[${b[0][0]},${b[0][1]}],[${b[1][0]},${b[1][1]}]])`;
          pendingRef.current.unshift(js);
        }
        flushPending();
        break;
      case 'taskPress':
        onTaskPressRef.current(msg.data.id);
        break;
      case 'viewAssetDetail':
      case 'featureTap':
        onViewAssetDetailRef.current?.(msg.data.featureRef, msg.data.layerKey, {
          label: msg.data.label || '',
          assetType: msg.data.assetType || '',
          layerName: msg.data.layerName || '',
        });
        break;
      case 'targetReached':
        onTargetReachedRef.current?.();
        break;
    }
  }, [flushPending]);

  const handleMessage = useCallback((event: any) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      processMsg(msg);
    } catch (e) {}
  }, [processMsg]);

  useEffect(() => {
    if (!isWeb) return;
    const handler = (event: MessageEvent) => {
      if (typeof event.data === 'string') {
        try {
          processMsg(JSON.parse(event.data));
        } catch (e) {}
      } else if (event.data && event.data.type) {
        processMsg(event.data);
      }
    };
    window.addEventListener('message', handler);
    if (!mapReadyRef.current && iframeRef.current?.contentWindow) {
      try {
        if ((iframeRef.current.contentWindow as any).mapBridge) {
          mapReadyRef.current = true;
          flushPending();
        }
      } catch (e) {}
    }
    return () => window.removeEventListener('message', handler);
  }, [isWeb, processMsg, flushPending]);

  useEffect(() => {
    if (!initialBoundsAppliedRef.current && initialBounds) {
      initialBoundsAppliedRef.current = true;
      const b = initialBounds;
      runJS(`window.mapBridge.fitBounds([[${b[0][0]},${b[0][1]}],[${b[1][0]},${b[1][1]}]])`);
    }
  }, [initialBounds, runJS]);

  useEffect(() => {
    if (userLocation) {
      runJS(`window.mapBridge.setUserLocation(${userLocation.latitude}, ${userLocation.longitude})`);
    }
  }, [userLocation, runJS]);

  const taskData = useMemo(() => {
    return tasks.map(t => ({
      id: t.id,
      title: t.title,
      latitude: t.latitude,
      longitude: t.longitude,
      address: t.address,
      priorityColor: priorityColors[t.priority] || '#ff9800',
    }));
  }, [tasks]);

  useEffect(() => {
    runJS(`window.mapBridge.setTasks(${JSON.stringify(taskData)})`);
  }, [taskData, runJS]);

  const sentLayerIdsRef = useRef<Set<string>>(new Set());

  const layerData = useMemo(() => {
    return layers.map(l => ({
      id: l.id,
      layerKey: l.layerKey,
      subLayerKey: l.subLayerKey,
      displayName: l.displayName,
      geojson: l.geojson,
      color: l.color,
      controllerColorMap: l.controllerColorMap ? Object.fromEntries(l.controllerColorMap) : {},
    }));
  }, [layers]);

  useEffect(() => {
    const newLayers = layerData.filter(l => l.geojson && !sentLayerIdsRef.current.has(l.id));
    if (newLayers.length > 0) {
      runJS(`window.mapBridge.addLayers(${JSON.stringify(newLayers)})`);
      newLayers.forEach(l => sentLayerIdsRef.current.add(l.id));
    }
    const activeIds = layerData.filter(l => l.geojson).map(l => l.id);
    runJS(`window.mapBridge.showLayerIds(${JSON.stringify(activeIds)})`);
  }, [layerData, runJS]);

  useEffect(() => {
    if (showControllers && controllerMarkers.length > 0) {
      runJS(`window.mapBridge.setControllerMarkers(${JSON.stringify(controllerMarkers)})`);
      runJS(`window.mapBridge.showControllers(true)`);
    } else {
      runJS(`window.mapBridge.showControllers(false)`);
    }
  }, [showControllers, controllerMarkers, runJS]);

  useEffect(() => {
    if (showZones && zoneMarkers.length > 0) {
      runJS(`window.mapBridge.setZoneMarkers(${JSON.stringify(zoneMarkers)})`);
      runJS(`window.mapBridge.showZones(true)`);
    } else {
      runJS(`window.mapBridge.showZones(false)`);
    }
  }, [showZones, zoneMarkers, runJS]);

  useEffect(() => {
    if (targetRegion) {
      runJS(`window.mapBridge.flyTo(${targetRegion.latitude}, ${targetRegion.longitude}, 16, ${JSON.stringify(targetRegion.label || '')})`);
    }
  }, [targetRegion, runJS]);

  const htmlContent = useMemo(() => LEAFLET_MAP_HTML, []);

  const iframeSrcDoc = useMemo(() => htmlContent, [htmlContent]);

  const handleIframeLoad = useCallback(() => {
  }, []);

  const [webViewError, setWebViewError] = useState<string | null>(null);

  const handleWebViewError = useCallback((syntheticEvent: any) => {
    const { nativeEvent } = syntheticEvent;
    setWebViewError(nativeEvent?.description || 'Map failed to load');
  }, []);

  const renderMap = () => {
    if (isWeb) {
      return (
        <View style={{ flex: 1, position: 'relative' }}>
          <iframe
            ref={iframeRef as any}
            srcDoc={iframeSrcDoc}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%', border: 'none' } as any}
            onLoad={handleIframeLoad}
          />
        </View>
      );
    }
    if (!WebView) return null;
    if (webViewError) {
      return (
        <View style={[styles.webview, { justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f7fa' }]}>
          <Ionicons name="warning-outline" size={40} color="#ff9800" />
          <Text style={{ color: '#333', fontSize: 14, marginTop: 8, textAlign: 'center', paddingHorizontal: 20 }}>
            Map failed to load. Check your connection.
          </Text>
          <TouchableOpacity
            onPress={() => { setWebViewError(null); }}
            style={{ marginTop: 12, backgroundColor: '#25C1AC', borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10 }}
          >
            <Text style={{ color: '#fff', fontWeight: '600' }}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <WebView
        ref={webViewRef}
        source={{ html: htmlContent }}
        style={styles.webview}
        onMessage={handleMessage}
        onError={handleWebViewError}
        javaScriptEnabled
        domStorageEnabled
        cacheEnabled={false}
        originWhitelist={['*']}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        allowsInlineMediaPlayback
        mixedContentMode="always"
        startInLoadingState
        renderLoading={() => (
          <View style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f7fa' }]}>
            <ActivityIndicator size="large" color="#25C1AC" />
            <Text style={{ color: '#888', fontSize: 13, marginTop: 8 }}>Loading map...</Text>
          </View>
        )}
      />
    );
  };

  return (
    <View style={styles.container}>
      {renderMap()}

      <View style={styles.legend}>
        {Object.entries(priorityColors).map(([label, color]) => (
          <View key={label} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: color }]} />
            <Text style={styles.legendText}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  webview: { flex: 1 },
  legend: {
    position: 'absolute',
    bottom: 16,
    left: 12,
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 10, color: '#666', textTransform: 'capitalize' },
});
