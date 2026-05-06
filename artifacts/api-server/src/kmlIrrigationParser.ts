import { DOMParser } from "@xmldom/xmldom";
import { createHash } from "crypto";

export interface ParsedController {
  name: string;
  featureRef: string;
  lat: number | null;
  lng: number | null;
  controllerKey: string;
  controllerColor: string;
  zones: ParsedZone[];
}

export interface ParsedZone {
  name: string;
  featureRef: string;
  lat: number | null;
  lng: number | null;
  controllerFeatureRef: string;
  controllerLabel: string;
  zoneNumber: number | null;
  zoneType: string | null;
  zoneLabelShort: string | null;
}

export interface IrrigationParseResult {
  controllers: ParsedController[];
  controllerGeojson: any;
  zoneGeojson: any;
  warnings: string[];
}

const DEFAULT_COLORS = [
  "#ffa726", "#42a5f5", "#66bb6a", "#ef5350", "#ab47bc",
  "#26c6da", "#ffca28", "#8d6e63", "#78909c", "#ec407a",
  "#7e57c2", "#26a69a", "#d4e157", "#ff7043", "#5c6bc0",
];

export function parseIrrigationKml(kmlText: string): IrrigationParseResult {
  const doc = new DOMParser().parseFromString(kmlText, "text/xml");
  const warnings: string[] = [];
  const controllers: ParsedController[] = [];

  const styleMap = buildStyleMap(doc);

  const root = doc.documentElement;
  const topDocument = getFirstChild(root, "Document") || root;
  const topFolders = getChildren(topDocument, "Folder");

  let colorIndex = 0;

  for (const folder of topFolders) {
    const folderName = getTextContent(folder, "name") || "Unknown Controller";

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
      if (zonesFolder) {
        const zonePlacemarks = getChildren(zonesFolder, "Placemark");
        for (const zp of zonePlacemarks) {
          const zpName = getTextContent(zp, "name") || "Unknown zone";
          warnings.push(`Zone "${zpName}" in folder "${folderName}" has no parent controller`);
        }
      }
      continue;
    }

    const controllerName = getTextContent(controllerPlacemark, "name") || folderName;
    const controllerRef = extractPlacemarkId(controllerPlacemark, controllerName);
    const controllerCoords = extractPointCoords(controllerPlacemark);
    const controllerKey = parseControllerKey(controllerName);

    let controllerColor = extractPlacemarkColor(controllerPlacemark, styleMap);
    if (!controllerColor) {
      controllerColor = DEFAULT_COLORS[colorIndex % DEFAULT_COLORS.length];
      colorIndex++;
    }

    const zones: ParsedZone[] = [];

    if (zonesFolder) {
      const zonePlacemarks = getChildren(zonesFolder, "Placemark");
      for (const zp of zonePlacemarks) {
        const zoneName = getTextContent(zp, "name") || "Unknown zone";
        const zoneRef = extractPlacemarkId(zp, zoneName);
        const zoneCoords = extractPointCoords(zp);
        const parsed = parseZoneName(zoneName);

        zones.push({
          name: zoneName,
          featureRef: zoneRef,
          lat: zoneCoords.lat,
          lng: zoneCoords.lng,
          controllerFeatureRef: controllerRef,
          controllerLabel: controllerName,
          zoneNumber: parsed.zoneNumber,
          zoneType: parsed.zoneType,
          zoneLabelShort: parsed.zoneNumber != null ? `Zone ${parsed.zoneNumber}` : null,
        });
      }
    }

    controllers.push({
      name: controllerName,
      featureRef: controllerRef,
      lat: controllerCoords.lat,
      lng: controllerCoords.lng,
      controllerKey,
      controllerColor,
      zones,
    });
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
        zoneCount: c.zones.length,
      },
      geometry: c.lat != null && c.lng != null
        ? { type: "Point", coordinates: [c.lng, c.lat] }
        : null,
    })),
  };

  const allZones = controllers.flatMap((c) => c.zones);
  const zoneGeojson = {
    type: "FeatureCollection",
    features: allZones.map((z) => ({
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
      },
      geometry: z.lat != null && z.lng != null
        ? { type: "Point", coordinates: [z.lng, z.lat] }
        : null,
    })),
  };

  return { controllers, controllerGeojson, zoneGeojson, warnings };
}

function buildStyleMap(doc: Document): Map<string, string> {
  const colorMap = new Map<string, string>();

  const allElements = doc.getElementsByTagName("*");

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

    const cascadingStyles = (s as unknown as Element).getElementsByTagName("IconStyle");
    for (let j = 0; j < cascadingStyles.length; j++) {
      const cs = cascadingStyles[j];
      const csIcons = cs.getElementsByTagName("Icon");
      if (csIcons.length > 0) {
        const href = getTextContent(csIcons[0] as unknown as Element, "href") || "";
        const color = extractColorFromIconUrl(href);
        if (color) styles.set(`#${sId}`, color);
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

function parseZoneName(name: string): { zoneNumber: number | null; zoneType: string | null } {
  const match = name.match(/zone\s+(\d+)\s*(.*)/i);
  if (match) {
    const zoneNumber = parseInt(match[1], 10);
    const zoneType = match[2].trim() || null;
    return { zoneNumber: isNaN(zoneNumber) ? null : zoneNumber, zoneType };
  }
  return { zoneNumber: null, zoneType: null };
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
