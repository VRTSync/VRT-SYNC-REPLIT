/**
 * MC auto-label helpers.
 * All functions are pure and unit-testable.
 */

/**
 * Derives a human-readable label from an asset type key.
 * Works for any key, including future types not in the static list:
 *   "parking_sweep" → "Parking Sweep"
 *   "backflow"      → "Backflow"
 *   "snow_area"     → "Snow Area"
 *
 * Callers may pass an optional resolved label from the API catalogue to
 * override this derivation.
 */
export function prettyLabel(assetType: string, resolvedLabel?: string): string {
  if (resolvedLabel) return resolvedLabel;
  return assetType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Convert a 0-based controller count to the alphabetical key sequence:
 *   0 → A, 1 → B, …, 25 → Z, 26 → AA, 27 → AB, …
 */
export function indexToControllerKey(n: number): string {
  let result = '';
  let i = n;
  do {
    result = String.fromCharCode(65 + (i % 26)) + result;
    i = Math.floor(i / 26) - 1;
  } while (i >= 0);
  return result;
}

/**
 * Extract the controller key from a label like "Controller A" or "Controller AA".
 * Returns null if it doesn't match the pattern.
 */
function extractControllerKey(label: string): string | null {
  const m = label.match(/^Controller\s+([A-Z]+)$/i);
  return m ? m[1].toUpperCase() : null;
}

/**
 * Generate the next auto-label for a new asset given the list of already-existing
 * labels for this community.
 *
 * Rules:
 *  - `controller` → "Controller A", "Controller B", … "Controller Z", "Controller AA", …
 *  - everything else → "<Display Name> 1", "<Display Name> 2", … (gap-filling)
 *    Display name comes from ASSET_FIELD_TEMPLATES[assetType].displayName, falling
 *    back to title-casing the raw key for unknown types.
 */
export function generateAutoLabel(opts: {
  assetType: string;
  existingLabels: string[];
  /** Optional resolved label from the asset_types catalogue for unknown types. */
  resolvedLabel?: string;
}): string {
  const { assetType, existingLabels } = opts;

  if (assetType === 'controller') {
    const usedKeys = new Set(
      existingLabels
        .map(extractControllerKey)
        .filter((k): k is string => k !== null)
    );
    let idx = 0;
    while (usedKeys.has(indexToControllerKey(idx))) {
      idx++;
    }
    return `Controller ${indexToControllerKey(idx)}`;
  }

  const prefix = prettyLabel(assetType, opts.resolvedLabel) + ' ';
  const usedNums = new Set<number>();
  for (const l of existingLabels) {
    if (l.startsWith(prefix)) {
      const rest = l.slice(prefix.length);
      const n = parseInt(rest, 10);
      if (!isNaN(n) && String(n) === rest) usedNums.add(n);
    }
  }
  let n = 1;
  while (usedNums.has(n)) n++;
  return `${prefix}${n}`;
}

/**
 * Compute the next zone label and zone number for a zone being added to a
 * specific controller.
 *
 * @param parentControllerKey   e.g. "A" or "AA"
 * @param existingZoneNumbers   zone numbers already used on this controller
 */
export function generateZoneLabel(opts: {
  parentControllerKey: string;
  existingZoneNumbers: number[];
}): { label: string; zoneNumber: number } {
  const { existingZoneNumbers } = opts;
  const zoneNumber =
    existingZoneNumbers.length === 0
      ? 1
      : Math.max(0, ...existingZoneNumbers) + 1;
  return { label: `Zone ${zoneNumber}`, zoneNumber };
}
