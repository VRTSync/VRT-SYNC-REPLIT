import React, { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getApiUrl } from '@/lib/query-client';
/**
 * The Leaflet map HTML is imported from the canonical shared template.
 * To change map styling, marker shapes, popup layout, or any map CSS,
 * edit ONLY lib/leaflet-template/src/index.ts — it is the single source of truth
 * used by both this mobile component and the web portal iframe.
 */
import { LEAFLET_MAP_HTML } from '@workspace/leaflet-template';

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
  communityOutlineGeojson?: any | null;
  communityOutlineStyle?: { strokeColor?: string; strokeWeight?: number; fillOpacity?: number } | null;
  filteredTaskIds?: string[] | null;
  userLocationHalo?: { lat: number; lng: number; accuracyMetres: number; color: string } | null;
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
  communityOutlineGeojson,
  communityOutlineStyle,
  filteredTaskIds,
  userLocationHalo,
}: LeafletMapProps) {
  const webViewRef = useRef<any>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const mapReadyRef = useRef(false);
  const pendingRef = useRef<{ fn: string; args: any[] }[]>([]);
  const outlineEverSentRef = useRef(false);
  const onViewAssetDetailRef = useRef(onViewAssetDetail);
  onViewAssetDetailRef.current = onViewAssetDetail;
  const onTargetReachedRef = useRef(onTargetReached);
  onTargetReachedRef.current = onTargetReached;
  const onTaskPressRef = useRef(onTaskPress);
  onTaskPressRef.current = onTaskPress;
  const isWeb = Platform.OS === 'web';

  const sendCmd = useCallback((fn: string, ...args: any[]) => {
    if (mapReadyRef.current) {
      if (isWeb && iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage({ type: 'cmd', fn, args }, '*');
      } else if (!isWeb && webViewRef.current) {
        const argsJson = JSON.stringify(args);
        webViewRef.current.injectJavaScript(
          `window.mapBridge[${JSON.stringify(fn)}].apply(window.mapBridge, ${argsJson}); true;`
        );
      }
    } else {
      pendingRef.current.push({ fn, args });
    }
  }, [isWeb]);

  const flushPending = useCallback(() => {
    if (pendingRef.current.length > 0) {
      const cmds = pendingRef.current.slice();
      pendingRef.current = [];
      cmds.forEach((cmd: { fn: string; args: any[] }) => {
        if (isWeb && iframeRef.current?.contentWindow) {
          iframeRef.current.contentWindow.postMessage({ type: 'cmd', fn: cmd.fn, args: cmd.args }, '*');
        } else if (!isWeb && webViewRef.current) {
          const argsJson = JSON.stringify(cmd.args);
          webViewRef.current.injectJavaScript(
            `window.mapBridge[${JSON.stringify(cmd.fn)}].apply(window.mapBridge, ${argsJson}); true;`
          );
        }
      });
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
          pendingRef.current.unshift({ fn: 'fitBounds', args: [[[b[0][0], b[0][1]], [b[1][0], b[1][1]]]] });
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
      sendCmd('fitBounds', [[b[0][0], b[0][1]], [b[1][0], b[1][1]]]);
    }
  }, [initialBounds, sendCmd]);

  useEffect(() => {
    if (userLocation) {
      sendCmd('setUserLocation', userLocation.latitude, userLocation.longitude);
    }
  }, [userLocation, sendCmd]);

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
    sendCmd('setTasks', taskData);
  }, [taskData, sendCmd]);

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
      sendCmd('addLayers', newLayers);
      newLayers.forEach(l => sentLayerIdsRef.current.add(l.id));
    }
    const activeIds = layerData.filter(l => l.geojson).map(l => l.id);
    sendCmd('showLayerIds', activeIds);
  }, [layerData, sendCmd]);

  useEffect(() => {
    if (showControllers && controllerMarkers.length > 0) {
      sendCmd('setControllerMarkers', controllerMarkers);
      sendCmd('showControllers', true);
    } else {
      sendCmd('showControllers', false);
    }
  }, [showControllers, controllerMarkers, sendCmd]);

  useEffect(() => {
    if (showZones && zoneMarkers.length > 0) {
      sendCmd('setZoneMarkers', zoneMarkers);
      sendCmd('showZones', true);
    } else {
      sendCmd('showZones', false);
    }
  }, [showZones, zoneMarkers, sendCmd]);

  useEffect(() => {
    if (targetRegion) {
      sendCmd('flyTo', targetRegion.latitude, targetRegion.longitude, 16, targetRegion.label || '');
    }
  }, [targetRegion, sendCmd]);

  useEffect(() => {
    if (communityOutlineGeojson == null && !outlineEverSentRef.current) return;
    if (communityOutlineGeojson != null) outlineEverSentRef.current = true;
    sendCmd('setCommunityOutline', communityOutlineGeojson ?? null, communityOutlineStyle ?? null);
  }, [communityOutlineGeojson, communityOutlineStyle, sendCmd]);

  useEffect(() => {
    if (filteredTaskIds && filteredTaskIds.length > 0) {
      sendCmd('filterTasks', filteredTaskIds);
    } else {
      sendCmd('clearTaskFilter');
    }
  }, [filteredTaskIds, sendCmd]);

  useEffect(() => {
    if (userLocationHalo) {
      sendCmd('setUserLocationHalo', userLocationHalo.lat, userLocationHalo.lng, userLocationHalo.accuracyMetres, userLocationHalo.color);
    } else {
      sendCmd('clearUserLocationHalo');
    }
  }, [userLocationHalo, sendCmd]);

  const htmlContent = useMemo(() => LEAFLET_MAP_HTML, []);

  const iframeSrcDoc = useMemo(() => htmlContent, [htmlContent]);

  const handleIframeLoad = useCallback(() => {
    if (mapReadyRef.current) {
      flushPending();
      return;
    }
    try {
      if (iframeRef.current?.contentWindow && (iframeRef.current.contentWindow as any).mapBridge) {
        mapReadyRef.current = true;
        flushPending();
      }
    } catch (e) {}
  }, [flushPending]);

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
