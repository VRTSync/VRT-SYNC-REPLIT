/**
 * VRTMapRenderer — shared Leaflet map renderer for portal and portfolio surfaces.
 *
 * Usage:
 *   var renderer = window.VRTMapRenderer.create({
 *     iframe:    <HTMLIFrameElement>,
 *     adapter:   { fetchLayers, fetchLayerGeojson, fetchControllers, fetchBounds? },
 *     hierarchy: { [categoryKey]: [{ key, label, color }] }
 *   });
 *
 *   renderer.on('ready',    function(state) { ... });
 *   renderer.on('assetTap', function(data)  { ... });
 *   renderer.load(communityId);
 *
 * The adapter interface:
 *   fetchLayers(communityId)            → Promise<layer[]>
 *   fetchLayerGeojson(layerId)          → Promise<geojson|null>
 *   fetchControllers(communityId)       → Promise<controller[]>   (optional — pass null to skip)
 *   fetchBounds(communityId)            → Promise<{bounds}>       (optional — for initial fit)
 *
 * Public instance methods:
 *   load(communityId)                   → Promise<state>
 *   setActiveCategory(key)              — key=null → show ALL layers (summary mode)
 *   setVisibleSubLayers(stateForCat)    — { [subKey]: bool } for the current active category
 *   setSatellite(on)
 *   fit()
 *   invalidateSize()
 *   on(event, handler)                  — 'ready' | 'assetTap'
 *   applyColorLive(cat, subKey, color)
 *   getLayerEffectiveColor(cat, subKey)
 *   getControllerData()
 *   getMapLayers()
 *   getState()
 *   getSessionColorOverride(cat, subKey)
 *   setSessionColorOverride(cat, subKey, color)
 *   addCustomLayer(layerDef)            — for ad-hoc layers (branch pins, etc.)
 *   showCustomLayers(ids)               — show a set of custom layer IDs
 *   cmdToIframe(fn, ...args)            — escape hatch for non-rendering commands
 *   destroy()
 */
(function () {
  'use strict';

  // Hardcoded per-sublayer geometry colour defaults.
  // Used when map_layers.color is absent or invalid.
  var _SUBLAYER_DEFAULT_COLORS = {
    'bluegrass_area':   '#2E8B57',
    'native_area':      '#8F9779',
    'landscape_bed':    '#8B5A2B',
    'pet_station':      '#1ABC9C',
    'backflow':         '#00BFFF',
    'controller':       '#25C1AC',
    'zone':             '#3498db',
    'master_valve':     '#1F4E79',
    'flow_meter':       '#00CED1',
    'qc_iso_valve':     '#87CEEB',
    'isolation_valve':  '#F39C12',
    'quick_connect':    '#E67E22',
    'wire_splice':      '#9B59B6',
    'plow':             '#4A90E2',
    'atv':              '#6A5ACD',
    'hand_shovel':      '#E83E8C',
    'ice_melt':         '#FF8C00',
    'slicer':           '#D62828',
    'storage_area':     '#708090',
    'tree':             '#006400',
  };

  var _HEX_RE = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
  function _isValidHex(s) {
    return typeof s === 'string' && _HEX_RE.test(s.trim());
  }

  function create(opts) {
    var iframe    = opts.iframe;
    var adapter   = opts.adapter;
    var hierarchy = opts.hierarchy || {};

    // ── Internal state ──────────────────────────────────────────────────────
    var _iframeReady    = false;
    var _dataReady      = false;
    var _pending        = [];
    var _msgHandler     = null;
    var _mapLayers      = [];
    var _controllerData = [];
    var _populated      = {};
    var _sublayerState  = {};
    var _populatedCategories = [];
    var _activeCategory = 'community';
    var _suppressCtrlGeo  = false;
    var _suppressZoneGeo  = false;
    var _sessionOverrides = {};
    var _outlineGeojson   = null;
    var _outlineStyle     = null;
    var _addedLayerIds    = {};   // layerId → true
    var _hasApplied       = false; // true after the first _applyState fit
    var _layerColors      = {};   // layerId → hex
    var _events           = { ready: [], assetTap: [] };

    // ── iframe bridge ────────────────────────────────────────────────────────
    function _cmd(fn) {
      var args = Array.prototype.slice.call(arguments, 1);
      if (!iframe || !iframe.contentWindow) return;
      if (!_iframeReady) { _pending.push({ fn: fn, args: args }); return; }
      iframe.contentWindow.postMessage({ type: 'cmd', fn: fn, args: args }, '*');
    }

    function _setupHandler() {
      _msgHandler = function (e) {
        if (!e.data) return;
        var msg;
        if (typeof e.data === 'string') {
          try { msg = JSON.parse(e.data); } catch (_) { return; }
        } else {
          msg = e.data;
        }
        if (msg.type === 'mapReady') {
          if (!_iframeReady) {
            _iframeReady = true;
            var cmds = _pending.splice(0);
            cmds.forEach(function (c) {
              if (iframe && iframe.contentWindow) {
                iframe.contentWindow.postMessage({ type: 'cmd', fn: c.fn, args: c.args }, '*');
              }
            });
            if (_dataReady) _applyState();
          }
        } else if (msg.type === 'viewAssetDetail') {
          _emit('assetTap', msg.data);
        }
      };
      window.addEventListener('message', _msgHandler);
    }

    function _emit(event, data) {
      (_events[event] || []).forEach(function (h) { try { h(data); } catch (_) {} });
    }

    function _buildStateSnapshot() {
      return {
        hierarchy:            hierarchy,
        mapLayers:            _mapLayers,
        controllerData:       _controllerData,
        populated:            _populated,
        sublayerState:        _sublayerState,
        populatedCategories:  _populatedCategories,
        activeCategory:       _activeCategory,
        suppressControllerGeo: _suppressCtrlGeo,
        suppressZoneGeo:       _suppressZoneGeo,
        outlineGeojson:        _outlineGeojson,
        outlineStyle:          _outlineStyle,
      };
    }

    // ── Colour helpers ────────────────────────────────────────────────────────
    function _effectiveLayerColor(layer) {
      var raw = layer && layer.color;
      if (_isValidHex(raw)) return raw.trim();
      var subKey = layer && (layer.subLayerKey || layer.type);
      if (subKey && _SUBLAYER_DEFAULT_COLORS[subKey]) return _SUBLAYER_DEFAULT_COLORS[subKey];
      return '#888888';
    }

    function _getLayerEffectiveColor(cat, subKey) {
      var apiLayer = null;
      for (var i = 0; i < _mapLayers.length; i++) {
        if (_mapLayers[i].subLayerKey === subKey && _mapLayers[i].layerKey === cat) {
          apiLayer = _mapLayers[i]; break;
        }
      }
      if (apiLayer && apiLayer.color) return apiLayer.color;
      var subs = hierarchy[cat] || [];
      for (var j = 0; j < subs.length; j++) {
        if (subs[j].key === subKey) return subs[j].color || '#888888';
      }
      return _SUBLAYER_DEFAULT_COLORS[subKey] || '#888888';
    }

    function _getOverride(cat, subKey) {
      return _sessionOverrides[cat + '/' + subKey] || null;
    }
    function _setOverride(cat, subKey, color) {
      _sessionOverrides[cat + '/' + subKey] = color;
    }

    function _getStoredZoneColor() {
      for (var i = 0; i < _controllerData.length; i++) {
        var zones = _controllerData[i].zones || [];
        for (var j = 0; j < zones.length; j++) {
          if (zones[j].zoneColor) return zones[j].zoneColor;
        }
      }
      return null;
    }

    function _buildControllerColorMap(uniformOverride) {
      var colorMap = {};
      var fallback = _getLayerEffectiveColor('irrigation', 'controller');
      for (var i = 0; i < _controllerData.length; i++) {
        var ctrl = _controllerData[i];
        if (ctrl.featureRef) {
          colorMap[ctrl.featureRef] = uniformOverride !== null
            ? uniformOverride
            : (ctrl.controllerColor || fallback);
        }
      }
      return colorMap;
    }

    function _buildZoneColorMap(uniformColor) {
      var colorMap = {};
      for (var i = 0; i < _controllerData.length; i++) {
        var ctrl = _controllerData[i];
        if (ctrl.featureRef) colorMap[ctrl.featureRef] = uniformColor;
      }
      return colorMap;
    }

    // ── Irrigation marker sending ──────────────────────────────────────────────
    function _sendIrrigationMarkers(ctrlColorOverride, zoneColorOverride) {
      var fallbackCtrl = _getLayerEffectiveColor('irrigation', 'controller');

      var ctrlMarkers = [];
      for (var i = 0; i < _controllerData.length; i++) {
        var c = _controllerData[i];
        if (c.latitude == null || c.longitude == null) continue;
        var perCtrlColor = ctrlColorOverride !== null
          ? ctrlColorOverride
          : (c.controllerColor || fallbackCtrl);
        ctrlMarkers.push({
          id:            c.id,
          label:         c.label || c.controllerKey || 'Controller',
          featureRef:    c.featureRef,
          controllerKey: c.controllerKey || '',
          color:         perCtrlColor,
          latitude:      c.latitude,
          longitude:     c.longitude,
          zoneCount:     c.zoneCount || (c.zones ? c.zones.length : 0),
        });
      }

      // Group zones by valveBoxRef — one marker per physical valve box.
      // Zones without a valveBoxRef each form their own singleton group.
      var boxGroups = {}; // boxKey → { latitude, longitude, controllerColor, controllerFeatureRef, controllerKey, boxLabel, zones[] }
      var boxOrder  = []; // insertion-order keys for deterministic output

      for (var ii = 0; ii < _controllerData.length; ii++) {
        var ctrl = _controllerData[ii];
        var perCtrlColor2 = ctrlColorOverride !== null
          ? ctrlColorOverride
          : (ctrl.controllerColor || fallbackCtrl);
        var zColor = zoneColorOverride !== null ? zoneColorOverride : perCtrlColor2;
        var zones = ctrl.zones || [];
        for (var jj = 0; jj < zones.length; jj++) {
          var z = zones[jj];
          if (z.latitude == null || z.longitude == null) continue;
          // Key: valveBoxRef when present, otherwise the zone's own featureRef
          var boxKey = z.valveBoxRef || z.featureRef;
          if (!boxGroups[boxKey]) {
            boxGroups[boxKey] = {
              latitude:            z.latitude,
              longitude:           z.longitude,
              controllerColor:     zColor,
              controllerFeatureRef: ctrl.featureRef || ctrl.controllerKey || zColor,
              controllerKey:       ctrl.controllerKey || '',
              boxLabel:            z.valveBoxLabel || null,
              zones:               [],
            };
            boxOrder.push(boxKey);
          }
          boxGroups[boxKey].zones.push({
            id:                   z.id,
            featureRef:           z.featureRef,
            zoneNumber:           z.zoneNumber,
            zoneType:             z.zoneType || null,
            label:                z.label || z.zoneLabelShort || ('Zone ' + (z.zoneNumber || '')),
            controllerColor:      zColor,
            controllerLabel:      ctrl.label || ctrl.controllerKey || 'Controller',
            controllerFeatureRef: ctrl.featureRef || ctrl.controllerKey || zColor,
          });
        }
      }

      var zoneMarkers = [];
      for (var bk = 0; bk < boxOrder.length; bk++) {
        var bKey  = boxOrder[bk];
        var group = boxGroups[bKey];
        var zonesArr = group.zones;

        // Sort zones within each box by zone number
        zonesArr.sort(function(a, b) { return (a.zoneNumber || 999) - (b.zoneNumber || 999); });

        // Use the lowest-numbered zone's controller colour for the group marker
        group.controllerColor = zonesArr[0].controllerColor;
        group.controllerFeatureRef = zonesArr[0].controllerFeatureRef;

        // Detect mixed-controller boxes
        var mixedController = false;
        var firstCtrlRef = zonesArr[0].controllerFeatureRef;
        for (var mk = 1; mk < zonesArr.length; mk++) {
          if (zonesArr[mk].controllerFeatureRef !== firstCtrlRef) {
            mixedController = true;
            break;
          }
        }

        var firstZone = zonesArr[0];
        zoneMarkers.push({
          id:                   firstZone.id,
          label:                firstZone.label,
          featureRef:           firstZone.featureRef,
          zoneNumber:           firstZone.zoneNumber,
          controllerColor:      group.controllerColor,
          controllerLabel:      firstZone.controllerLabel,
          controllerFeatureRef: group.controllerFeatureRef,
          controllerKey:        group.controllerKey,
          latitude:             group.latitude,
          longitude:            group.longitude,
          boxLabel:             group.boxLabel,
          zones:                zonesArr,
          mixedController:      mixedController,
        });
      }

      // Always send both arrays (even empty) so stale markers are cleared.
      _cmd('setControllerMarkers', ctrlMarkers);
      _cmd('setZoneMarkers',       zoneMarkers);
    }

    // ── GeoJSON layer pushing ─────────────────────────────────────────────────
    function _pushLayersBatch(layers) {
      var ctrlOverride    = _getOverride('irrigation', 'controller');
      var ctrlColorMap    = _buildControllerColorMap(ctrlOverride);
      var storedZoneColor = _getStoredZoneColor();

      var toAdd = [];
      for (var i = 0; i < layers.length; i++) {
        var l = layers[i];
        if ((l.layerKey === 'outline') || (l.type === 'outline')) continue;
        if (l.subLayerKey === 'controller' && _suppressCtrlGeo) continue;
        if (l.subLayerKey === 'zone'       && _suppressZoneGeo) continue;
        if (!l._geojson) continue;
        if (_addedLayerIds[l.id]) continue;

        var color = _effectiveLayerColor(l);
        _layerColors[l.id] = color;

        var colorMap = {};
        if (l.subLayerKey === 'controller') {
          colorMap = ctrlColorMap;
        } else if (l.subLayerKey === 'zone') {
          colorMap = storedZoneColor ? _buildZoneColorMap(storedZoneColor) : ctrlColorMap;
        }

        toAdd.push({
          id:               l.id,
          layerKey:         l.layerKey  || l.type || 'community',
          subLayerKey:      l.subLayerKey || l.type || 'community',
          displayName:      l.displayName || l.name || '',
          color:            color,
          geojson:          l._geojson,
          controllerColorMap: colorMap,
        });
        _addedLayerIds[l.id] = true;
      }

      if (toAdd.length > 0) _cmd('addLayers', toAdd);
    }

    // ── Suppression logic ─────────────────────────────────────────────────────
    function _geoJsonFeatureRefs(geojson) {
      if (!geojson || !geojson.features || geojson.features.length === 0) return null;
      var refs = [];
      for (var i = 0; i < geojson.features.length; i++) {
        var f = geojson.features[i];
        var p = f.properties || {};
        var ref = (f.id != null && f.id !== '' ? String(f.id) : null)
          || p.featureId || p.id || p.featureRef || p.name || null;
        if (!ref) return null;
        refs.push(String(ref));
      }
      return refs;
    }

    function _computeSuppression() {
      var posCtrlRefs = {};
      var posZoneRefs = {};

      for (var i = 0; i < _controllerData.length; i++) {
        var c = _controllerData[i];
        if (c.latitude != null && c.longitude != null && c.featureRef) {
          posCtrlRefs[String(c.featureRef)] = true;
        }
        var zones = c.zones || [];
        for (var j = 0; j < zones.length; j++) {
          var z = zones[j];
          if (z.latitude != null && z.longitude != null && z.featureRef) {
            posZoneRefs[String(z.featureRef)] = true;
          }
        }
      }

      function allPositioned(subLayerKey, posRefs) {
        var layers = [];
        for (var k = 0; k < _mapLayers.length; k++) {
          if (_mapLayers[k].subLayerKey === subLayerKey && _mapLayers[k]._geojson) {
            layers.push(_mapLayers[k]);
          }
        }
        if (layers.length === 0) return false;
        for (var m = 0; m < layers.length; m++) {
          var refs = _geoJsonFeatureRefs(layers[m]._geojson);
          if (!refs || refs.length === 0) return false;
          for (var n = 0; n < refs.length; n++) {
            if (!posRefs[refs[n]]) return false;
          }
        }
        return true;
      }

      _suppressCtrlGeo = allPositioned('controller', posCtrlRefs);
      _suppressZoneGeo = allPositioned('zone',       posZoneRefs);
    }

    // ── Outline helpers ───────────────────────────────────────────────────────
    function _buildOutlineStyle(layer) {
      if (!layer) return null;
      var s = {};
      if (layer.strokeColor)   s.strokeColor  = layer.strokeColor;
      if (layer.strokeWeight)  s.strokeWeight = layer.strokeWeight;
      if (layer.fillOpacity != null) {
        var fo = parseFloat(layer.fillOpacity);
        if (!isNaN(fo) && fo >= 0 && fo <= 1) s.fillOpacity = fo;
      }
      return Object.keys(s).length ? s : null;
    }

    // ── Bounds fitting ────────────────────────────────────────────────────────
    function _fitVisibleContent(stateForCat) {
      var minLat = Infinity, maxLat = -Infinity;
      var minLng = Infinity, maxLng = -Infinity;

      function extend(lat, lng) {
        if (lat == null || lng == null || isNaN(+lat) || isNaN(+lng)) return;
        if (+lat < minLat) minLat = +lat;
        if (+lat > maxLat) maxLat = +lat;
        if (+lng < minLng) minLng = +lng;
        if (+lng > maxLng) maxLng = +lng;
      }

      function walkCoords(coords) {
        if (!Array.isArray(coords)) return;
        if (typeof coords[0] === 'number') { extend(coords[1], coords[0]); }
        else { for (var i = 0; i < coords.length; i++) walkCoords(coords[i]); }
      }

      // Walk all visible layers for the active category (or all if null)
      for (var i = 0; i < _mapLayers.length; i++) {
        var l = _mapLayers[i];
        if (_activeCategory !== null && l.layerKey !== _activeCategory) continue;
        var sub = l.subLayerKey;
        if (sub === 'controller' && _suppressCtrlGeo) continue;
        if (sub === 'zone'       && _suppressZoneGeo) continue;
        if (_activeCategory !== null && stateForCat && !stateForCat[sub]) continue;
        if (!l._geojson || !l._geojson.features) continue;
        for (var j = 0; j < l._geojson.features.length; j++) {
          var f = l._geojson.features[j];
          if (f.geometry && f.geometry.coordinates) walkCoords(f.geometry.coordinates);
        }
      }

      // Controller / zone marker coordinates
      var isIrrCat = _activeCategory === 'irrigation' || _activeCategory === null;
      if (isIrrCat && _controllerData.length > 0) {
        var showCtrl = !stateForCat || stateForCat.controller !== false;
        var showZone = !stateForCat || stateForCat.zone !== false;
        for (var ci = 0; ci < _controllerData.length; ci++) {
          var ctrl = _controllerData[ci];
          if (showCtrl && ctrl.latitude != null && ctrl.longitude != null) {
            extend(ctrl.latitude, ctrl.longitude);
          }
          var czones = ctrl.zones || [];
          for (var zi = 0; zi < czones.length; zi++) {
            var cz = czones[zi];
            if (showZone && cz.latitude != null && cz.longitude != null) {
              extend(cz.latitude, cz.longitude);
            }
          }
        }
      }

      if (minLat <= maxLat && minLng <= maxLng) {
        _cmd('fitBounds', [[minLat, minLng], [maxLat, maxLng]]);
      } else if (_outlineGeojson) {
        _cmd('fitToOutline');
      }
    }

    // ── Visibility sync ────────────────────────────────────────────────────────
    function _computeVisibleIds(stateForCat) {
      var ids = [];
      for (var i = 0; i < _mapLayers.length; i++) {
        var l = _mapLayers[i];
        if (l.layerKey !== _activeCategory) continue;
        if (l.subLayerKey === 'controller' && _suppressCtrlGeo) continue;
        if (l.subLayerKey === 'zone'       && _suppressZoneGeo) continue;
        if (stateForCat && stateForCat[l.subLayerKey]) ids.push(l.id);
      }
      return ids;
    }

    function _syncToIframe(stateForCat, fit) {
      if (_activeCategory === null) {
        // Summary: show all non-outline layers with geometry
        var allIds = [];
        for (var i = 0; i < _mapLayers.length; i++) {
          var l = _mapLayers[i];
          if (l.layerKey === 'outline' || l.type === 'outline') continue;
          if (l._geojson) allIds.push(l.id);
        }
        _cmd('showLayerIds', allIds);
        _cmd('showControllers', false);
        _cmd('showZones', false);
      } else {
        var visIds = _computeVisibleIds(stateForCat);
        _cmd('showLayerIds', visIds);
        if (_activeCategory === 'irrigation') {
          _cmd('showControllers', !!(stateForCat && stateForCat.controller));
          _cmd('showZones',       !!(stateForCat && stateForCat.zone));
        } else {
          _cmd('showControllers', false);
          _cmd('showZones', false);
        }
      }
      if (fit) _fitVisibleContent(stateForCat);
    }

    // ── Apply loaded state to iframe ─────────────────────────────────────────
    function _applyState() {
      // Push all non-outline GeoJSON layers (addLayers call — only here)
      _pushLayersBatch(_mapLayers);

      // Push irrigation markers if any
      if (_controllerData.length > 0) {
        var ctrlOverride = _getOverride('irrigation', 'controller');
        var zoneOverride = _getOverride('irrigation', 'zone') || _getStoredZoneColor();
        _sendIrrigationMarkers(ctrlOverride, zoneOverride);
      }

      // Outline
      if (_outlineGeojson) {
        _cmd('setCommunityOutline', _outlineGeojson, _outlineStyle);
      } else {
        _cmd('setCommunityOutline', null);
      }

      // Show active category layers. Fit only on the very first apply —
      // a re-applied push cycle (late/replayed ready) must not stomp a
      // viewport the user has already panned/zoomed.
      var stateForCat = _sublayerState[_activeCategory] || {};
      _syncToIframe(stateForCat, !_hasApplied);
      _hasApplied = true;

      _emit('ready', _buildStateSnapshot());
    }

    // ── load() ────────────────────────────────────────────────────────────────
    function load(communityId) {
      _dataReady = false;
      _addedLayerIds = {};
      _layerColors   = {};
      _outlineGeojson = null;
      _outlineStyle   = null;
      _suppressCtrlGeo = false;
      _suppressZoneGeo = false;

      var fetchCtrl = (adapter.fetchControllers)
        ? adapter.fetchControllers(communityId).catch(function () { return []; })
        : Promise.resolve([]);

      return Promise.all([
        adapter.fetchLayers(communityId),
        fetchCtrl,
      ]).then(function (results) {
        _mapLayers      = results[0] || [];
        _controllerData = results[1] || [];

        // Eager-fetch all GeoJSON
        return Promise.all(_mapLayers.map(function (layer) {
          return adapter.fetchLayerGeojson(layer.id).then(function (geojson) {
            if (geojson && geojson.features && geojson.features.length > 0) {
              layer._geojson = geojson;
            } else {
              layer._geojson = null;
            }
          }).catch(function () { layer._geojson = null; });
        }));
      }).then(function () {
        // ── Build populated index ──────────────────────────────────────────
        _populated = {};
        var catKeys = Object.keys(hierarchy);
        for (var ci = 0; ci < catKeys.length; ci++) {
          _populated[catKeys[ci]] = {};
        }

        for (var li = 0; li < _mapLayers.length; li++) {
          var layer = _mapLayers[li];
          var cat   = layer.layerKey;
          var sub   = layer.subLayerKey;
          if (!cat || !sub || layer.isEnabled === false || layer.type === 'outline') continue;
          if (!_populated[cat]) _populated[cat] = {};
          if (layer._geojson) _populated[cat][sub] = true;
        }

        // Controllers populate irrigation regardless of GeoJSON
        if (_controllerData.length > 0) {
          if (!_populated.irrigation) _populated.irrigation = {};
          _populated.irrigation.controller = true;
          for (var cii = 0; cii < _controllerData.length; cii++) {
            if ((_controllerData[cii].zones || []).length > 0) {
              _populated.irrigation.zone = true;
              break;
            }
          }
        }

        // ── Suppression ────────────────────────────────────────────────────
        _computeSuppression();

        // ── Populated categories list ──────────────────────────────────────
        _populatedCategories = [];
        var hKeys = Object.keys(hierarchy);
        for (var hi = 0; hi < hKeys.length; hi++) {
          var hCat = hKeys[hi];
          var pop  = _populated[hCat] || {};
          var vals = Object.keys(pop);
          var any  = false;
          for (var vi = 0; vi < vals.length; vi++) {
            if (pop[vals[vi]]) { any = true; break; }
          }
          if (any) _populatedCategories.push(hCat);
        }

        // ── Active category ────────────────────────────────────────────────
        _activeCategory = _populatedCategories[0] || 'community';

        // ── Sublayer state: populated → on, else off ───────────────────────
        _sublayerState = {};
        for (var ski = 0; ski < hKeys.length; ski++) {
          var sk = hKeys[ski];
          _sublayerState[sk] = {};
          var subs = hierarchy[sk] || [];
          for (var si = 0; si < subs.length; si++) {
            _sublayerState[sk][subs[si].key] =
              !!(_populated[sk] && _populated[sk][subs[si].key]);
          }
        }

        // ── Outline ────────────────────────────────────────────────────────
        var outlineLayer = null;
        for (var oi = 0; oi < _mapLayers.length; oi++) {
          var ol = _mapLayers[oi];
          if (ol.layerKey === 'outline' && ol._geojson && ol.isEnabled !== false) {
            outlineLayer = ol; break;
          }
        }
        if (outlineLayer) {
          _outlineGeojson = outlineLayer._geojson;
          _outlineStyle   = _buildOutlineStyle(outlineLayer);
        }

        _dataReady = true;

        // Initial bounds fit (optional adapter method)
        if (adapter.fetchBounds) {
          return adapter.fetchBounds(communityId).then(function (boundsData) {
            if (boundsData && boundsData.bounds && boundsData.bounds.length > 0) {
              _cmd('fitBounds', boundsData.bounds);
            }
          }).catch(function () {}).then(function () {
            if (_iframeReady) _applyState();
            return _buildStateSnapshot();
          });
        }

        if (_iframeReady) _applyState();
        return _buildStateSnapshot();
      });
    }

    // ── Public API ────────────────────────────────────────────────────────────

    // opts.fit === false suppresses the viewport refit (used by restore
    // paths that must preserve the user's current zoom/centre). Default is
    // the historical behaviour: fit to the newly visible content.
    function setActiveCategory(key, opts) {
      _activeCategory = key;
      var stateForCat = key !== null ? (_sublayerState[key] || {}) : null;
      _syncToIframe(stateForCat, !(opts && opts.fit === false));
    }

    function setVisibleSubLayers(stateForCat) {
      // stateForCat: { [subKey]: bool } — caller has already updated _sublayerState
      if (_activeCategory !== null) {
        _sublayerState[_activeCategory] = stateForCat;
      }
      _syncToIframe(stateForCat, false);
    }

    function setSatellite(on) { _cmd('setSatellite', on); }

    function fit() {
      var stateForCat = _activeCategory !== null ? (_sublayerState[_activeCategory] || {}) : null;
      _fitVisibleContent(stateForCat);
    }

    function invalidateSize() { _cmd('invalidateSize'); }

    function on(event, handler) {
      if (_events[event]) _events[event].push(handler);
    }

    // Color picker support
    function applyColorLive(cat, subKey, newColor) {
      if (cat === 'irrigation' && (subKey === 'controller' || subKey === 'zone')) {
        _setOverride(cat, subKey, newColor);
        var ctrlOverride = _getOverride('irrigation', 'controller');
        var zoneOverride = _getOverride('irrigation', 'zone');
        _sendIrrigationMarkers(ctrlOverride, zoneOverride);

        var ctrlLayer = null, zoneLayer = null;
        for (var i = 0; i < _mapLayers.length; i++) {
          if (_mapLayers[i].layerKey === 'irrigation') {
            if (_mapLayers[i].subLayerKey === 'controller') ctrlLayer = _mapLayers[i];
            if (_mapLayers[i].subLayerKey === 'zone')       zoneLayer = _mapLayers[i];
          }
        }

        if (subKey === 'controller') {
          var updMap = _buildControllerColorMap(ctrlOverride);
          if (ctrlLayer) _cmd('updateLayerColorMap', ctrlLayer.id, updMap, ctrlOverride || _getLayerEffectiveColor('irrigation', 'controller'));
          if (zoneLayer) {
            var effZone   = zoneOverride || _getLayerEffectiveColor('irrigation', 'zone');
            var zoneGeoMap = zoneOverride ? _buildZoneColorMap(effZone) : updMap;
            _cmd('updateLayerColorMap', zoneLayer.id, zoneGeoMap, effZone);
          }
        } else {
          if (zoneLayer) {
            _cmd('updateLayerColorMap', zoneLayer.id, _buildZoneColorMap(newColor), newColor);
          }
        }
        return;
      }
      var apiLayer = null;
      for (var j = 0; j < _mapLayers.length; j++) {
        if (_mapLayers[j].subLayerKey === subKey && _mapLayers[j].layerKey === cat) {
          apiLayer = _mapLayers[j]; break;
        }
      }
      if (apiLayer) _cmd('updateLayerColor', apiLayer.id, newColor);
    }

    // Ad-hoc custom layer support (e.g. branch pins in portfolio map)
    function addCustomLayer(layerDef) {
      _cmd('addLayers', [layerDef]);
    }

    function showCustomLayers(ids) {
      _cmd('showLayerIds', ids);
    }

    function destroy() {
      if (_msgHandler) { window.removeEventListener('message', _msgHandler); _msgHandler = null; }
    }

    _setupHandler();

    return {
      load:                  load,
      setActiveCategory:     setActiveCategory,
      setVisibleSubLayers:   setVisibleSubLayers,
      setSatellite:          setSatellite,
      fit:                   fit,
      invalidateSize:        invalidateSize,
      on:                    on,
      applyColorLive:        applyColorLive,
      getLayerEffectiveColor: _getLayerEffectiveColor,
      getControllerData:     function () { return _controllerData; },
      getMapLayers:          function () { return _mapLayers; },
      getState:              _buildStateSnapshot,
      getSessionColorOverride: _getOverride,
      setSessionColorOverride: _setOverride,
      addCustomLayer:        addCustomLayer,
      showCustomLayers:      showCustomLayers,
      cmdToIframe:           _cmd,
      destroy:               destroy,
    };
  }

  // ── Static helper: renderSatelliteToggle ─────────────────────────────────
  // Creates a Map/Satellite toggle button inside containerEl.
  // Reads vrt_map_basemap from localStorage on init and calls renderer.setSatellite()
  // immediately. Writes back to localStorage on click. Emits 'basemap-change' event.
  function renderSatelliteToggle(containerEl, renderer) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'vrt-sat-toggle';

    var isSatellite = false;
    try { isSatellite = localStorage.getItem('vrt_map_basemap') === 'satellite'; } catch (_) {}

    function apply(on) {
      isSatellite = on;
      btn.textContent = on ? 'Map' : 'Satellite';
      btn.classList.toggle('vrt-sat-toggle--active', on);
      btn.title = on ? 'Switch to street map' : 'Switch to satellite view';
      if (renderer) renderer.setSatellite(on);
      try { localStorage.setItem('vrt_map_basemap', on ? 'satellite' : 'map'); } catch (_) {}
      btn.dispatchEvent(new CustomEvent('basemap-change', { bubbles: true, detail: { satellite: on } }));
    }

    apply(isSatellite);
    btn.addEventListener('click', function () { apply(!isSatellite); });
    containerEl.appendChild(btn);
    return btn;
  }

  // ── Static helper: renderExpandButton ────────────────────────────────────
  // Wires an existing expand/collapse button (btnEl) to toggle expandedClass
  // on mapWrapEl. If btnEl is null, creates and appends a floating button.
  // Fires 'vrt-map-collapse' custom event on mapWrapEl when collapsing.
  // Returns { collapse } so callers can trigger collapse programmatically.
  function renderExpandButton(btnEl, mapWrapEl, renderer, expandedClass) {
    var btn = btnEl;
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vrt-map-expand-btn-auto';
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/></svg>';
      mapWrapEl.appendChild(btn);
    }

    function collapse() {
      mapWrapEl.classList.remove(expandedClass);
      btn.setAttribute('aria-pressed', 'false');
      btn.title = 'Expand map';
      setTimeout(function () { if (renderer) renderer.invalidateSize(); }, 270);
      mapWrapEl.dispatchEvent(new CustomEvent('vrt-map-collapse', { bubbles: false }));
    }

    function expand() {
      mapWrapEl.classList.add(expandedClass);
      btn.setAttribute('aria-pressed', 'true');
      btn.title = 'Collapse map';
      setTimeout(function () { if (renderer) renderer.invalidateSize(); }, 270);
    }

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      if (mapWrapEl.classList.contains(expandedClass)) { collapse(); } else { expand(); }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && mapWrapEl.classList.contains(expandedClass)) { collapse(); }
    });

    return { collapse: collapse };
  }

  // ── Static helper: renderExpandedOverlays ────────────────────────────────
  // Injects a floating category+sublayer panel (top-left) and a legend panel
  // (bottom-left) inside mapWrapEl. Both panels are visible only when mapWrapEl
  // carries expandedClass. Uses a MutationObserver to track class changes.
  //
  // layerState shape:
  //   {
  //     categoryOrder:   string[],
  //     categoryGroups:  { [cat]: [{ id, subLayerKey, name, color, hasGeometry, assetCount? }] },
  //     checkedSubLayers:{ [cat]: { [id]: bool } },
  //     activeCategory:  string | null,
  //   }
  //
  // Fires on mapWrapEl:
  //   'vrt-overlay-category-change' → { activeCategory }
  //   'vrt-overlay-sublayer-change' → { cat, layerId, checked, stateForCat }
  //   'layer-state-change'          → { activeCategory, checkedSubLayers }  (on collapse)
  function renderExpandedOverlays(mapWrapEl, renderer, layerState, expandedClass) {
    if (!layerState || !layerState.categoryOrder || layerState.categoryOrder.length === 0) return;

    // Local mutable state
    var _activeCat = layerState.activeCategory !== undefined ? layerState.activeCategory : (layerState.categoryOrder[0] || null);
    var _checked = {};
    layerState.categoryOrder.forEach(function (cat) {
      _checked[cat] = {};
      var src = (layerState.checkedSubLayers || {})[cat] || {};
      Object.keys(src).forEach(function (k) { _checked[cat][k] = src[k]; });
    });

    // Satellite state (shared with any existing toggle)
    var _isSat = false;
    try { _isSat = localStorage.getItem('vrt_map_basemap') === 'satellite'; } catch (_) {}

    // DOM nodes
    var panel = document.createElement('div');
    panel.className = 'vrt-expanded-overlay';
    mapWrapEl.appendChild(panel);

    var legend = document.createElement('div');
    legend.className = 'vrt-expanded-legend';
    mapWrapEl.appendChild(legend);

    function buildStateForCat(cat) {
      var layers = (layerState.categoryGroups[cat] || []);
      var chk    = _checked[cat] || {};
      var state  = {};
      layers.forEach(function (l) {
        var subKey = l.subLayerKey || l.id;
        state[subKey] = l.hasGeometry ? (chk[l.id] !== false) : false;
      });
      return state;
    }

    function renderLegend() {
      var layers = (layerState.categoryGroups[_activeCat] || []);
      var items  = layers.filter(function (l) { return l.hasGeometry; }).map(function (l) {
        return '<div class="vrt-expanded-legend__item">'
          + '<span class="vrt-expanded-legend__dot" style="background:' + (l.color || '#888') + '"></span>'
          + '<span class="vrt-expanded-legend__lbl">' + (l.name || l.id) + '</span>'
          + '</div>';
      }).join('');
      legend.innerHTML = items ? '<div class="vrt-expanded-legend__title">Legend</div>' + items : '';
      legend.style.display = items ? '' : 'none';
    }

    function renderPanel() {
      var catOrder = layerState.categoryOrder || [];

      // Category tabs
      var tabsHtml = catOrder.map(function (cat) {
        var active = cat === _activeCat ? ' vrt-expanded-overlay__cat--active' : '';
        var label  = cat.charAt(0).toUpperCase() + cat.slice(1).replace(/_/g, ' ');
        return '<button class="vrt-expanded-overlay__cat' + active + '" data-cat="' + cat + '">' + label + '</button>';
      }).join('');

      // Sub-layer rows for active category
      var layers  = (layerState.categoryGroups[_activeCat] || []);
      var chk     = _checked[_activeCat] || {};
      var rowsHtml = layers.map(function (layer) {
        var color       = layer.color || '#888888';
        var hasGeo      = !!layer.hasGeometry;
        var isChecked   = hasGeo ? (chk[layer.id] !== false) : false;
        var disabledCls = hasGeo ? '' : ' vrt-expanded-overlay__row--disabled';
        var disabledAtr = hasGeo ? '' : ' disabled';
        var checkedAtr  = (hasGeo && isChecked) ? ' checked' : '';
        var countHtml   = (layer.assetCount != null && hasGeo)
          ? '<span class="vrt-expanded-overlay__count">' + layer.assetCount + '</span>' : '';
        var noDataHtml  = !hasGeo ? '<span class="vrt-expanded-overlay__nodata">no data</span>' : '';
        return '<label class="vrt-expanded-overlay__row' + disabledCls + '">'
          + '<input type="checkbox"' + checkedAtr + disabledAtr
            + ' data-cat="' + _activeCat + '" data-layer-id="' + layer.id + '">'
          + '<span class="vrt-expanded-overlay__dot" style="background:' + color + '"></span>'
          + '<span class="vrt-expanded-overlay__lbl">' + (layer.name || layer.id) + '</span>'
          + noDataHtml + countHtml
          + '</label>';
      }).join('');

      // Satellite toggle (synced with external toggles via localStorage key)
      var satLabel = _isSat ? 'Map' : 'Satellite';
      var satActive = _isSat ? ' vrt-sat-toggle--active' : '';

      panel.innerHTML = ''
        // Compact-mode toggle button (shown only at < 900 px)
        + '<button class="vrt-expanded-overlay__compact-btn" type="button">Layers</button>'
        // Main content
        + '<div class="vrt-expanded-overlay__main">'
          + '<div class="vrt-expanded-overlay__header">'
            + '<span class="vrt-expanded-overlay__title">Layers</span>'
            + '<button type="button" class="vrt-sat-toggle vrt-expanded-overlay__sat-btn' + satActive + '">' + satLabel + '</button>'
          + '</div>'
          + '<div class="vrt-expanded-overlay__cats">' + tabsHtml + '</div>'
          + (rowsHtml ? '<div class="vrt-expanded-overlay__rows">' + rowsHtml + '</div>' : '')
        + '</div>';

      // Wire compact-mode button
      var compactBtn = panel.querySelector('.vrt-expanded-overlay__compact-btn');
      if (compactBtn) {
        compactBtn.addEventListener('click', function () { panel.classList.toggle('vrt-expanded-overlay--open'); });
      }

      // Wire satellite button inside panel
      var satBtn = panel.querySelector('.vrt-expanded-overlay__sat-btn');
      if (satBtn) {
        satBtn.addEventListener('click', function () {
          _isSat = !_isSat;
          satBtn.textContent = _isSat ? 'Map' : 'Satellite';
          satBtn.classList.toggle('vrt-sat-toggle--active', _isSat);
          if (renderer) renderer.setSatellite(_isSat);
          try { localStorage.setItem('vrt_map_basemap', _isSat ? 'satellite' : 'map'); } catch (_) {}
          // Sync any external satellite toggles in the same wrap
          mapWrapEl.querySelectorAll('.vrt-sat-toggle:not(.vrt-expanded-overlay__sat-btn)').forEach(function (b) {
            b.classList.toggle('vrt-sat-toggle--active', _isSat);
            b.textContent = _isSat ? 'Map' : 'Satellite';
          });
        });
      }

      // Wire category tabs
      panel.querySelectorAll('.vrt-expanded-overlay__cat').forEach(function (btn) {
        btn.addEventListener('click', function () {
          _activeCat = btn.getAttribute('data-cat');
          if (renderer) renderer.setActiveCategory(_activeCat);
          mapWrapEl.dispatchEvent(new CustomEvent('vrt-overlay-category-change', {
            bubbles: false, detail: { activeCategory: _activeCat }
          }));
          renderPanel();
        });
      });

      // Wire sub-layer checkboxes
      panel.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
        cb.addEventListener('change', function () {
          var cat = cb.getAttribute('data-cat');
          var lid = cb.getAttribute('data-layer-id');
          if (!cat || !lid) return;
          if (!_checked[cat]) _checked[cat] = {};
          _checked[cat][lid] = cb.checked;
          var stateForCat = buildStateForCat(cat);
          if (renderer) {
            // Sync the renderer's active category before applying sublayer
            // visibility — the host tab bar may have changed the renderer's
            // category independently of the overlay. Only switch (which refits
            // the viewport) when the category actually differs, so a plain
            // sub-layer toggle preserves the user's current zoom/centre.
            var curCat = renderer.getState ? renderer.getState().activeCategory : undefined;
            if (curCat !== cat) renderer.setActiveCategory(cat);
            renderer.setVisibleSubLayers(stateForCat);
          }
          mapWrapEl.dispatchEvent(new CustomEvent('vrt-overlay-sublayer-change', {
            bubbles: false,
            detail: { cat: cat, layerId: lid, checked: cb.checked, stateForCat: stateForCat }
          }));
        });
      });

      renderLegend();
    }

    function updateVisibility() {
      var isExpanded = mapWrapEl.classList.contains(expandedClass);
      // Sync satellite state from localStorage each time we show
      try { _isSat = localStorage.getItem('vrt_map_basemap') === 'satellite'; } catch (_) {}
      panel.style.display  = isExpanded ? '' : 'none';
      legend.style.display = isExpanded ? '' : 'none';
      if (isExpanded) renderPanel();
    }

    // Watch class changes on mapWrapEl
    var classObserver = new MutationObserver(function () { updateVisibility(); });
    classObserver.observe(mapWrapEl, { attributes: true, attributeFilter: ['class'] });

    // Allow host pages (tab bars, etc.) to push a new active category into the
    // overlay without triggering a feedback loop.  Used by branch-detail when
    // the user clicks a page tab while the map is expanded.
    mapWrapEl.addEventListener('vrt-sync-overlay-category', function (e) {
      var newCat = e.detail.activeCategory; // null = Summary / show-all
      _activeCat = (newCat !== null && newCat !== undefined)
        ? newCat
        : null;
      if (panel.style.display !== 'none') renderPanel();
    });

    // On collapse: fire layer-state-change with final state
    mapWrapEl.addEventListener('vrt-map-collapse', function () {
      mapWrapEl.dispatchEvent(new CustomEvent('layer-state-change', {
        bubbles: false,
        detail: { activeCategory: _activeCat, checkedSubLayers: _checked }
      }));
    });

    // ResizeObserver for compact mode (< 900 px)
    if (typeof ResizeObserver !== 'undefined') {
      var ro = new ResizeObserver(function (entries) {
        var w = entries[0].contentRect.width;
        panel.classList.toggle('vrt-expanded-overlay--compact', w < 900);
      });
      ro.observe(mapWrapEl);
    }

    // Initial visibility
    updateVisibility();
  }

  window.VRTMapRenderer = {
    create:                  create,
    renderSatelliteToggle:   renderSatelliteToggle,
    renderExpandButton:      renderExpandButton,
    renderExpandedOverlays:  renderExpandedOverlays,
  };
})();
