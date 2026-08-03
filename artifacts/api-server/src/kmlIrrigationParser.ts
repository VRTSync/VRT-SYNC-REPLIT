import { DOMParser } from "@xmldom/xmldom";
import { createHash } from "crypto";
import { CONTROLLER_COLORS } from "@workspace/leaflet-template";

export interface ParsedController {
  name: string;
  featureRef: string;
  lat: number | null;
  lng: number | null;
  controllerKey: string;
  controllerColor: string;
  totalDeclaredZones: number | null;
  zones: ParsedZone[];
}

export interface ParsedZone {
  name: string;
  featureRef: string;          // <placemarkId>#z<zoneNumber> for mapped; synthetic for unmapped
  lat: number | null;
  lng: number | null;
  controllerFeatureRef: string;
  controllerLabel: string;
  zoneNumber: number | null;
  zoneType: string | null;
  zoneLabelShort: string | null;
  valveBoxRef: string | null;   // KML placemark id of the valve box (null for unmapped)
  valveBoxLabel: string | null; // original placemark name (null for unmapped)
}

export interface ParsedSiblingAsset {
  name: string;
  featureRef: string;  // KML placemark id
  lat: number | null;
  lng: number | null;
  assetType: string;   // e.g. "isolation_valve", "quick_connect", "backflow", "splice"
  subLayerKey: string; // e.g. "isolation_valve", "quick_connect", "backflow", "wire_splice"
  folderName: string;
}

export interface IrrigationParseResult {
  controllers: ParsedController[];
  controllerGeojson: any;
  zoneGeojson: any;
  siblingAssets: ParsedSiblingAsset[];
  warnings: string[];
}

// Folder name → { assetType, subLayerKey }
const SIBLING_FOLDER_MAP: Record<string, { assetType: string; subLayerKey: string }> = {
  "gate valves":    { assetType: "isolation_valve", subLayerKey: "isolation_valve" },
  "quick connect":  { assetType: "quick_connect",   subLayerKey: "quick_connect" },
  "backflow":       { assetType: "backflow",         subLayerKey: "backflow" },
  "wire splices":   { assetType: "splice",           subLayerKey: "wire_splice" },
};

function classifyTopLevelFolder(folder: Element): "controller" | { assetType: string; subLayerKey: string } | "unknown" {
  const folderName = (getTextContent(folder, "name") || "").trim();
  const folderNameLower = folderName.toLowerCase();

  // Check if folder name indicates a controller/clock
  if (/controller|clock/i.test(folderName)) {
    return "controller";
  }

  // Check if it has a subfolder whose name includes "zone"
  const subFolders = getChildren(folder, "Folder");
  for (const sf of subFolders) {
    const sfName = (getTextContent(sf, "name") || "").toLowerCase();
    if (sfName.includes("zone")) {
      return "controller";
    }
  }

  // If it contains only placemarks at top level (no zone subfolders), check sibling map
  const mapped = SIBLING_FOLDER_MAP[folderNameLower];
  if (mapped) {
    return mapped;
  }

  // Unknown
  return "unknown";
}

export function parseIrrigationKml(kmlText: string, totalZonesOverride?: Record<string, number>): IrrigationParseResult {
  const doc = new DOMParser().parseFromString(kmlText, "text/xml");
  const warnings: string[] = [];
  const controllers: ParsedController[] = [];
  const siblingAssets: ParsedSiblingAsset[] = [];

  const styleMap = buildStyleMap(doc);

  const root = doc.documentElement;
  const topDocument = getFirstChild(root, "Document") || root;
  const topFolders = getChildren(topDocument, "Folder");

  let colorIndex = 0;

  for (const folder of topFolders) {
    const folderName = getTextContent(folder, "name") || "Unknown";
    const classification = classifyTopLevelFolder(folder);

    if (classification === "controller") {
      // Process as a controller folder
      const ctrl = processControllerFolder(folder, folderName, styleMap, colorIndex, warnings, totalZonesOverride);
      if (ctrl) {
        controllers.push(ctrl);
        colorIndex++;
      }
    } else if (classification === "unknown") {
      const directPlacemarks = getChildren(folder, "Placemark");
      warnings.push(`Unknown folder "${folderName}" with ${directPlacemarks.length} placemark(s) — not imported`);
    } else {
      // It's a sibling asset folder
      const { assetType, subLayerKey } = classification;
      const directPlacemarks = getChildren(folder, "Placemark");
      for (const pm of directPlacemarks) {
        const pmName = getTextContent(pm, "name") || folderName;
        const pmId = extractPlacemarkId(pm, pmName);
        const coords = extractPointCoords(pm);
        siblingAssets.push({
          name: pmName.trim(),
          featureRef: pmId,
          lat: coords.lat,
          lng: coords.lng,
          assetType,
          subLayerKey,
          folderName,
        });
      }
    }
  }

  const controllerGeojson = {
    type: "FeatureCollection",
    features: controllers.map((c) => ({
      type: "Feature",
      id: c.featureRef,
      properties: {
        featureId: c.featureRef,
        name: c.name,
        controllerKey: c.controllerKey,
        controllerColor: c.controllerColor,
        zoneCount: c.zones.filter(z => z.lat != null).length,
      },
      geometry: c.lat != null && c.lng != null
        ? { type: "Point", coordinates: [c.lng, c.lat] }
        : null,
    })),
  };

  // Only mapped zones (with coordinates) appear in the GeoJSON; unmapped are sync'd separately
  const mappedZones = controllers.flatMap((c) => c.zones.filter(z => z.lat != null));
  const zoneGeojson = {
    type: "FeatureCollection",
    features: mappedZones.map((z) => ({
      type: "Feature",
      id: z.featureRef,
      properties: {
        featureId: z.featureRef,
        name: z.name,
        controllerFeatureRef: z.controllerFeatureRef,
        controllerLabel: z.controllerLabel,
        zoneNumber: z.zoneNumber,
        zoneType: z.zoneType,
        zoneLabelShort: z.zoneLabelShort,
        valveBoxRef: z.valveBoxRef,
        valveBoxLabel: z.valveBoxLabel,
      },
      geometry: { type: "Point", coordinates: [z.lng!, z.lat!] },
    })),
  };

  return { controllers, controllerGeojson, zoneGeojson, siblingAssets, warnings };
}

function processControllerFolder(
  folder: Element,
  folderName: string,
  styleMap: Map<string, string>,
  colorIndex: number,
  warnings: string[],
  totalZonesOverride?: Record<string, number>,
): ParsedController | null {
  const directPlacemarks = getChildren(folder, "Placemark");
  const subFolders = getChildren(folder, "Folder");

  let controllerPlacemark: Element | null = null;
  let zonesFolder: Element | null = null;

  for (const pm of directPlacemarks) {
    const geomType = getPlacemarkGeomType(pm);
    if (geomType === "Point") {
      controllerPlacemark = pm;
      break;
    }
  }
  if (!controllerPlacemark && directPlacemarks.length > 0) {
    controllerPlacemark = directPlacemarks[0];
  }

  for (const sf of subFolders) {
    const sfName = (getTextContent(sf, "name") || "").toLowerCase();
    if (sfName.includes("zone")) {
      zonesFolder = sf;
      break;
    }
  }
  if (!zonesFolder && subFolders.length > 0) {
    zonesFolder = subFolders[0];
  }

  if (!controllerPlacemark) {
    warnings.push(`Controller folder "${folderName}" has no controller placemark`);
    return null;
  }

  const controllerName = getTextContent(controllerPlacemark, "name") || folderName;
  const controllerRef = extractPlacemarkId(controllerPlacemark, controllerName);
  const controllerCoords = extractPointCoords(controllerPlacemark);
  const controllerKey = parseControllerKey(controllerName);

  let controllerColor = extractPlacemarkColor(controllerPlacemark, styleMap);
  if (!controllerColor) {
    controllerColor = CONTROLLER_COLORS[colorIndex % CONTROLLER_COLORS.length];
  }

  // Parse "zones: N" from controller description
  let totalDeclaredZones: number | null = null;
  const descEl = controllerPlacemark.getElementsByTagName("description");
  if (descEl.length > 0) {
    const descText = descEl[0].textContent || "";
    const zonesMatch = descText.match(/zones?\s*:\s*(\d+)/i);
    if (zonesMatch) {
      totalDeclaredZones = parseInt(zonesMatch[1], 10);
    }
  }

  const zones: ParsedZone[] = [];
  const mappedZoneNumbers = new Set<number>();

  if (zonesFolder) {
    const zonePlacemarks = getChildren(zonesFolder, "Placemark");
    for (const zp of zonePlacemarks) {
      const zoneName = (getTextContent(zp, "name") || "Unknown zone").trim();
      const zoneRef = extractPlacemarkId(zp, zoneName);
      const zoneCoords = extractPointCoords(zp);
      const parsedZones = parseZoneNames(zoneName, zoneRef, warnings);

      for (const pz of parsedZones) {
        if (mappedZoneNumbers.has(pz.zoneNumber)) {
          warnings.push(`Duplicate zone number ${pz.zoneNumber} in controller "${controllerName}" — importing both`);
        }
        mappedZoneNumbers.add(pz.zoneNumber);

        zones.push({
          name: `Zone ${pz.zoneNumber}`,
          featureRef: `${zoneRef}#z${pz.zoneNumber}`,
          lat: zoneCoords.lat,
          lng: zoneCoords.lng,
          controllerFeatureRef: controllerRef,
          controllerLabel: controllerName,
          zoneNumber: pz.zoneNumber,
          zoneType: pz.zoneType,
          zoneLabelShort: `Zone ${pz.zoneNumber}`,
          valveBoxRef: zoneRef,
          valveBoxLabel: zoneName,
        });
      }
    }
  }

  // Determine total zones for unmapped generation
  const maxMapped = mappedZoneNumbers.size > 0 ? Math.max(...mappedZoneNumbers) : 0;

  // Check for override
  const overrideKey = controllerRef;
  let effectiveTotal = totalZonesOverride?.[overrideKey] ?? totalDeclaredZones ?? (maxMapped > 0 ? maxMapped : null);

  if (effectiveTotal != null) {
    // Warn about zones above total
    for (const n of mappedZoneNumbers) {
      if (n > effectiveTotal) {
        warnings.push(`Zone ${n} in controller "${controllerName}" exceeds declared total of ${effectiveTotal}`);
      }
    }
    // Generate unmapped zones
    for (let n = 1; n <= effectiveTotal; n++) {
      if (!mappedZoneNumbers.has(n)) {
        zones.push({
          name: `Zone ${n} (unmapped)`,
          featureRef: `${controllerRef}#unmapped#z${n}`,
          lat: null,
          lng: null,
          controllerFeatureRef: controllerRef,
          controllerLabel: controllerName,
          zoneNumber: n,
          zoneType: null,
          zoneLabelShort: `Zone ${n}`,
          valveBoxRef: null,
          valveBoxLabel: null,
        });
      }
    }
  }

  // Sort zones by number
  zones.sort((a, b) => (a.zoneNumber ?? 999) - (b.zoneNumber ?? 999));

  return {
    name: controllerName,
    featureRef: controllerRef,
    lat: controllerCoords.lat,
    lng: controllerCoords.lng,
    controllerKey,
    controllerColor,
    totalDeclaredZones: effectiveTotal,
    zones,
  };
}

export function parseZoneNames(
  name: string,
  placemarkId: string,
  warnings: string[],
): Array<{ zoneNumber: number; zoneType: string | null }> {
  // Strip leading "zone"/"zones" keyword
  const stripped = name.replace(/^zones?\s*/i, "").trim();

  // Split on "/"
  const segments = stripped.split("/");
  const results: Array<{ zoneNumber: number; zoneType: string | null }> = [];

  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed) continue;

    // Extract first integer
    const numMatch = trimmed.match(/^(\d+)/);
    if (!numMatch) {
      if (trimmed) {
        warnings.push(`Unparseable zone segment "${trimmed}" in placemark "${name}" — skipping`);
      }
      continue;
    }

    const zoneNumber = parseInt(numMatch[1], 10);
    const rest = trimmed.slice(numMatch[0].length).trim();
    const zoneType = cleanZoneType(rest);
    results.push({ zoneNumber, zoneType });
  }

  // Propagate the last non-null type to all preceding segments that have null type
  if (results.length > 1) {
    let lastType: string | null = null;
    for (let i = results.length - 1; i >= 0; i--) {
      if (results[i].zoneType != null) {
        lastType = results[i].zoneType;
        break;
      }
    }
    if (lastType) {
      for (const r of results) {
        if (r.zoneType == null) {
          r.zoneType = lastType;
        }
      }
    }
  }

  return results;
}

function cleanZoneType(raw: string): string | null {
  let s = raw
    .replace(/\(([^)]*)\)/g, "$1") // (pop ups) → pop ups
    .replace(/\)$/, "")             // trailing )
    .replace(/^\s*\(\s*/, "")       // leading (
    .trim();
  return s || null;
}

function buildStyleMap(doc: Document): Map<string, string> {
  const colorMap = new Map<string, string>();

  const styleMapElements = doc.getElementsByTagName("StyleMap");
  const styleMaps = new Map<string, string>();
  for (let i = 0; i < styleMapElements.length; i++) {
    const sm = styleMapElements[i];
    const smId = sm.getAttribute("id") || "";
    const pairs = getChildren(sm as unknown as Element, "Pair");
    for (const pair of pairs) {
      const key = getTextContent(pair, "key");
      if (key === "normal") {
        const styleUrl = getTextContent(pair, "styleUrl") || "";
        styleMaps.set(`#${smId}`, styleUrl);
      }
    }
  }

  const styleElements = doc.getElementsByTagName("Style");
  const styles = new Map<string, string>();
  for (let i = 0; i < styleElements.length; i++) {
    const s = styleElements[i];
    const sId = s.getAttribute("id") || "";

    const iconStyles = (s as unknown as Element).getElementsByTagName("IconStyle");
    if (iconStyles.length > 0) {
      const icons = iconStyles[0].getElementsByTagName("Icon");
      if (icons.length > 0) {
        const href = getTextContent(icons[0] as unknown as Element, "href") || "";
        const color = extractColorFromIconUrl(href);
        if (color) {
          styles.set(`#${sId}`, color);
        }
      }
    }
  }

  const cascadingStyleElements = doc.getElementsByTagName("CascadingStyle");
  for (let i = 0; i < cascadingStyleElements.length; i++) {
    const cs = cascadingStyleElements[i];
    const csId = cs.getAttribute("kml:id") || cs.getAttribute("id") || "";
    const iconStyles = cs.getElementsByTagName("IconStyle");
    if (iconStyles.length > 0) {
      const icons = iconStyles[0].getElementsByTagName("Icon");
      if (icons.length > 0) {
        const href = getTextContent(icons[0] as unknown as Element, "href") || "";
        const color = extractColorFromIconUrl(href);
        if (color) styles.set(`#${csId}`, color);
      }
    }
  }

  for (const [smKey, styleRef] of styleMaps) {
    const resolvedColor = styles.get(styleRef);
    if (resolvedColor) {
      colorMap.set(smKey, resolvedColor);
    }
  }

  for (const [sKey, color] of styles) {
    if (!colorMap.has(sKey)) {
      colorMap.set(sKey, color);
    }
  }

  return colorMap;
}

function extractColorFromIconUrl(href: string): string | null {
  const match = href.match(/[?&]color=([0-9a-fA-F]{3,8})/);
  if (match) return `#${match[1]}`;

  const kmlColorMatch = href.match(/color=([0-9a-fA-F]{8})/);
  if (kmlColorMatch) {
    const abgr = kmlColorMatch[1];
    const r = abgr.substring(6, 8);
    const g = abgr.substring(4, 6);
    const b = abgr.substring(2, 4);
    return `#${r}${g}${b}`;
  }

  return null;
}

function extractPlacemarkColor(pm: Element, styleMap: Map<string, string>): string | null {
  const styleUrl = getTextContent(pm, "styleUrl");
  if (styleUrl) {
    const color = styleMap.get(styleUrl);
    if (color) return color;

    const cleanRef = styleUrl.startsWith("#") ? styleUrl : `#${styleUrl}`;
    const color2 = styleMap.get(cleanRef);
    if (color2) return color2;
  }

  const styleElements = pm.getElementsByTagName("Style");
  if (styleElements.length > 0) {
    const iconStyles = styleElements[0].getElementsByTagName("IconStyle");
    if (iconStyles.length > 0) {
      const icons = iconStyles[0].getElementsByTagName("Icon");
      if (icons.length > 0) {
        const href = getTextContent(icons[0] as unknown as Element, "href") || "";
        const color = extractColorFromIconUrl(href);
        if (color) return color;
      }
    }
  }

  return null;
}

function extractPlacemarkId(pm: Element, fallbackName: string): string {
  const id = pm.getAttribute("id");
  if (id && id.trim()) return id.trim();

  const extData = pm.getElementsByTagName("ExtendedData");
  if (extData.length > 0) {
    const datas = extData[0].getElementsByTagName("Data");
    for (let i = 0; i < datas.length; i++) {
      const name = datas[i].getAttribute("name");
      if (name === "id" || name === "featureId") {
        const val = getTextContent(datas[i] as unknown as Element, "value");
        if (val) return val;
      }
    }
  }

  const coords = extractPointCoords(pm);
  const hashInput = `${fallbackName.toLowerCase()}|${coords.lat?.toFixed(6) || ""}|${coords.lng?.toFixed(6) || ""}`;
  const hash = createHash("sha1").update(hashInput).digest("hex").substring(0, 12);
  return `derived_${hash}`;
}

function extractPointCoords(pm: Element): { lat: number | null; lng: number | null } {
  const points = pm.getElementsByTagName("Point");
  if (points.length > 0) {
    const coordsText = getTextContent(points[0] as unknown as Element, "coordinates");
    if (coordsText) {
      const parts = coordsText.trim().split(",");
      if (parts.length >= 2) {
        const lng = parseFloat(parts[0]);
        const lat = parseFloat(parts[1]);
        if (!isNaN(lng) && !isNaN(lat)) return { lat, lng };
      }
    }
  }
  return { lat: null, lng: null };
}

function parseControllerKey(name: string): string {
  const match = name.match(/clock\s+([a-z0-9]+)/i);
  if (match) return match[1].toUpperCase();

  const letterMatch = name.match(/controller\s+([a-z0-9]+)/i);
  if (letterMatch) return letterMatch[1].toUpperCase();

  return name.trim();
}

function getFirstChild(el: Element, tagName: string): Element | null {
  const children = el.childNodes;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.nodeType === 1 && (child as Element).tagName === tagName) {
      return child as Element;
    }
  }
  return null;
}

function getChildren(el: Element, tagName: string): Element[] {
  const result: Element[] = [];
  const children = el.childNodes;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.nodeType === 1 && (child as Element).tagName === tagName) {
      result.push(child as Element);
    }
  }
  return result;
}

function getTextContent(el: Element, tagName: string): string | null {
  const child = getFirstChild(el, tagName);
  if (!child) return null;
  return child.textContent?.trim() || null;
}

function getPlacemarkGeomType(pm: Element): string | null {
  if (pm.getElementsByTagName("Point").length > 0) return "Point";
  if (pm.getElementsByTagName("LineString").length > 0) return "LineString";
  if (pm.getElementsByTagName("Polygon").length > 0) return "Polygon";
  return null;
}
