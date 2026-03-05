import React, { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getApiUrl } from '@/lib/query-client';

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
    border-radius: 12px; padding: 0;
    box-shadow: 0 6px 20px rgba(0,0,0,0.18);
    overflow: hidden;
  }
  .leaflet-popup-content { margin: 0 !important; font-family: -apple-system, system-ui, sans-serif; width: auto !important; }
  .leaflet-popup-tip { box-shadow: 0 3px 8px rgba(0,0,0,0.1); }
  .popup-card { display: flex; flex-direction: row; min-width: 180px; }
  .popup-bar { width: 5px; flex-shrink: 0; border-radius: 3px 0 0 3px; }
  .popup-body { padding: 10px 14px 10px 11px; flex: 1; }
  .popup-type { display: inline-block; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #fff; padding: 2px 7px; border-radius: 4px; margin-bottom: 5px; }
  .popup-title { font-weight: 700; font-size: 14px; color: #0C1D31; line-height: 1.3; margin-bottom: 3px; }
  .popup-meta { font-size: 11px; color: #7a8a9e; margin-top: 0; line-height: 1.4; }
  .popup-meta-row { display: flex; align-items: center; gap: 4px; margin-top: 2px; }
  .popup-meta-icon { width: 12px; height: 12px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
  .popup-divider { height: 1px; background: #eef1f5; margin: 8px 0 6px; }
  .popup-action { display: flex; align-items: center; justify-content: center; gap: 4px; font-size: 12px; color: #25C1AC; font-weight: 600; cursor: pointer; padding: 5px 0 2px; transition: color 0.15s; }
  .popup-action:hover { color: #1da894; }
  .popup-action svg { width: 14px; height: 14px; }
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
  var communityBounds = null;
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
        var popupHtml = '<div class="popup-card"><div class="popup-bar" style="background:'+color+';"></div><div class="popup-body">';
        popupHtml += '<span class="popup-type" style="background:'+color+';">Task</span>';
        popupHtml += '<div class="popup-title">'+escHtml(t.title)+'</div>';
        if (t.address) popupHtml += '<div class="popup-meta">'+escHtml(t.address)+'</div>';
        popupHtml += '<div class="popup-divider"></div>';
        popupHtml += '<div class="popup-action" data-action="taskTap" data-id="'+escHtml(t.id)+'"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg> View Details</div>';
        popupHtml += '</div></div>';
        m.bindPopup(popupHtml, { closeButton: true, minWidth: 180 });
        m.addTo(taskLayer);
      });
    },

    _taskTap: function(id) {
      post('taskPress', { id: id });
    },

    _viewDetail: function(ref, layerKey, label, assetType, layerName) {
      post('viewAssetDetail', { featureRef: ref, layerKey: layerKey, label: label || '', assetType: assetType || '', layerName: layerName || '' });
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
            var props = feature.properties || {};
            var ref = props.featureRef || props.featureId || props.id || props.name;
            var label = props.label || props.name || props.displayName || props.title || (layer.displayName + (ref ? ' - ' + ref : ''));
            var assetType = props.assetType || layer.subLayerKey || layer.layerKey;
            var featureColor = layer.color || '#25C1AC';
            if (layer.subLayerKey === 'controller' && props) {
              var fid = props.featureId || feature.id;
              featureColor = (layer.controllerColorMap || {})[fid] || featureColor;
            }
            if (layer.subLayerKey === 'zone' && props && props.controllerFeatureRef) {
              featureColor = (layer.controllerColorMap || {})[props.controllerFeatureRef] || featureColor;
            }
            var popupHtml = '<div class="popup-card"><div class="popup-bar" style="background:'+featureColor+';"></div><div class="popup-body">';
            popupHtml += '<span class="popup-type" style="background:'+featureColor+';">' + escHtml(assetType) + '</span>';
            popupHtml += '<div class="popup-title">' + escHtml(label) + '</div>';
            if (layer.displayName && layer.displayName !== label) {
              popupHtml += '<div class="popup-meta">' + escHtml(layer.displayName) + '</div>';
            }
            if (ref) {
              popupHtml += '<div class="popup-divider"></div>';
              popupHtml += '<div class="popup-action" data-action="viewDetail" data-ref="'+escHtml(ref)+'" data-layer="'+escHtml(layer.layerKey)+'" data-label="'+escHtml(label)+'" data-asset-type="'+escHtml(assetType)+'" data-layer-name="'+escHtml(layer.displayName || '')+'"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg> View Details</div>';
            }
            popupHtml += '</div></div>';
            l.bindPopup(popupHtml, { closeButton: true, minWidth: 180 });
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
        var popupHtml = '<div class="popup-card"><div class="popup-bar" style="background:'+c.color+';"></div><div class="popup-body">';
        popupHtml += '<span class="popup-type" style="background:'+c.color+';">Controller</span>';
        popupHtml += '<div class="popup-title">' + escHtml(c.label) + '</div>';
        popupHtml += '<div class="popup-meta"><div class="popup-meta-row"><span class="popup-meta-icon" style="background:'+c.color+';"></span> ' + c.zoneCount + ' zone' + (c.zoneCount !== 1 ? 's' : '') + '</div></div>';
        popupHtml += '<div class="popup-divider"></div>';
        popupHtml += '<div class="popup-action" data-action="viewDetail" data-ref="'+escHtml(c.featureRef)+'" data-layer="irrigation" data-label="'+escHtml(c.label)+'" data-asset-type="controller" data-layer-name=""><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg> View Details</div>';
        popupHtml += '</div></div>';
        m.bindPopup(popupHtml, { closeButton: true, minWidth: 180 });
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
        var popupHtml = '<div class="popup-card"><div class="popup-bar" style="background:'+z.controllerColor+';"></div><div class="popup-body">';
        popupHtml += '<span class="popup-type" style="background:'+z.controllerColor+';">Zone' + (z.zoneNumber ? ' #' + z.zoneNumber : '') + '</span>';
        popupHtml += '<div class="popup-title">' + escHtml(z.label) + '</div>';
        popupHtml += '<div class="popup-meta"><div class="popup-meta-row"><span class="popup-meta-icon" style="background:'+z.controllerColor+';"></span> ' + escHtml(z.controllerLabel) + '</div></div>';
        popupHtml += '<div class="popup-divider"></div>';
        popupHtml += '<div class="popup-action" data-action="viewDetail" data-ref="'+escHtml(z.featureRef)+'" data-layer="irrigation" data-label="'+escHtml(z.label)+'" data-asset-type="zone" data-layer-name="'+escHtml(z.controllerLabel || '')+'"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg> View Details</div>';
        popupHtml += '</div></div>';
        m.bindPopup(popupHtml, { closeButton: true, minWidth: 180 });
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
      communityBounds = bounds;
      map.fitBounds(bounds, { padding: [60, 40], maxZoom: 16 });
    },

    fitToContent: function(taskCoords, userLoc) {
      var bounds = null;
      Object.keys(geoLayers).forEach(function(k) {
        try {
          var lb = geoLayers[k].getBounds();
          if (lb && lb.isValid()) {
            bounds = bounds ? bounds.extend(lb) : L.latLngBounds(lb.getSouthWest(), lb.getNorthEast());
          }
        } catch(e) {}
      });
      if (map.hasLayer(ctrlLayer)) {
        ctrlLayer.eachLayer(function(m) {
          var ll = m.getLatLng();
          if (ll) {
            bounds = bounds ? bounds.extend(ll) : L.latLngBounds(ll, ll);
          }
        });
      }
      if (map.hasLayer(zoneClusterGroup)) {
        zoneClusterGroup.eachLayer(function(m) {
          var ll = m.getLatLng();
          if (ll) {
            bounds = bounds ? bounds.extend(ll) : L.latLngBounds(ll, ll);
          }
        });
      }
      if (taskCoords && taskCoords.length > 0) {
        taskCoords.forEach(function(c) {
          var ll = L.latLng(c[0], c[1]);
          bounds = bounds ? bounds.extend(ll) : L.latLngBounds(ll, ll);
        });
      }
      if (userLoc) {
        var ul = L.latLng(userLoc[0], userLoc[1]);
        bounds = bounds ? bounds.extend(ul) : L.latLngBounds(ul, ul);
      }
      if (bounds && bounds.isValid()) {
        map.fitBounds(bounds, { padding: [60, 40], maxZoom: 16 });
      } else if (communityBounds && communityBounds.isValid()) {
        map.fitBounds(communityBounds, { padding: [60, 40], maxZoom: 16 });
      }
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
    if (!s && s !== 0) return '';
    s = String(s);
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'eval' && e.data.code) {
      try { new Function(e.data.code)(); } catch(ex) { console.error(ex); }
    }
  });

  setTimeout(function() { map.invalidateSize(); }, 100);
  setTimeout(function() { map.invalidateSize(); }, 500);
  setTimeout(function() { map.invalidateSize(); }, 1500);

  document.addEventListener('click', function(e) {
    var el = e.target;
    while (el && el !== document.body) {
      if (el.classList && el.classList.contains('popup-action') && el.dataset && el.dataset.action) {
        var action = el.dataset.action;
        if (action === 'taskTap') {
          window.mapBridge._taskTap(el.dataset.id);
        } else if (action === 'viewDetail') {
          window.mapBridge._viewDetail(el.dataset.ref, el.dataset.layer, el.dataset.label, el.dataset.assetType, el.dataset.layerName);
        }
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      el = el.parentElement;
    }
  });

  post('mapReady', {});
  var _readyRetries = [100, 300, 800, 1500];
  _readyRetries.forEach(function(delay) {
    setTimeout(function() { post('mapReady', {}); }, delay);
  });
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

  const layerCoordsKey = useMemo(() => {
    return layers.filter(l => l.geojson).map(l => l.id).sort().join(',');
  }, [layers]);

  const initialFitDoneRef = useRef(false);

  useEffect(() => {
    if (initialFitDoneRef.current) return;
    const layersWithData = layers.filter(l => l.geojson);
    const layersPending = layers.length > 0 && layersWithData.length === 0;
    if (layersPending) return;
    if (layersWithData.length === 0 && tasks.length === 0) return;
    initialFitDoneRef.current = true;
    const taskCoords = tasks.map(t => [t.latitude, t.longitude] as [number, number]);
    const userLoc = userLocation ? [userLocation.latitude, userLocation.longitude] : null;
    const fitCmd = `window.mapBridge.fitToContent(${JSON.stringify(taskCoords)}, ${JSON.stringify(userLoc)})`;
    setTimeout(() => runJS(fitCmd), 300);
  }, [tasks, layerCoordsKey, layers.length, userLocation, runJS]);

  const htmlContent = useMemo(() => generateLeafletHTML(), []);

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
    const mapUrl = `${getApiUrl()}leaflet-map.html?v=${Date.now()}`;
    return (
      <WebView
        ref={webViewRef}
        source={{ uri: mapUrl }}
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
