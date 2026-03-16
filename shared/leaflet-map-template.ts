/**
 * CANONICAL LEAFLET MAP TEMPLATE — Single Source of Truth
 *
 * This file is the ONE place where all Leaflet map styling (CSS, marker shapes,
 * popup layout, cluster badges, controller/zone coloring) is defined.
 *
 * It is consumed by:
 *   • The Express server  — served at /leaflet-map.html for all web portal iframes
 *     (see server/index.ts)
 *   • The React Native app — used as inline HTML in the WebView and web iframe
 *     (see components/LeafletMap.tsx)
 *
 * To change map styling, colors, marker shapes, or popup layout, edit ONLY this
 * file. Both platforms will pick up the changes automatically.
 */

export const LEAFLET_MAP_HTML = `<!DOCTYPE html>
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
  var layerCache = {};
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

    addLayers: function(layers) {
      layers.forEach(function(layer) {
        if (!layer.geojson || layerCache[layer.id]) return;
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
        });
        layerCache[layer.id] = geoLayer;
      });
    },

    showLayerIds: function(ids) {
      Object.keys(geoLayers).forEach(function(k) {
        if (ids.indexOf(k) === -1) {
          map.removeLayer(geoLayers[k]);
          delete geoLayers[k];
        }
      });
      ids.forEach(function(id) {
        if (!geoLayers[id] && layerCache[id]) {
          layerCache[id].addTo(map);
          geoLayers[id] = layerCache[id];
        }
      });
    },

    setLayers: function(layers) {
      this.addLayers(layers);
      var ids = [];
      layers.forEach(function(layer) { if (layer.geojson) ids.push(layer.id); });
      this.showLayerIds(ids);
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
    },

    setCommunityOutline: function(geojson) {
      if (this._outlineLayer) {
        map.removeLayer(this._outlineLayer);
        this._outlineLayer = null;
      }
      if (!geojson) return;
      this._outlineLayer = L.geoJSON(geojson, {
        style: function() {
          return {
            color: '#0C1D31',
            weight: 3,
            fillColor: '#0C1D31',
            fillOpacity: 0.08,
            opacity: 0.9,
            dashArray: null
          };
        },
        interactive: false
      });
      this._outlineLayer.addTo(map);
      this._outlineLayer.bringToBack();
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
