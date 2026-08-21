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

  window.VRTGroupColors = {
    GROUP_PALETTE:     GROUP_PALETTE,
    resolveGroupColor: resolveGroupColor,
  };
})();
