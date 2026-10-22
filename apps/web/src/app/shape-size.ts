/**
 * How big a drawn or typed shape is, in the words a visitor can check a
 * process's limit against (#15): "About 3.7 km across", the longer side of
 * the shape's bounding box, measured on the earth.
 *
 * Only for showing beside the field. Nothing here reads a process's
 * description for its limits, and nothing is refused for its size: the
 * service decides that.
 */

/** A box in longitude and latitude, in degrees. */
export interface Extent {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

/** The earth's mean radius, in metres, as the haversine formula takes it. */
const EARTH_RADIUS_M = 6_371_008.8;

const radians = (degrees: number) => (degrees * Math.PI) / 180;

/** The distance between two points on the earth, in metres (haversine). */
export function distanceMetres(
  [lon1, lat1]: readonly [number, number],
  [lon2, lat2]: readonly [number, number],
): number {
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * The longer side of an extent, in metres: east to west along its middle
 * latitude, or south to north along its middle longitude.
 */
export function metresAcross(extent: Extent): number {
  const midLat = (extent.south + extent.north) / 2;
  const midLon = (extent.west + extent.east) / 2;
  const wide = distanceMetres([extent.west, midLat], [extent.east, midLat]);
  const high = distanceMetres([midLon, extent.south], [midLon, extent.north]);
  return Math.max(wide, high);
}

/** Whether a value is a position: two or more finite numbers, longitude first. */
function isPosition(value: unknown): value is readonly [number, number, ...number[]] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.every((item): item is number => typeof item === "number" && Number.isFinite(item))
  );
}

/** Every position in GeoJSON coordinates, however deeply nested. */
function positionsIn(coordinates: unknown, into: (readonly [number, number])[]): void {
  if (isPosition(coordinates)) {
    into.push([coordinates[0], coordinates[1]]);
    return;
  }
  if (Array.isArray(coordinates)) for (const item of coordinates) positionsIn(item, into);
}

/** Every position in a GeoJSON geometry, Feature or FeatureCollection. */
function positionsOf(geojson: unknown, into: (readonly [number, number])[]): void {
  if (typeof geojson !== "object" || geojson === null) return;
  const type: unknown = Reflect.get(geojson, "type");
  if (type === "FeatureCollection") {
    const features: unknown = Reflect.get(geojson, "features");
    if (Array.isArray(features)) for (const feature of features) positionsOf(feature, into);
  } else if (type === "Feature") {
    positionsOf(Reflect.get(geojson, "geometry"), into);
  } else if (type === "GeometryCollection") {
    const geometries: unknown = Reflect.get(geojson, "geometries");
    if (Array.isArray(geometries)) for (const geometry of geometries) positionsOf(geometry, into);
  } else if (typeof type === "string") {
    positionsIn(Reflect.get(geojson, "coordinates"), into);
  }
}

/**
 * The extent of GeoJSON in longitude and latitude, or undefined when it has
 * no position, or one outside longitude and latitude's ranges.
 */
export function extentOfGeoJson(geojson: unknown): Extent | undefined {
  const positions: (readonly [number, number])[] = [];
  positionsOf(geojson, positions);
  if (positions.length === 0) return undefined;
  const lons = positions.map(([lon]) => lon);
  const lats = positions.map(([, lat]) => lat);
  const extent = {
    west: Math.min(...lons),
    south: Math.min(...lats),
    east: Math.max(...lons),
    north: Math.max(...lats),
  };
  return isLonLat(extent) ? extent : undefined;
}

/**
 * The extent of a bounding box's numbers, longitude first, with or without
 * heights: `[minLon, minLat, maxLon, maxLat]` or
 * `[minLon, minLat, minH, maxLon, maxLat, maxH]`.
 */
export function extentOfBbox(coordinates: readonly number[]): Extent | undefined {
  if (!coordinates.every((value) => Number.isFinite(value))) return undefined;
  const [west, south, east, north] =
    coordinates.length === 6
      ? [coordinates[0], coordinates[1], coordinates[3], coordinates[4]]
      : coordinates.length === 4
        ? coordinates
        : [];
  if (west === undefined || south === undefined || east === undefined || north === undefined) {
    return undefined;
  }
  const extent = { west, south, east, north };
  return isLonLat(extent) ? extent : undefined;
}

function isLonLat(extent: Extent): boolean {
  return (
    extent.west >= -180 &&
    extent.east <= 180 &&
    extent.south >= -90 &&
    extent.north <= 90 &&
    extent.west <= extent.east &&
    extent.south <= extent.north
  );
}

/**
 * A size as a visitor reads it: "About 850 m across", "About 3.7 km across",
 * "About 120 km across". Undefined for no size at all: a single point.
 */
export function sizeLabel(metres: number): string | undefined {
  if (!Number.isFinite(metres) || metres < 1) return undefined;
  if (metres < 1000) {
    const rounded = metres < 100 ? Math.round(metres) : Math.round(metres / 10) * 10;
    // 995 m and up rounds to a kilometre: say it in kilometres.
    if (rounded < 1000) return `About ${String(rounded)} m across`;
  }
  const km = metres / 1000;
  const text = km < 100 ? km.toFixed(1).replace(/\.0$/, "") : String(Math.round(km));
  return `About ${text} km across`;
}

/** The size of GeoJSON text, as {@link sizeLabel} says it; undefined until it parses. */
export function sizeOfGeoJsonText(text: string): string | undefined {
  if (text.trim() === "") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const extent = extentOfGeoJson(parsed);
  return extent === undefined ? undefined : sizeLabel(metresAcross(extent));
}
