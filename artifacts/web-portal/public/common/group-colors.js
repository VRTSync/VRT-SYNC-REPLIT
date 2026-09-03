/**
 * VRTGroupColors — shared group colour palette for portfolio pages.
 * Exposed on window.VRTGroupColors so every portfolio page can resolve
 * group colours consistently (Dashboard, Locations, Map, Groups, Analytics).
 *
 * Palette matches the .gchip.g1–g5 CSS convention and extends to g6–g7
 * with violet (#8b5cf6) and cyan (#06b6d4).
 */
(function () {
  'use strict';

  var GROUP_PALETTE = [
    '#3b82f6', // blue   (index 0 / g1)
    '#f59e0b', // amber  (index 1 / g2)
    '#25C1AC', // teal   (index 2 / g3)
    '#10b981', // green  (index 3 / g4)
    '#ef4444', // red    (index 4 / g5)
    '#8b5cf6', // violet (index 5 / g6)
    '#06b6d4', // cyan   (index 6 / g7)
  ];
  var NEUTRAL = '#94a3b8';
  // Colour used for a location that is in no group of the selected "Colour by" set.
  var UNASSIGNED_COLOR = '#9ca3af';

  /**
   * Resolve the display colour for a group.
   * @param {object|null} group   - group object with optional `.color` field
   * @param {number}      fallbackIndex - index into GROUP_PALETTE (by group position)
   * @returns {string} hex colour
   */
  function resolveGroupColor(group, fallbackIndex) {
    return (group && group.color) ? group.color
         : GROUP_PALETTE[fallbackIndex % GROUP_PALETTE.length];
  }

  /**
   * Convert a hex colour to an rgba() value for translucent group chips.
   * Invalid input deliberately falls back to the shared neutral colour.
   * @param {string} hex
   * @param {number} alpha
   * @returns {string}
   */
  function hexToRgba(hex, alpha) {
    var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex || '');
    if (!m) m = /^#?([0-9a-f]{6})$/i.exec(NEUTRAL);
    var value = m[1];
    if (value.length === 3) {
      value = value.split('').map(function (part) { return part + part; }).join('');
    }
    var n = parseInt(value, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
  }

  /**
   * Return stable fallback indexes for a collection of groups.
   * Groups are ordered by saved sortOrder when available, then by ID, so
   * API response order cannot change a colourless group's palette position.
   * @param {Array<object>} groups
   * @returns {object} group ID → fallback palette index
   */
  function getStableFallbackIndexes(groups) {
    var ordered = (groups || []).filter(function (g) { return g && g.id != null; }).slice();
    ordered.sort(function (a, b) {
      var aOrder = Number(a.sortOrder);
      var bOrder = Number(b.sortOrder);
      var aHasOrder = Number.isFinite(aOrder);
      var bHasOrder = Number.isFinite(bOrder);
      if (aHasOrder && bHasOrder && aOrder !== bOrder) return aOrder - bOrder;
      if (aHasOrder !== bHasOrder) return aHasOrder ? -1 : 1;
      return String(a.id).localeCompare(String(b.id));
    });

    var indexes = {};
    ordered.forEach(function (g, idx) { indexes[g.id] = idx; });
    return indexes;
  }

  /**
   * localStorage key holding the "Colour by" group-set choice for an org.
   * client_admin bootstrap sets organizationId to null (the server uses the
   * session), so fall back to the organization record's id to keep it per-org.
   * @param {object} state - window.PortfolioState
   * @returns {string}
   */
  function colorBySetStorageKey(state) {
    var s = state || {};
    var orgId = s.organizationId || (s.organization && s.organization.id) || '';
    return 'pfm-color-by-' + orgId;
  }

  /**
   * Resolve which group set pins are coloured by. Every portfolio surface must
   * use this so the Map page and the dashboard preview never disagree.
   * Stored id wins when it is still a real set, else the first set, else null.
   * @param {object} state - window.PortfolioState
   * @returns {string|null}
   */
  function resolveColorBySetId(state) {
    var s = state || {};
    var groupSets = Array.isArray(s.groupSets) ? s.groupSets : [];
    var stored = null;
    try { stored = localStorage.getItem(colorBySetStorageKey(s)); } catch (_) {}
    if (stored && groupSets.some(function (set) { return set.id === stored; })) return stored;
    return groupSets.length > 0 ? groupSets[0].id : null;
  }

  /**
   * branchId → { group, fallbackIndex } for the given "Colour by" set.
   * First group wins when a branch belongs to several groups of the set.
   * Returns null when no set is selected (callers then keep their default).
   * An empty set still returns {} — every branch is Unassigned.
   * @param {Array<object>} groups
   * @param {string|null} colorBySetId
   * @returns {object|null}
   */
  function makeBranchGroupLookup(groups, colorBySetId) {
    if (!colorBySetId) return null;
    var all = groups || [];
    var fallbackIndexes = getStableFallbackIndexes(all);
    var lookup = {};
    all.filter(function (g) { return g && g.setId === colorBySetId; })
      .forEach(function (g) {
        (g.branchIds || []).forEach(function (bId) {
          if (!lookup[bId]) lookup[bId] = { group: g, fallbackIndex: fallbackIndexes[g.id] };
        });
      });
    return lookup;
  }

  /**
   * Build a (branch) → hex colour function for the given "Colour by" set.
   * Branches in no group of the set render grey (Unassigned).
   * Returns null when no set is selected, so the caller keeps its own default.
   * @param {Array<object>} groups
   * @param {string|null} colorBySetId
   * @returns {function|null}
   */
  function makeBranchColorFor(groups, colorBySetId) {
    var lookup = makeBranchGroupLookup(groups, colorBySetId);
    if (!lookup) return null;
    return function (branch) {
      var entry = branch && lookup[branch.id];
      if (!entry) return UNASSIGNED_COLOR;
      return resolveGroupColor(entry.group, entry.fallbackIndex);
    };
  }

  window.VRTGroupColors = {
    GROUP_PALETTE:     GROUP_PALETTE,
    UNASSIGNED_COLOR:  UNASSIGNED_COLOR,
    resolveGroupColor: resolveGroupColor,
    hexToRgba:         hexToRgba,
    getStableFallbackIndexes: getStableFallbackIndexes,
    colorBySetStorageKey:  colorBySetStorageKey,
    resolveColorBySetId:   resolveColorBySetId,
    makeBranchGroupLookup: makeBranchGroupLookup,
    makeBranchColorFor:    makeBranchColorFor,
  };
})();
