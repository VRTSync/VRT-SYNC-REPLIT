/**
 * VRTUtils — shared utility functions loaded before all portal scripts.
 * Exposed on window.VRTUtils so every shell can reference them.
 */
(function () {
  'use strict';

  /**
   * HTML-escape a value for text content.
   * Handles null/undefined (returns ''), coerces non-strings via String().
   * Escapes & < > " '
   */
  function esc(value) {
    if (value == null) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * HTML-escape a value for use inside an attribute value (e.g. title="...").
   * Same escapes as esc() — provided as a semantic alias for clarity at call sites.
   */
  function escAttr(value) {
    return esc(value);
  }

  /**
   * Format an ISO date string as a long date (e.g. "January 15, 2026").
   */
  function formatDate(dateStr) {
    if (!dateStr) return '—';
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
      });
    } catch (_) {
      return dateStr;
    }
  }

  /**
   * Format an ISO date string as a short date (e.g. "Jan 15, 2026").
   */
  function formatShortDate(dateStr) {
    if (!dateStr) return '—';
    try {
      return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
      });
    } catch (_) {
      return dateStr;
    }
  }

  /**
   * Format a number as USD currency (e.g. "$1,234").
   */
  function formatCurrency(value) {
    if (value == null || isNaN(value)) return '—';
    return '$' + Number(value).toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  }

  window.VRTUtils = { esc, escAttr, formatDate, formatShortDate, formatCurrency };
})();
