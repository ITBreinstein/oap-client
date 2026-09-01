import type { Feature, Geometry, Position } from "geojson";

/**
 * Reading geometry out of a GeoJSON file the user chose.
 *
 * Deliberately free of MapLibre, terra-draw and the DOM: this is the half of
 * uploading that can be tested without a WebGL context, and it is where the
 * decisions worth reviewing live. Loading the result onto a map is separate.
 *
 * It reads every geometry type rather than only the one the caller wants.
 * Which types an input accepts is the caller's knowledge — today a
 * polygon-only map, later whatever the process description turns out to say —
 * and a reader that decided it here would have to be rewritten to find out.
 */

/** Why a file could not be used at all. */
export type RejectionCode =
  /** Larger than this reader will attempt. */
  | "too-large"
  /** Not JSON. */
  | "not-json"
  /** JSON, but not a GeoJSON object this reader recognises. */
  | "not-geojson"
  /** Coordinates outside the range degrees can occupy — a projected system. */
  | "projected-coordinates"
  /** Valid GeoJSON, but carrying no geometry at all. */
  | "no-geometry";

export interface GeoJsonRejected {
  readonly ok: false;
  readonly code: RejectionCode;
  /** Wording intended to be shown to the user as-is. */
  readonly message: string;
}

export interface GeoJsonAccepted {
  readonly ok: true;
  /** Every geometry found, each as its own feature, properties discarded. */
  readonly features: readonly Feature[];
}

export type GeoJsonReadResult = GeoJsonAccepted | GeoJsonRejected;

/**
 * Files above this are refused rather than parsed. A large collection will
 * freeze the tab for long enough to look like a crash, and a geometry input is
 * not the place it belongs anyway.
 */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

function reject(code: RejectionCode, message: string): GeoJsonRejected {
  return { ok: false, code, message };
}

/** Every position in a geometry, including nested geometry collections. */
function* positionsOf(geometry: Geometry): Generator<Position> {
  if (geometry.type === "GeometryCollection") {
    for (const inner of geometry.geometries) yield* positionsOf(inner);
    return;
  }

  // Coordinates nest to a different depth per geometry type; recursing to the
  // first number avoids a branch for each one.
  const walk = function* (value: unknown): Generator<Position> {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === "number") {
      yield value as Position;
      return;
    }
    for (const inner of value) yield* walk(inner);
  };

  yield* walk(geometry.coordinates);
}

/**
 * Flattens a GeometryCollection, and splits every Multi* geometry into the
 * single geometries it stands for.
 *
 * Drawing tools work one shape at a time, and a MultiPolygon is several
 * polygons sharing a feature rather than a different kind of thing — so
 * splitting loses nothing and spares every caller the same unpacking.
 */
function* singleGeometriesOf(geometry: Geometry): Generator<Geometry> {
  switch (geometry.type) {
    case "GeometryCollection":
      for (const inner of geometry.geometries) yield* singleGeometriesOf(inner);
      return;
    case "MultiPoint":
      for (const coordinates of geometry.coordinates) yield { type: "Point", coordinates };
      return;
    case "MultiLineString":
      for (const coordinates of geometry.coordinates) yield { type: "LineString", coordinates };
      return;
    case "MultiPolygon":
      for (const coordinates of geometry.coordinates) yield { type: "Polygon", coordinates };
      return;
    case "Point":
    case "LineString":
    case "Polygon":
      yield geometry;
  }
}

/**
 * The geometries in a GeoJSON document, whatever shape it arrived in.
 *
 * All four are files somebody will hand you: a FeatureCollection, a lone
 * Feature, a bare geometry, or a GeometryCollection. `undefined` means it was
 * none of them.
 */
function geometriesIn(document: unknown): Geometry[] | undefined {
  if (typeof document !== "object" || document === null) return undefined;
  const node = document as { type?: unknown; features?: unknown; geometry?: unknown };

  if (node.type === "FeatureCollection") {
    if (!Array.isArray(node.features)) return undefined;
    return node.features.flatMap((feature: unknown) => {
      const geometry = (feature as { geometry?: Geometry | null } | null)?.geometry;
      return geometry ? [...singleGeometriesOf(geometry)] : [];
    });
  }

  if (node.type === "Feature") {
    const geometry = node.geometry as Geometry | null;
    return geometry ? [...singleGeometriesOf(geometry)] : [];
  }

  if (
    node.type === "GeometryCollection" ||
    (typeof node.type === "string" && "coordinates" in node)
  )
    return [...singleGeometriesOf(document as Geometry)];

  return undefined;
}

/**
 * A `crs` member naming anything other than WGS 84.
 *
 * RFC 7946 dropped `crs` and fixed GeoJSON to WGS 84, but files written against
 * the 2008 spec still carry it — and in the Netherlands it usually names RD
 * New. Where present it is a more precise signal than the coordinate range.
 */
function declaredCrs(document: unknown): string | undefined {
  const crs = (document as { crs?: { properties?: { name?: unknown } } } | null)?.crs;
  const name = crs?.properties?.name;
  if (typeof name !== "string" || /CRS84|4326/i.test(name)) return undefined;
  return name;
}

/** Reads the geometry out of GeoJSON text. */
export function readGeoJson(text: string): GeoJsonReadResult {
  if (text.length > MAX_FILE_BYTES) {
    return reject("too-large", "That file is larger than 10 MB, so it was not opened.");
  }

  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    return reject("not-json", "That file is not valid JSON.");
  }

  const geometries = geometriesIn(document);
  if (geometries === undefined) {
    return reject(
      "not-geojson",
      "That file is JSON, but not a GeoJSON feature collection, feature or geometry.",
    );
  }

  const named = declaredCrs(document);
  if (named !== undefined) {
    return reject(
      "projected-coordinates",
      `That file declares the coordinate system ${named}. GeoJSON must be WGS 84 — ` +
        "reproject it and try again.",
    );
  }

  // Degrees only reach 180 and 90. Anything beyond is a projected system, and
  // in Dutch data that is almost always RD New — metres, not degrees, which
  // would load without complaint and render nowhere near the map.
  for (const geometry of geometries) {
    for (const position of positionsOf(geometry)) {
      const [x = 0, y = 0] = position;
      if (Math.abs(x) > 180 || Math.abs(y) > 90) {
        return reject(
          "projected-coordinates",
          "That file's coordinates are outside the range of longitude and latitude, so it " +
            "is projected rather than WGS 84 — RD New (EPSG:28992) most likely. Reproject " +
            "it and try again.",
        );
      }
    }
  }

  if (geometries.length === 0) return reject("no-geometry", "That file contains no geometry.");

  return {
    ok: true,
    features: geometries.map((geometry) => ({ type: "Feature", geometry, properties: {} })),
  };
}

/**
 * Splits what was read into the types a caller can use and the rest.
 *
 * The counts are for telling the user what happened to the remainder: silently
 * discarding half a file is how someone spends ten minutes hunting for data
 * that was never loaded.
 */
export function partitionByType(
  features: readonly Feature[],
  accepted: readonly Geometry["type"][],
): { readonly usable: readonly Feature[]; readonly ignored: Readonly<Record<string, number>> } {
  const usable: Feature[] = [];
  const ignored: Record<string, number> = {};

  for (const feature of features) {
    const type = feature.geometry.type;
    if (accepted.includes(type)) usable.push(feature);
    else ignored[type] = (ignored[type] ?? 0) + 1;
  }

  return { usable, ignored };
}

/** A sentence describing what was loaded and what was left out. */
export function describeLoad(
  usable: readonly Feature[],
  ignored: Readonly<Record<string, number>>,
): string {
  const plural = (count: number, noun: string): string =>
    `${String(count)} ${noun}${count === 1 ? "" : "s"}`;

  const loaded = `Loaded ${plural(usable.length, "shape")}.`;
  const rest = Object.entries(ignored).map(([type, count]) => plural(count, type));
  return rest.length === 0 ? loaded : `${loaded} Ignored ${rest.join(", ")}.`;
}
