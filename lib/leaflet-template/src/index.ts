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

/**
 * Canonical controller color palette — single source of truth for both
 * the KML irrigation parser (auto-assignment during import) and the
 * Map Creator workflow (auto-assignment when a new Controller is created).
 * 15 distinct colors; palette wraps round-robin for communities with 15+
 * controllers. Keys continue A→Z→AA→AB… regardless of the palette size.
 */
export const CONTROLLER_COLORS: string[] = [
  "#ffa726", "#42a5f5", "#66bb6a", "#ef5350", "#ab47bc",
  "#26c6da", "#ffca28", "#8d6e63", "#78909c", "#ec407a",
  "#7e57c2", "#26a69a", "#d4e157", "#ff7043", "#5c6bc0",
];

export const LEAFLET_MAP_HTML = `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
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
    width: 26px; height: 26px; border-radius: 4px;
    border: 2px solid #fff; color: #fff; font-size: 12px;
    font-weight: 700; box-shadow: 0 2px 6px rgba(0,0,0,0.35);
    text-shadow: 0 1px 1px rgba(0,0,0,0.3);
  }
  .zone-ring {
    width: 16px; height: 16px; border-radius: 50%;
    border: 3px solid #fff; background: transparent;
    box-shadow: 0 1px 3px rgba(0,0,0,0.25);
  }
  .zone-ring--multi {
    width: 24px; height: 24px; border-radius: 50%;
    border: 2px solid #fff; background: transparent;
    box-shadow: 0 1px 4px rgba(0,0,0,0.3);
    display: flex; align-items: center; justify-content: center;
  }
  .zone-ring-badge {
    font-size: 10px; font-weight: 700; color: #fff;
    text-shadow: 0 1px 1px rgba(0,0,0,0.4);
    line-height: 1;
  }
  .popup-zone-row { margin: 4px 0 2px; }
  .popup-zone-label { font-size: 12px; font-weight: 600; color: #0C1D31; }
  .popup-zone-type { font-size: 11px; color: #7a8a9e; margin-left: 3px; }
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
  .paw-marker {
    display: flex; align-items: center; justify-content: center;
    width: 20px; height: 20px; border-radius: 50%;
    border: 2px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.3);
  }
  .paw-marker svg { width: 11px; height: 11px; display: block; }
  .marker-cluster-small, .marker-cluster-medium, .marker-cluster-large {
    background: rgba(37,193,172,0.3) !important;
  }
  .marker-cluster-small div, .marker-cluster-medium div, .marker-cluster-large div {
    background: #25C1AC !important; color: #fff !important;
    font-weight: 700 !important;
  }
  .pending-pin {
    width: 14px; height: 14px; border-radius: 50%;
    background: #fbbf24;
    border: 2px dashed #d97706;
    box-shadow: 0 1px 4px rgba(251,191,36,0.4);
    animation: pending-pulse 1.5s ease-in-out infinite;
  }
  .pending-pin-failed {
    width: 14px; height: 14px; border-radius: 50%;
    background: #fca5a5;
    border: 2px dashed #ef4444;
    box-shadow: 0 1px 4px rgba(239,68,68,0.4);
  }
  @keyframes pending-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.55; }
  }
  .reshoot-ring {
    width: 28px; height: 28px; border-radius: 50%;
    border: 3px solid #ea580c;
    background: rgba(234,88,12,0.18);
    box-shadow: 0 0 14px rgba(234,88,12,0.55);
    animation: reshoot-ring-pulse 1.15s ease-in-out infinite;
  }
  @keyframes reshoot-ring-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
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
    maxZoom: 23
  }).setView([39.8283, -98.5795], 4);

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  // Timestamp of the most recent direct feature tap — used to suppress the
  // generic 'mapTap' post that would otherwise follow a bubbled feature click.
  var lastFeatureTap = 0;
  map.on('click', function () {
    if (Date.now() - lastFeatureTap < 400) return;
    post('mapTap', {});
  });

  // ── Basemap config ─────────────────────────────────────────────────────────
  // Provider: Mapbox — two tokens in use:
  //   __MAPBOX_TOKEN__ is replaced at serve time by the web portal (MAPBOX_TOKEN env,
  //   URL-restricted to vrtsync.com and Replit preview domains).
  //   For the mobile WebView, LeafletMap.tsx substitutes EXPO_PUBLIC_MAPBOX_TOKEN
  //   (unrestricted) before setting source.html — a URL-restricted token would be
  //   silently rejected because WebView sends no usable referrer/origin header.
  // Offline packs: no bundled/cached tiles are currently present. Leaflet uses the
  //   browser HTTP cache; RN WebView tile cache is disabled (cacheEnabled={false}),
  //   so no provider-change tile-cache migration is needed.
  var BASEMAPS = {
    street: {
      url: 'https://api.mapbox.com/styles/v1/mapbox/light-v11/tiles/{z}/{x}/{y}?access_token=__MAPBOX_TOKEN__',
      tileSize: 512,
      zoomOffset: -1,
      maxNativeZoom: 22,
      maxZoom: 23,
      attribution: '\u00a9 <a href="https://www.mapbox.com/about/maps/">Mapbox</a> \u00a9 <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors <a href="https://www.mapbox.com/map-feedback/">Improve this map</a>'
    },
    satellite: {
      url: 'https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/{z}/{x}/{y}?access_token=__MAPBOX_TOKEN__',
      tileSize: 512,
      zoomOffset: -1,
      maxNativeZoom: 22,
      maxZoom: 23,
      attribution: '\u00a9 <a href="https://www.mapbox.com/about/maps/">Mapbox</a> \u00a9 <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors <a href="https://www.mapbox.com/map-feedback/">Improve this map</a>'
    }
  };

  var streetLayer = L.tileLayer(BASEMAPS.street.url, {
    tileSize: BASEMAPS.street.tileSize,
    zoomOffset: BASEMAPS.street.zoomOffset,
    maxNativeZoom: BASEMAPS.street.maxNativeZoom,
    maxZoom: BASEMAPS.street.maxZoom,
    attribution: BASEMAPS.street.attribution
  });
  var satelliteLayer = L.tileLayer(BASEMAPS.satellite.url, {
    tileSize: BASEMAPS.satellite.tileSize,
    zoomOffset: BASEMAPS.satellite.zoomOffset,
    maxNativeZoom: BASEMAPS.satellite.maxNativeZoom,
    maxZoom: BASEMAPS.satellite.maxZoom,
    attribution: BASEMAPS.satellite.attribution
  });
  streetLayer.addTo(map);

  var geoLayers = {};
  var layerCache = {};
  var communityBounds = null;
  var taskLayer = L.layerGroup().addTo(map);
  var ctrlLayer = L.layerGroup();
  var pendingPinsLayer = L.layerGroup().addTo(map);
  var controllerClusterGroups = {};
  var _zonesVisible = false;
  var userLocMarker = null;
  var targetMarker = null;
  var mapTapEnabled = false;

  map.on('click', function(e) {
    if (mapTapEnabled) {
      post('mapTap', { latitude: e.latlng.lat, longitude: e.latlng.lng });
    }
  });

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

  function makeClusterGroup(color) {
    return L.markerClusterGroup({
      maxClusterRadius: 40,
      disableClusteringAtZoom: 17,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      iconCreateFunction: function(cluster) {
        var count = cluster.getChildCount();
        var size = count < 10 ? 30 : count < 50 ? 36 : 42;
        return L.divIcon({
          html: '<div class="cluster-badge" style="width:'+size+'px;height:'+size+'px;background:'+color+';">'+count+'</div>',
          className: '',
          iconSize: [size, size],
          iconAnchor: [size/2, size/2]
        });
      }
    });
  }

  function getOrCreateClusterGroup(controllerId, color) {
    if (!controllerClusterGroups[controllerId]) {
      controllerClusterGroups[controllerId] = makeClusterGroup(color || '#6b7280');
    }
    return controllerClusterGroups[controllerId];
  }

  function clearAllClusterGroups() {
    Object.keys(controllerClusterGroups).forEach(function(id) {
      map.removeLayer(controllerClusterGroups[id]);
    });
    controllerClusterGroups = {};
  }

  window.mapBridge = {
    setUserLocation: function(lat, lng) {
      if (userLocMarker) map.removeLayer(userLocMarker);
      userLocMarker = L.marker([lat, lng], {
        icon: L.divIcon({ html: '<div class="user-loc"></div>', className: '', iconSize: [14,14], iconAnchor: [7,7] }),
        zIndex: 1000
      }).addTo(map);
    },

    // Draws an accuracy halo circle around the user's position.
    // color should be one of: '#4CAF50' (green), '#FFC107' (yellow), '#F44336' (red).
    // Replaces any previous halo; does not affect the blue user-loc dot.
    setUserLocationHalo: function(lat, lng, accuracyMetres, color) {
      if (this._haloCircle) { map.removeLayer(this._haloCircle); this._haloCircle = null; }
      var c = color || '#4CAF50';
      this._haloCircle = L.circle([lat, lng], {
        radius: accuracyMetres,
        color: c,
        fillColor: c,
        fillOpacity: 0.12,
        weight: 2,
        opacity: 0.55,
        interactive: false
      }).addTo(map);
    },

    clearUserLocationHalo: function() {
      if (this._haloCircle) { map.removeLayer(this._haloCircle); this._haloCircle = null; }
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
        m._taskId = t.id;
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
            return { color: c, weight: 2, fillColor: c, fillOpacity: 0.35, opacity: 0.9 };
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
            if (layer.subLayerKey === 'pet_station') {
              var pawSvg = '<svg viewBox="0 0 24 24" fill="#fff" xmlns="http://www.w3.org/2000/svg">'
                + '<ellipse cx="12" cy="15.5" rx="4.5" ry="3.5"/>'
                + '<ellipse cx="7" cy="11" rx="2" ry="2.6"/>'
                + '<ellipse cx="17" cy="11" rx="2" ry="2.6"/>'
                + '<ellipse cx="9.5" cy="7.5" rx="1.6" ry="2"/>'
                + '<ellipse cx="14.5" cy="7.5" rx="1.6" ry="2"/>'
                + '</svg>';
              return L.marker(latlng, {
                icon: L.divIcon({
                  className: '',
                  html: '<div class="paw-marker" style="background:' + c + ';">' + pawSvg + '</div>',
                  iconSize: [20, 20],
                  iconAnchor: [10, 10],
                  popupAnchor: [0, -12]
                })
              });
            }
            return L.circleMarker(latlng, {
              radius: 6, fillColor: c, fillOpacity: 0.7,
              color: '#fff', weight: 2
            });
          },
          onEachFeature: function(feature, l) {
            var props = feature.properties || {};
            var ref = (feature.id != null && feature.id !== '' ? String(feature.id) : null) || props.featureId || props.id || props.featureRef || props.name;
            var label = props.label || props.name || props.displayName || props.title || (layer.displayName + (ref ? ' - ' + ref : ''));
            var assetType = props.assetType || layer.subLayerKey || layer.layerKey;
            if (layer.directTap && ref) {
              // Preview mode: tap a feature → immediately post viewAssetDetail,
              // no popup. Record the tap so the generic mapTap is suppressed.
              l.on('click', function(ev) {
                lastFeatureTap = Date.now();
                if (ev.originalEvent) L.DomEvent.stopPropagation(ev.originalEvent);
                window.mapBridge._viewDetail(ref, layer.layerKey, label, assetType, layer.displayName || '');
              });
              return;
            }
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
            className: '', iconSize: [26,26], iconAnchor: [13,13]
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
      clearAllClusterGroups();
      markers.forEach(function(z) {
        var zones = z.zones && z.zones.length > 0 ? z.zones : null;
        var isMulti = zones && zones.length > 1;

        var iconHtml, iconSize, iconAnchor;
        if (isMulti) {
          iconSize   = [24, 24];
          iconAnchor = [12, 12];
          iconHtml   = '<div class="zone-ring zone-ring--multi" style="background:'+escHtml(z.controllerColor)+';"><span class="zone-ring-badge">'+zones.length+'</span></div>';
        } else {
          iconSize   = [16, 16];
          iconAnchor = [8, 8];
          iconHtml   = '<div class="zone-ring" style="background:'+z.controllerColor+';"></div>';
        }

        var m = L.marker([z.latitude, z.longitude], {
          icon: L.divIcon({
            html: iconHtml,
            className: '', iconSize: iconSize, iconAnchor: iconAnchor
          })
        });

        var popupHtml;
        if (isMulti) {
          popupHtml  = '<div class="popup-card"><div class="popup-bar" style="background:'+escHtml(z.controllerColor)+';"></div><div class="popup-body">';
          popupHtml += '<span class="popup-type" style="background:'+escHtml(z.controllerColor)+';">Valve Box · '+zones.length+' Zones</span>';
          if (z.boxLabel) {
            popupHtml += '<div class="popup-title">'+escHtml(z.boxLabel)+'</div>';
          }
          zones.forEach(function(zone, idx) {
            var zoneColor = zone.controllerColor || z.controllerColor;
            popupHtml += '<div class="popup-divider"></div>';
            popupHtml += '<div class="popup-zone-row"><div class="popup-meta-row"><span class="popup-meta-icon" style="background:'+escHtml(zoneColor)+';"></span>';
            popupHtml += '<span class="popup-zone-label">Zone'+(zone.zoneNumber ? ' #'+zone.zoneNumber : '')+'</span>';
            if (zone.zoneType) { popupHtml += '<span class="popup-zone-type">'+escHtml(zone.zoneType)+'</span>'; }
            popupHtml += '</div></div>';
            popupHtml += '<div class="popup-action" data-action="viewDetail" data-ref="'+escHtml(zone.featureRef)+'" data-layer="irrigation" data-label="'+escHtml(zone.label)+'" data-asset-type="zone" data-layer-name="'+escHtml(zone.controllerLabel || '')+'"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg> '+escHtml(zone.label)+'</div>';
          });
          if (z.mixedController) {
            popupHtml += '<div class="popup-divider"></div>';
            popupHtml += '<div style="font-size:11px;color:#e67e22;padding:4px 0;">&#9888; Multiple controllers — please review</div>';
          }
          popupHtml += '</div></div>';
        } else {
          // Single zone — existing rendering path, byte-identical behaviour
          popupHtml  = '<div class="popup-card"><div class="popup-bar" style="background:'+z.controllerColor+';"></div><div class="popup-body">';
          popupHtml += '<span class="popup-type" style="background:'+z.controllerColor+';">Zone' + (z.zoneNumber ? ' #' + z.zoneNumber : '') + '</span>';
          popupHtml += '<div class="popup-title">' + escHtml(z.label) + '</div>';
          popupHtml += '<div class="popup-meta"><div class="popup-meta-row"><span class="popup-meta-icon" style="background:'+z.controllerColor+';"></span> ' + escHtml(z.controllerLabel) + '</div></div>';
          popupHtml += '<div class="popup-divider"></div>';
          popupHtml += '<div class="popup-action" data-action="viewDetail" data-ref="'+escHtml(z.featureRef)+'" data-layer="irrigation" data-label="'+escHtml(z.label)+'" data-asset-type="zone" data-layer-name="'+escHtml(z.controllerLabel || '')+'"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg> View Details</div>';
          popupHtml += '</div></div>';
        }

        m.bindPopup(popupHtml, { closeButton: true, minWidth: 180 });
        var group = getOrCreateClusterGroup(z.controllerFeatureRef || z.controllerKey || z.controllerColor, z.controllerColor);
        group.addLayer(m);
      });
      // If zones were visible before the reset, re-add all newly created groups now.
      if (_zonesVisible) {
        Object.keys(controllerClusterGroups).forEach(function(id) {
          var cg = controllerClusterGroups[id];
          if (!map.hasLayer(cg)) map.addLayer(cg);
        });
      }
    },

    clearIrrigation: function() {
      clearGroup(ctrlLayer);
      clearAllClusterGroups();
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
      Object.keys(controllerClusterGroups).forEach(function(id) {
        var cg = controllerClusterGroups[id];
        if (map.hasLayer(cg)) {
          cg.eachLayer(function(m) {
            var ll = m.getLatLng();
            if (ll) {
              bounds = bounds ? bounds.extend(ll) : L.latLngBounds(ll, ll);
            }
          });
        }
      });
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
      _zonesVisible = !!show;
      Object.keys(controllerClusterGroups).forEach(function(id) {
        var cg = controllerClusterGroups[id];
        if (show) { if (!map.hasLayer(cg)) map.addLayer(cg); }
        else { if (map.hasLayer(cg)) map.removeLayer(cg); }
      });
    },

    // Enable/disable all map interaction handlers and hide the zoom control.
    // Used by preview surfaces (dashboard portfolio map) that must not hijack
    // page scroll or offer zoom/pan.
    setInteractive: function(on) {
      var handlers = [map.dragging, map.scrollWheelZoom, map.doubleClickZoom, map.boxZoom, map.keyboard, map.touchZoom];
      handlers.forEach(function(h) { if (h) { if (on) { h.enable(); } else { h.disable(); } } });
      var zc = document.querySelector('.leaflet-control-zoom');
      if (zc) zc.style.display = on ? '' : 'none';
    },

    setSatellite: function(on) {
      if (on) {
        if (map.hasLayer(streetLayer)) map.removeLayer(streetLayer);
        if (!map.hasLayer(satelliteLayer)) satelliteLayer.addTo(map);
      } else {
        if (map.hasLayer(satelliteLayer)) map.removeLayer(satelliteLayer);
        if (!map.hasLayer(streetLayer)) streetLayer.addTo(map);
      }
    },

    setCommunityOutline: function(geojson, style) {
      if (this._outlineLayer) {
        map.removeLayer(this._outlineLayer);
        this._outlineLayer = null;
      }
      if (!geojson) return;
      var s = style || {};
      var strokeColor = s.strokeColor || '#0C1D31';
      var strokeWeight = typeof s.strokeWeight === 'number' ? s.strokeWeight : 3;
      var fillOpacity = typeof s.fillOpacity === 'number' ? s.fillOpacity : 0.08;
      this._outlineLayer = L.geoJSON(geojson, {
        style: function() {
          return {
            color: strokeColor,
            weight: strokeWeight,
            fillColor: strokeColor,
            fillOpacity: fillOpacity,
            opacity: 0.9,
            dashArray: null
          };
        },
        interactive: false
      });
      this._outlineLayer.addTo(map);
      this._outlineLayer.bringToBack();
    },

    fitToOutline: function() {
      if (this._outlineLayer) {
        try {
          var b = this._outlineLayer.getBounds();
          if (b && b.isValid()) {
            communityBounds = b;
            map.fitBounds(b, { padding: [32, 32] });
            return;
          }
        } catch(e) {}
      }
      if (communityBounds && communityBounds.isValid()) {
        map.fitBounds(communityBounds, { padding: [32, 32] });
      }
    },

    /**
     * Compute and store communityBounds from the supplied GeoJSON without
     * moving the viewport.  Call this before fitToContent when outline geometry
     * is the only fallback available (e.g. all service sub-layers are unchecked
     * or have no geometry), so fitToContent can use the outline bounds as its
     * fallback rather than leaving the map at the default zoom level.
     */
    setOutlineBounds: function(geojson) {
      if (!geojson) return;
      try {
        var tmpLayer = L.geoJSON(geojson);
        var b = tmpLayer.getBounds();
        if (b && b.isValid()) { communityBounds = b; }
      } catch(e) {}
    },

    updateLayerColor: function(layerId, newColor) {
      var geoLayer = layerCache[layerId];
      if (!geoLayer) return;
      geoLayer.eachLayer(function(l) {
        if (l.setStyle) {
          l.setStyle({ color: newColor, fillColor: newColor });
        }
        if (l.setIcon && l._iconOpts) {
          l._iconOpts.color = newColor;
          l.setIcon(L.divIcon(l._iconOpts));
        }
      });
    },

    filterTasks: function(taskIds) {
      taskLayer.eachLayer(function(m) {
        var marker = m;
        if (!marker._taskId) return;
        var isMatch = !taskIds || taskIds.length === 0 || taskIds.indexOf(marker._taskId) !== -1;
        var el = marker.getElement ? marker.getElement() : null;
        if (el) {
          el.style.opacity = isMatch ? '1' : '0.15';
        }
      });
      if (taskIds && taskIds.length > 0) {
        var bounds = null;
        taskLayer.eachLayer(function(m) {
          var marker = m;
          if (!marker._taskId) return;
          if (taskIds.indexOf(marker._taskId) !== -1) {
            var ll = marker.getLatLng ? marker.getLatLng() : null;
            if (ll) {
              bounds = bounds ? bounds.extend(ll) : L.latLngBounds(ll, ll);
            }
          }
        });
        if (bounds && bounds.isValid()) {
          map.fitBounds(bounds, { padding: [80, 60], maxZoom: 17 });
        }
      }
    },

    clearTaskFilter: function() {
      taskLayer.eachLayer(function(m) {
        var marker = m;
        var el = marker.getElement ? marker.getElement() : null;
        if (el) {
          el.style.opacity = '1';
        }
      });
    },

    setPendingPins: function(pins) {
      clearGroup(pendingPinsLayer);
      (pins || []).forEach(function(p) {
        if (p.latitude == null || p.longitude == null) return;
        var isFailed = p.state === 'failed';
        var cls = isFailed ? 'pending-pin-failed' : 'pending-pin';
        var color = isFailed ? '#ef4444' : '#fbbf24';
        var m = L.marker([p.latitude, p.longitude], {
          icon: L.divIcon({
            html: '<div class="' + cls + '"></div>',
            className: '',
            iconSize: [14, 14],
            iconAnchor: [7, 7]
          }),
          zIndex: 200
        });
        var stateLabel = isFailed
          ? 'Failed \u2014 tap Retry in the sync panel'
          : 'Pending \u2014 will sync when online';
        var popupHtml = '<div class="popup-card"><div class="popup-bar" style="background:' + color + ';"></div><div class="popup-body">';
        popupHtml += '<span class="popup-type" style="background:' + color + ';">' + escHtml(p.assetType || 'pin') + '</span>';
        popupHtml += '<div class="popup-title">' + escHtml(p.label) + '</div>';
        popupHtml += '<div class="popup-meta">' + stateLabel + '</div>';
        popupHtml += '</div></div>';
        m.bindPopup(popupHtml, { closeButton: true, minWidth: 180 });
        m.addTo(pendingPinsLayer);
      });
    },

    enableMapTap: function() {
      mapTapEnabled = true;
      map.getContainer().style.cursor = 'crosshair';
    },

    disableMapTap: function() {
      mapTapEnabled = false;
      map.getContainer().style.cursor = '';
    },

    updateLayerColorMap: function(layerId, colorMap, fallbackColor) {
      var geoLayer = layerCache[layerId];
      if (!geoLayer) return;
      geoLayer.eachLayer(function(l) {
        var feature = l.feature;
        if (!feature) return;
        var props = feature.properties || {};
        var c = fallbackColor;
        if (props.controllerFeatureRef) {
          c = colorMap[props.controllerFeatureRef] || fallbackColor;
        } else if (props.featureId || feature.id) {
          var fid = props.featureId || feature.id;
          c = colorMap[fid] || fallbackColor;
        }
        if (l.setStyle) {
          l.setStyle({ color: c, fillColor: c });
        }
      });
    },

    setReshootHighlight: function(lat, lng) {
      if (this._reshootMarker) { map.removeLayer(this._reshootMarker); this._reshootMarker = null; }
      this._reshootMarker = L.marker([lat, lng], {
        icon: L.divIcon({
          html: '<div class="reshoot-ring"></div>',
          className: '',
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        }),
        zIndexOffset: 1200,
        interactive: false
      }).addTo(map);
    },

    clearReshootHighlight: function() {
      if (this._reshootMarker) { map.removeLayer(this._reshootMarker); this._reshootMarker = null; }
    },

    setAccuracyRing: function(lat, lng, accuracyM, color) {
      if (this._accuracyRingCircle) { map.removeLayer(this._accuracyRingCircle); this._accuracyRingCircle = null; }
      if (this._accuracyRingTimer) { clearTimeout(this._accuracyRingTimer); this._accuracyRingTimer = null; }
      var c = color || '#22c55e';
      var state = { outer: 0.72, fill: 0.16 };
      this._accuracyRingCircle = L.circle([lat, lng], {
        radius: accuracyM,
        color: c, fillColor: c,
        fillOpacity: state.fill, weight: 2, opacity: state.outer, interactive: false
      }).addTo(map);
      var self = this;
      var step = function() {
        state.outer -= 0.036;
        state.fill -= 0.008;
        if (state.outer <= 0 || !self._accuracyRingCircle) {
          if (self._accuracyRingCircle) { map.removeLayer(self._accuracyRingCircle); self._accuracyRingCircle = null; }
          self._accuracyRingTimer = null;
          return;
        }
        self._accuracyRingCircle.setStyle({ opacity: state.outer, fillOpacity: state.fill });
        self._accuracyRingTimer = setTimeout(step, 150);
      };
      self._accuracyRingTimer = setTimeout(step, 150);
    },

    clearAccuracyRing: function() {
      if (this._accuracyRingCircle) { map.removeLayer(this._accuracyRingCircle); this._accuracyRingCircle = null; }
      if (this._accuracyRingTimer) { clearTimeout(this._accuracyRingTimer); this._accuracyRingTimer = null; }
    },

    // Called by the parent frame after moving this iframe to a new DOM slot so
    // that Leaflet recalculates its container dimensions and renders correctly.
    invalidateSize: function() {
      map.invalidateSize();
    }
  };

  function escHtml(s) {
    if (!s && s !== 0) return '';
    s = String(s);
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'cmd' && e.data.fn) {
      try {
        var fn = window.mapBridge[e.data.fn];
        if (typeof fn === 'function') {
          fn.apply(window.mapBridge, e.data.args || []);
        }
      } catch(ex) { console.error(ex); }
    }
  });

  setTimeout(function() { map.invalidateSize(); }, 100);
  setTimeout(function() { map.invalidateSize(); }, 500);
  setTimeout(function() { map.invalidateSize(); }, 1500);

  function handlePopupActionClick(e) {
    var el = e.target || e.srcElement;
    while (el && el !== document.body) {
      if (el.classList && el.classList.contains('popup-action') && el.dataset && el.dataset.action) {
        var action = el.dataset.action;
        if (action === 'taskTap') {
          window.mapBridge._taskTap(el.dataset.id);
        } else if (action === 'viewDetail') {
          window.mapBridge._viewDetail(el.dataset.ref, el.dataset.layer, el.dataset.label, el.dataset.assetType, el.dataset.layerName);
        }
        if (e.preventDefault) e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
        return;
      }
      el = el.parentElement;
    }
  }

  map.on('popupopen', function(ev) {
    var popupEl = ev.popup.getElement();
    if (popupEl) {
      L.DomEvent.on(popupEl, 'click', handlePopupActionClick);
      // Emit markerSelect immediately when a feature popup opens so that
      // parent frames can respond to the first pin click rather than waiting
      // for the popup-action button.  Existing pages that don't listen for
      // this message type are unaffected.  The mobile app receives and ignores
      // unknown message types, so behaviour there is also unchanged.
      // NOTE: this code is inside an HTML template string — no TypeScript syntax.
      var actionEl = popupEl.querySelector('.popup-action[data-action="viewDetail"][data-ref]');
      if (actionEl) {
        var ds = actionEl.dataset;
        post('markerSelect', {
          featureRef: ds.ref       || '',
          layerKey:   ds.layer     || '',
          label:      ds.label     || '',
          assetType:  ds.assetType || '',
          layerName:  ds.layerName || '',
        });
      }
    }
  });

  map.on('popupclose', function(ev) {
    var popupEl = ev.popup.getElement();
    if (popupEl) {
      L.DomEvent.off(popupEl, 'click', handlePopupActionClick);
    }
  });

  post('mapReady', {});
  var _readyRetries = [100, 300, 800, 1500, 3000, 5000];
  _readyRetries.forEach(function(delay) {
    setTimeout(function() { post('mapReady', {}); }, delay);
  });
})();
</script>
</body>
</html>`;
