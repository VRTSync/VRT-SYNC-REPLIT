import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

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

type LeafletMapProps = {
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

const priorityColors: Record<string, string> = {
  low: '#4caf50',
  medium: '#ff9800',
  high: '#f44336',
  urgent: '#9c27b0',
};

const ASSET_TYPE_LABELS: Record<string, string> = {
  controller: 'Controller', backflow: 'Backflow', zone: 'Zone', tree: 'Tree',
  pet_station: 'Pet Station', landscape_bed: 'Landscape Bed', bluegrass_area: 'Bluegrass Area',
  native_area: 'Native Area', snow_area: 'Snow Area',
};

function generateLeafletHTML(): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css" />
<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body, #map { width: 100%; height: 100%; }
  .task-marker {
    width: 12px; height: 12px; border-radius: 50%;
    border: 2px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.3);
  }
  .ctrl-marker {
    display: flex; align-items: center; justify-content: center;
    min-width: 28px; height: 22px; border-radius: 6px;
    border: 2px solid #fff; color: #fff; font-size: 11px;
    font-weight: 700; padding: 0 5px; box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    white-space: nowrap; text-shadow: 0 1px 1px rgba(0,0,0,0.3);
  }
  .zone-ring {
    width: 14px; height: 14px; border-radius: 50%;
    border: 3px solid; background: rgba(255,255,255,0.5);
    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
  }
  .user-loc {
    width: 14px; height: 14px; border-radius: 50%;
    background: #4285F4; border: 3px solid #fff;
    box-shadow: 0 0 8px rgba(66,133,244,0.5);
  }
  .target-marker {
    width: 16px; height: 16px; border-radius: 50%;
    background: #25C1AC; border: 3px solid #fff;
    box-shadow: 0 0 8px rgba(37,193,172,0.5);
  }
  .cluster-badge {
    display: flex; align-items: center; justify-content: center;
    border-radius: 50%; color: #fff; font-weight: 700;
    font-size: 12px; border: 2px solid #fff;
    box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    text-shadow: 0 1px 1px rgba(0,0,0,0.3);
  }
  .leaflet-popup-content-wrapper {
    border-radius: 10px; padding: 0;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  }
  .leaflet-popup-content { margin: 10px 14px; font-family: -apple-system, system-ui, sans-serif; }
  .popup-title { font-weight: 600; font-size: 14px; color: #0C1D31; }
  .popup-addr { font-size: 12px; color: #888; margin-top: 2px; }
  .popup-action { font-size: 12px; color: #25C1AC; margin-top: 6px; font-weight: 500; cursor: pointer; }
  .marker-cluster-small, .marker-cluster-medium, .marker-cluster-large {
    background: rgba(37,193,172,0.3) !important;
  }
  .marker-cluster-small div, .marker-cluster-medium div, .marker-cluster-large div {
    background: #25C1AC !important; color: #fff !important;
    font-weight: 700 !important;
  }
</style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js"></script>
<script>
(function() {
  var map = L.map('map', {
    zoomControl: false,
    attributionControl: false
  }).setView([39.8283, -98.5795], 4);

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 20
  }).addTo(map);

  var geoLayers = {};
  var taskLayer = L.layerGroup().addTo(map);
  var ctrlLayer = L.layerGroup().addTo(map);
  var zoneClusterGroup = L.markerClusterGroup({
    maxClusterRadius: 40,
    disableClusteringAtZoom: 17,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    iconCreateFunction: function(cluster) {
      var count = cluster.getChildCount();
      var size = count < 10 ? 30 : count < 50 ? 36 : 42;
      var colors = {};
      cluster.getAllChildMarkers().forEach(function(m) {
        if (m._zoneColor) colors[m._zoneColor] = true;
      });
      var colorKeys = Object.keys(colors);
      var bg = colorKeys.length === 1 ? colorKeys[0] : '#6b7280';
      return L.divIcon({
        html: '<div class="cluster-badge" style="width:'+size+'px;height:'+size+'px;background:'+bg+';">'+count+'</div>',
        className: '',
        iconSize: [size, size],
        iconAnchor: [size/2, size/2]
      });
    }
  }).addTo(map);
  var userLocMarker = null;
  var targetMarker = null;

  function post(type, data) {
    try {
      var msg = JSON.stringify({ type: type, data: data });
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(msg);
      } else if (window.parent !== window) {
        window.parent.postMessage(msg, '*');
      }
    } catch(e) {}
  }

  function clearGroup(group) {
    group.clearLayers();
  }

  window.mapBridge = {
    setUserLocation: function(lat, lng) {
      if (userLocMarker) map.removeLayer(userLocMarker);
      userLocMarker = L.marker([lat, lng], {
        icon: L.divIcon({ html: '<div class="user-loc"></div>', className: '', iconSize: [14,14], iconAnchor: [7,7] }),
        zIndex: 1000
      }).addTo(map);
    },

    setTasks: function(tasks) {
      clearGroup(taskLayer);
      tasks.forEach(function(t) {
        var color = t.priorityColor || '#ff9800';
        var m = L.marker([t.latitude, t.longitude], {
          icon: L.divIcon({
            html: '<div class="task-marker" style="background:'+color+';"></div>',
            className: '', iconSize: [12,12], iconAnchor: [6,6]
          }),
          zIndex: 100
        });
        var popupHtml = '<div class="popup-title">'+escHtml(t.title)+'</div>';
        if (t.address) popupHtml += '<div class="popup-addr">'+escHtml(t.address)+'</div>';
        popupHtml += '<div class="popup-action" onclick="window.mapBridge._taskTap(\''+t.id+'\')">Tap to view details</div>';
        m.bindPopup(popupHtml, { closeButton: true, minWidth: 150 });
        m.addTo(taskLayer);
      });
    },

    _taskTap: function(id) {
      post('taskPress', { id: id });
    },

    setLayers: function(layers) {
      Object.keys(geoLayers).forEach(function(k) {
        map.removeLayer(geoLayers[k]);
        delete geoLayers[k];
      });
      layers.forEach(function(layer) {
        if (!layer.geojson) return;
        var colorMap = layer.controllerColorMap || {};
        var geoLayer = L.geoJSON(layer.geojson, {
          style: function(feature) {
            var c = layer.color;
            if (layer.subLayerKey === 'zone' && feature.properties && feature.properties.controllerFeatureRef) {
              c = colorMap[feature.properties.controllerFeatureRef] || c;
            }
            if (layer.subLayerKey === 'controller' && feature.properties) {
              var fid = feature.properties.featureId || feature.id;
              c = colorMap[fid] || c;
            }
            return { color: c, weight: 2, fillColor: c, fillOpacity: 0.25, opacity: 0.8 };
          },
          pointToLayer: function(feature, latlng) {
            var c = layer.color;
            if (layer.subLayerKey === 'controller' && feature.properties) {
              var fid = feature.properties.featureId || feature.id;
              c = colorMap[fid] || c;
            }
            if (layer.subLayerKey === 'zone' && feature.properties && feature.properties.controllerFeatureRef) {
              c = colorMap[feature.properties.controllerFeatureRef] || c;
            }
            return L.circleMarker(latlng, {
              radius: 6, fillColor: c, fillOpacity: 0.7,
              color: '#fff', weight: 2
            });
          },
          onEachFeature: function(feature, l) {
            l.on('click', function() {
              var ref = feature.properties && (feature.properties.featureRef || feature.properties.featureId || feature.properties.id || feature.properties.name);
              if (ref) {
                post('featureTap', { featureRef: ref, layerKey: layer.layerKey });
              }
            });
          }
        }).addTo(map);
        geoLayers[layer.id] = geoLayer;
      });
    },

    setControllerMarkers: function(markers) {
      clearGroup(ctrlLayer);
      markers.forEach(function(c) {
        var m = L.marker([c.latitude, c.longitude], {
          icon: L.divIcon({
            html: '<div class="ctrl-marker" style="background:'+c.color+';">'+escHtml(c.controllerKey)+'</div>',
            className: '', iconSize: [28,22], iconAnchor: [14,11]
          }),
          zIndex: 500
        });
        m.on('click', function() {
          post('featureTap', { featureRef: c.featureRef, layerKey: 'irrigation' });
        });
        m.addTo(ctrlLayer);
      });
    },

    setZoneMarkers: function(markers) {
      zoneClusterGroup.clearLayers();
      markers.forEach(function(z) {
        var m = L.marker([z.latitude, z.longitude], {
          icon: L.divIcon({
            html: '<div class="zone-ring" style="border-color:'+z.controllerColor+';"></div>',
            className: '', iconSize: [14,14], iconAnchor: [7,7]
          })
        });
        m._zoneColor = z.controllerColor;
        m.on('click', function() {
          post('featureTap', { featureRef: z.featureRef, layerKey: 'irrigation' });
        });
        zoneClusterGroup.addLayer(m);
      });
    },

    clearIrrigation: function() {
      clearGroup(ctrlLayer);
      zoneClusterGroup.clearLayers();
    },

    flyTo: function(lat, lng, zoom, label) {
      map.flyTo([lat, lng], zoom || 16, { duration: 0.8 });
      if (targetMarker) map.removeLayer(targetMarker);
      if (label) {
        targetMarker = L.marker([lat, lng], {
          icon: L.divIcon({
            html: '<div class="target-marker"></div>',
            className: '', iconSize: [16,16], iconAnchor: [8,8]
          }),
          zIndex: 900
        }).bindPopup('<div class="popup-title">'+escHtml(label)+'</div>').addTo(map).openPopup();
      }
      post('targetReached', {});
    },

    fitBounds: function(coords) {
      if (!coords || coords.length === 0) return;
      var bounds = L.latLngBounds(coords.map(function(c) { return [c[0], c[1]]; }));
      map.fitBounds(bounds, { padding: [60, 40], maxZoom: 16 });
    },

    showControllers: function(show) {
      if (show) { if (!map.hasLayer(ctrlLayer)) map.addLayer(ctrlLayer); }
      else { if (map.hasLayer(ctrlLayer)) map.removeLayer(ctrlLayer); }
    },

    showZones: function(show) {
      if (show) { if (!map.hasLayer(zoneClusterGroup)) map.addLayer(zoneClusterGroup); }
      else { if (map.hasLayer(zoneClusterGroup)) map.removeLayer(zoneClusterGroup); }
    }
  };

  function escHtml(s) {
    if (!s) return '';
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'eval' && e.data.code) {
      try { new Function(e.data.code)(); } catch(ex) { console.error(ex); }
    }
  });

  post('mapReady', {});
})();
</script>
</body>
</html>`;
}

export default function LeafletMap({
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
}: LeafletMapProps) {
  const webViewRef = useRef<any>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const mapReadyRef = useRef(false);
  const pendingRef = useRef<string[]>([]);
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

  const processMsg = useCallback((msg: any) => {
    switch (msg.type) {
      case 'mapReady':
        mapReadyRef.current = true;
        flushPending();
        break;
      case 'taskPress':
        onTaskPress(msg.data.id);
        break;
      case 'featureTap':
        onFeatureTap?.(msg.data.featureRef, msg.data.layerKey);
        break;
      case 'targetReached':
        onTargetReached?.();
        break;
    }
  }, [onTaskPress, onFeatureTap, onTargetReached, flushPending]);

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
    return () => window.removeEventListener('message', handler);
  }, [isWeb, processMsg]);

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
    runJS(`window.mapBridge.setLayers(${JSON.stringify(layerData)})`);
  }, [layerData, runJS]);

  useEffect(() => {
    const isIrrigation = activeCategory === 'irrigation';
    if (isIrrigation && showControllers && controllerMarkers.length > 0) {
      runJS(`window.mapBridge.setControllerMarkers(${JSON.stringify(controllerMarkers)})`);
      runJS(`window.mapBridge.showControllers(true)`);
    } else {
      runJS(`window.mapBridge.showControllers(false)`);
    }
  }, [activeCategory, showControllers, controllerMarkers, runJS]);

  useEffect(() => {
    const isIrrigation = activeCategory === 'irrigation';
    if (isIrrigation && showZones && zoneMarkers.length > 0) {
      runJS(`window.mapBridge.setZoneMarkers(${JSON.stringify(zoneMarkers)})`);
      runJS(`window.mapBridge.showZones(true)`);
    } else {
      runJS(`window.mapBridge.showZones(false)`);
    }
  }, [activeCategory, showZones, zoneMarkers, runJS]);

  useEffect(() => {
    if (activeCategory !== 'irrigation') {
      runJS(`window.mapBridge.clearIrrigation()`);
    }
  }, [activeCategory, runJS]);

  useEffect(() => {
    if (targetRegion) {
      runJS(`window.mapBridge.flyTo(${targetRegion.latitude}, ${targetRegion.longitude}, 16, ${JSON.stringify(targetRegion.label || '')})`);
    }
  }, [targetRegion, runJS]);

  useEffect(() => {
    if (!fitToContentKey) return;
    const allCoords: [number, number][] = [];

    if (showControllers) {
      controllerMarkers.forEach(c => allCoords.push([c.latitude, c.longitude]));
    }
    if (showZones) {
      zoneMarkers.forEach(z => allCoords.push([z.latitude, z.longitude]));
    }
    layers.forEach(layer => {
      if (!layer.geojson) return;
      const features = layer.geojson.type === 'FeatureCollection'
        ? layer.geojson.features || [] : layer.geojson.type === 'Feature' ? [layer.geojson] : [];
      features.forEach((f: any) => {
        if (f.geometry?.type === 'Point' && f.geometry.coordinates) {
          allCoords.push([f.geometry.coordinates[1], f.geometry.coordinates[0]]);
        }
      });
    });
    tasks.forEach(t => allCoords.push([t.latitude, t.longitude]));

    if (allCoords.length > 0) {
      runJS(`window.mapBridge.fitBounds(${JSON.stringify(allCoords)})`);
    }
  }, [fitToContentKey, runJS]);

  useEffect(() => {
    if (!mapReadyRef.current) return;
    if (tasks.length > 0) {
      const coords: [number, number][] = tasks.map(t => [t.latitude, t.longitude]);
      if (userLocation) coords.push([userLocation.latitude, userLocation.longitude]);
      runJS(`window.mapBridge.fitBounds(${JSON.stringify(coords)})`);
    } else if (userLocation) {
      runJS(`window.mapBridge.flyTo(${userLocation.latitude}, ${userLocation.longitude}, 14, '')`);
    }
  }, [tasks.length > 0, userLocation != null]);

  const htmlContent = useMemo(() => generateLeafletHTML(), []);

  const iframeSrcDoc = useMemo(() => htmlContent, [htmlContent]);

  const handleIframeLoad = useCallback(() => {
  }, []);

  const renderMap = () => {
    if (isWeb) {
      return (
        <iframe
          ref={iframeRef as any}
          srcDoc={iframeSrcDoc}
          style={{ width: '100%', height: '100%', border: 'none' } as any}
          onLoad={handleIframeLoad}
        />
      );
    }
    if (!WebView) return null;
    return (
      <WebView
        ref={webViewRef}
        source={{ html: htmlContent }}
        style={styles.webview}
        onMessage={handleMessage}
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={['*']}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        allowsInlineMediaPlayback
        mixedContentMode="always"
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
                  <Text style={styles.controllerZoneBadgeText}>{selectedAsset.zoneCount} zones</Text>
                </View>
              )}
              <View style={styles.assetBtnRow}>
                {onShowControllerZones && selectedAsset.featureRef && (
                  <TouchableOpacity
                    style={[styles.assetDetailBtn, styles.showControllerBtn]}
                    onPress={() => onShowControllerZones(selectedAsset.featureRef!)}
                  >
                    <Ionicons name="map-outline" size={16} color="#0C1D31" />
                    <Text style={styles.showControllerBtnText}>Show Zones</Text>
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
                </View>
              )}
              <View style={styles.assetBtnRow}>
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
          )}
        </View>
      )}
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
  assetPopup: {
    position: 'absolute',
    bottom: 50,
    left: 12,
    right: 12,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
  },
  assetPopupHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  assetPopupLabel: { fontSize: 16, fontWeight: '700', color: '#0C1D31' },
  assetPopupType: { fontSize: 12, color: '#888', marginTop: 2 },
  zoneSubHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  controllerDotInline: { width: 10, height: 10, borderRadius: 5 },
  zoneControllerText: { fontSize: 13, color: '#666', fontWeight: '500' },
  zoneDetailsRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  zoneDetailChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#f0faf8', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  zoneDetailChipText: { fontSize: 12, color: '#0C1D31', fontWeight: '500' },
  assetProps: { marginBottom: 10, gap: 4 },
  assetPropRow: { flexDirection: 'row', gap: 8 },
  assetPropKey: { fontSize: 12, color: '#888', fontWeight: '500' },
  assetPropVal: { fontSize: 12, color: '#333', flex: 1 },
  assetBtnRow: { flexDirection: 'row', gap: 8 },
  assetDetailBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 4, backgroundColor: '#25C1AC', borderRadius: 10, paddingVertical: 10,
  },
  assetDetailBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  assetHistoryBtn: { backgroundColor: '#0C1D31' },
  showControllerBtn: { backgroundColor: '#f0f0f0' },
  showControllerBtnText: { color: '#0C1D31', fontSize: 13, fontWeight: '600' },
  controllerPopupTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  controllerDotLarge: { width: 14, height: 14, borderRadius: 7 },
  controllerZoneBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#f0faf8', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6, marginBottom: 10,
    alignSelf: 'flex-start',
  },
  controllerZoneBadgeText: { fontSize: 13, color: '#0C1D31', fontWeight: '500' },
});
