/* VRTSync Portal — SyncManager
 *
 * A small utility that wraps setTimeout (one-shot re-scheduling), respects
 * the Page Visibility API (pauses when tab hidden, resumes on focus), and
 * exposes:
 *   start(fetchFn, onResult, intervalMs)
 *   stop()
 *   forceRefresh()
 *
 * onResult(data, changed) is called after every successful fetch.
 *   changed = true when task IDs/statuses differ from the previous result.
 *
 * lastSynced() returns a Date or null.
 *
 * Race-condition safeguards:
 *  - A generation counter ensures stale in-flight fetches are ignored when
 *    stop() or a new start() is called.
 *  - An _inFlight flag prevents overlapping concurrent fetches.
 *  - _schedule() always checks document.hidden before setting a timer.
 *  - _onVisibility() only triggers a new fetch if the tab becomes visible
 *    AND no fetch is already in flight AND the manager is still running.
 */
window.SyncManager = (function () {

  function create() {
    var _fetchFn      = null;
    var _onResult     = null;
    var _intervalMs   = 30000;
    var _timerId      = null;
    var _lastSynced   = null;
    var _prevSnapshot = null;
    var _running      = false;
    var _inFlight     = false;
    var _generation   = 0;   /* incremented on stop/start; stale callbacks check this */

    function _snapshot(data) {
      if (Array.isArray(data)) {
        return data.map(function (t) { return t.id + ':' + t.status; }).sort().join(',');
      }
      try { return JSON.stringify(data); } catch (_) { return ''; }
    }

    function _changed(newData) {
      var snap = _snapshot(newData);
      if (_prevSnapshot === null) {
        _prevSnapshot = snap;
        return false;
      }
      var diff = snap !== _prevSnapshot;
      _prevSnapshot = snap;
      return diff;
    }

    /* Execute a fetch; ignore result if our generation has advanced */
    function _doFetch(gen) {
      if (!_fetchFn || gen !== _generation || _inFlight) return Promise.resolve();
      _inFlight = true;
      return Promise.resolve(_fetchFn()).then(function (data) {
        _inFlight = false;
        if (gen !== _generation) return; /* stale — discard */
        _lastSynced = new Date();
        var changed = _changed(data);
        if (typeof _onResult === 'function') {
          _onResult(data, changed);
        }
      }).catch(function (e) {
        _inFlight = false;
        if (gen !== _generation) return; /* stale */
        console.warn('SyncManager fetch error:', e);
      });
    }

    /* Schedule the NEXT fetch only when visible and still running */
    function _schedule(gen) {
      if (!_running || gen !== _generation) return;
      clearTimeout(_timerId);
      _timerId = null;
      if (document.hidden) return; /* will resume via _onVisibility */
      _timerId = setTimeout(function () {
        _timerId = null;
        if (!_running || gen !== _generation) return;
        _doFetch(gen).then(function () { _schedule(gen); });
      }, _intervalMs);
    }

    function _onVisibility() {
      if (document.hidden) {
        /* Tab hidden — cancel pending timer; in-flight fetch will discard itself via gen check */
        clearTimeout(_timerId);
        _timerId = null;
      } else {
        /* Tab visible — only trigger if running and nothing already in flight */
        if (_running && !_inFlight) {
          var gen = _generation;
          _doFetch(gen).then(function () { _schedule(gen); });
        }
      }
    }

    function start(fetchFn, onResult, intervalMs) {
      stop(); /* clears old generation */
      _fetchFn    = fetchFn;
      _onResult   = onResult;
      _intervalMs = intervalMs || 30000;
      _running    = true;
      var gen = _generation;
      document.addEventListener('visibilitychange', _onVisibility);
      _doFetch(gen).then(function () { _schedule(gen); });
    }

    function stop() {
      _running = false;
      _generation++; /* invalidate all in-flight / pending callbacks */
      clearTimeout(_timerId);
      _timerId = null;
      _inFlight = false;
      document.removeEventListener('visibilitychange', _onVisibility);
      _prevSnapshot = null;
    }

    function forceRefresh() {
      if (!_running) return;
      clearTimeout(_timerId);
      _timerId = null;
      var gen = _generation;
      if (!_inFlight) {
        _doFetch(gen).then(function () { _schedule(gen); });
      }
    }

    function lastSynced() {
      return _lastSynced;
    }

    return { start: start, stop: stop, forceRefresh: forceRefresh, lastSynced: lastSynced };
  }

  return { create: create };
})();
