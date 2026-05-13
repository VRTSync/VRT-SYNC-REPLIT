/**
 * MC auto-label helpers.
 * All functions are pure and unit-testable.
 */

const PRETTY_LABELS: Record<string, string> = {
  controller: "Controller",
  zone: "Zone",
  tree: "Tree",
  backflow: "Backflow",
  pet_station: "Pet Station",
  master_valve: "Master Valve",
  flow_meter: "Flow Meter",
  quick_connect: "Quick Connect",
  isolation_valve: "Isolation Valve",
  landscape_bed: "Landscape Bed",
  bluegrass_area: "Bluegrass Area",
  native_area: "Native Area",
  snow_area: "Snow Area",
  pump: "Pump",
  qc_iso_valve: "QC/Iso Valve",
};

function prettyLabel(assetType: string): string {
  return PRETTY_LABELS[assetType] ?? assetType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Convert a 0-based controller count to the alphabetical key sequence:
 *   0 → A, 1 → B, …, 25 → Z, 26 → AA, 27 → AB, …
 */
export function indexToControllerKey(n: number): string {
  let result = "";
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
 *  - everything else → "<Pretty Label> 1", "<Pretty Label> 2", … (gap-filling)
 */
export function generateAutoLabel(opts: {
  assetType: string;
  existingLabels: string[];
}): string {
  const { assetType, existingLabels } = opts;

  if (assetType === "controller") {
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

  const prefix = prettyLabel(assetType) + " ";
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
