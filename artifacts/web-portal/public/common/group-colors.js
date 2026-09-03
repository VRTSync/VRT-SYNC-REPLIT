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

  window.VRTGroupColors = {
    GROUP_PALETTE:     GROUP_PALETTE,
    resolveGroupColor: resolveGroupColor,
    hexToRgba:         hexToRgba,
    getStableFallbackIndexes: getStableFallbackIndexes,
  };
})();
