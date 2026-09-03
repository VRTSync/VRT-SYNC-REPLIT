/**
 * Shared organization-scoped scenario state for both Water Savings routes.
 * The active scenario survives client-side navigation; polygon data is cached
 * briefly so returning from a location does not refetch fresh geometry.
 */
(function () {
  'use strict';

  var subscribers = [];
  var polygonCache = null;
  var DEFAULT_NAME = 'Portfolio Water Savings';
  var TIER_PRESETS = {
    rock: { costPerSf: 6, rebatePerSf: 1 },
    colorado: { costPerSf: 10, rebatePerSf: 3.25 }
  };

  function defaultAssumptions() {
    return window.VRTXeriscapeCore.normaliseAssumptions({});
  }

  function initialState() {
    return {
      id: null,
      name: DEFAULT_NAME,
      targetPct: 20,
      tier: 'rock',
      annualBudget: null,
      assumptions: defaultAssumptions(),
      pins: {},
      status: 'draft',
      persistence: 'idle',
      error: null
    };
  }

  var state = initialState();

  function snapshot() {
    return Object.assign({}, state, {
      assumptions: Object.assign({}, state.assumptions),
      pins: Object.assign({}, state.pins)
    });
  }

  function notify() {
    var value = snapshot();
    subscribers.slice().forEach(function (fn) {
      try { fn(value); } catch (err) { console.error('[VRTWaterScenario subscriber]', err); }
    });
  }

  function setState(patch) {
    state = Object.assign({}, state, patch);
    notify();
  }

  function normaliseRecord(record) {
    return {
      id: record.id || null,
      name: record.name || DEFAULT_NAME,
      targetPct: Number.isFinite(Number(record.targetPct)) ? Number(record.targetPct) : 20,
      tier: record.tier === 'colorado' ? 'colorado' : 'rock',
      annualBudget: record.annualBudget == null ? null : Number(record.annualBudget),
      assumptions: window.VRTXeriscapeCore.normaliseAssumptions(record.assumptions || record.assumptionsJson || {}),
      pins: Object.assign({}, record.pins || record.pinsJson || {}),
      status: record.status || 'draft',
      persistence: 'saved',
      error: null
    };
  }

  function requestBody() {
    return {
      name: state.name || DEFAULT_NAME,
      targetPct: state.targetPct,
      tier: state.tier,
      annualBudget: state.annualBudget,
      assumptions: state.assumptions,
      pins: state.pins,
      status: state.status === 'archived' ? 'archived' : 'saved'
    };
  }

  function save(apiSuffix) {
    var creating = !state.id;
    var url = '/api/portfolio/water-savings/scenarios'
      + (creating ? '' : '/' + encodeURIComponent(state.id))
      + (apiSuffix || '');
    setState({ persistence: 'saving', error: null });
    return fetch(url, {
      method: creating ? 'POST' : 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody())
    }).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    }).then(function (record) {
      state = normaliseRecord(record);
      notify();
      return snapshot();
    }).catch(function (err) {
      setState({ persistence: 'error', error: err.message || 'Save failed' });
      throw err;
    });
  }

  window.VRTWaterScenario = {
    get: snapshot,
    reset: function () { state = initialState(); notify(); },
    hydrate: function (record) { state = normaliseRecord(record || {}); notify(); },
    setName: function (name) { setState({ name: String(name || '').trim() || DEFAULT_NAME, persistence: 'dirty' }); },
    setTarget: function (pct) {
      var value = Math.max(0, Math.min(100, Number(pct)));
      setState({ targetPct: Number.isFinite(value) ? value : 20, persistence: 'dirty' });
    },
    setTier: function (tier) {
      var nextTier = tier === 'colorado' ? 'colorado' : 'rock';
      var preset = TIER_PRESETS[nextTier];
      setState({
        tier: nextTier,
        assumptions: Object.assign({}, state.assumptions, {
          costPerSf: preset.costPerSf,
          rebatePerSf: preset.rebatePerSf
        }),
        persistence: 'dirty'
      });
    },
    setBudget: function (budget) {
      var value = budget === '' || budget == null ? null : Math.max(0, Number(budget));
      setState({ annualBudget: Number.isFinite(value) ? value : null, persistence: 'dirty' });
    },
    setAssumptions: function (assumptions) {
      setState({
        assumptions: window.VRTXeriscapeCore.normaliseAssumptions(assumptions),
        persistence: 'dirty'
      });
    },
    setPin: function (polygonId, pin) {
      var pins = Object.assign({}, state.pins);
      if (pin === 'in' || pin === 'out') pins[String(polygonId)] = pin;
      else delete pins[String(polygonId)];
      setState({ pins: pins, persistence: 'dirty' });
    },
     cyclePin: function (polygonId, solverStatus) {
       var id = String(polygonId);
       var current = state.pins[id];
       var next;
       if (current === 'out') {
         next = null;
       } else if (current === 'in') {
         next = 'out';
       } else {
         next = solverStatus === 'in-plan' || solverStatus === 'pinned-in' ? 'out' : 'in';
       }
       var pins = Object.assign({}, state.pins);
       if (next) pins[id] = next;
       else delete pins[id];
       setState({ pins: pins, persistence: 'dirty' });
     },
    clearPins: function () { setState({ pins: {}, persistence: 'dirty' }); },
    subscribe: function (fn) {
      subscribers.push(fn);
      return function () { subscribers = subscribers.filter(function (item) { return item !== fn; }); };
    },
    save: save,
    getPolygonCache: function (maxAgeMs) {
      if (!polygonCache) return null;
      if (Date.now() - polygonCache.fetchedAt > (maxAgeMs || 300000)) return null;
      return polygonCache.data;
    },
    setPolygonCache: function (data) {
      polygonCache = { data: data, fetchedAt: Date.now() };
      return data;
    },
    clearPolygonCache: function () { polygonCache = null; }
  };
})();