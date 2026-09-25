/**
 * Reading geometry out of GeoJSON: a file the user chose, or the text a
 * geometry field holds.
 *
 * Ported from Sam's `apps/web/src/map/geojson.ts` on
 * `feat/T3-prototype-interface-2`. It moved from the map binding to here
 * because the form field needs it (to load a file into a value) and the form
 * layer may not import the map. Two changes: it returns single shapes rather
 * than GeoJSON features, since that is all the drawing tools and the encoder
 * need, and it checks coordinates rather than trusting a cast, since the text
 * is the user's and the form layer never throws.
 *
 * It reads every geometry type rather than only the ones an input wants. Which
 * types an input accepts is the plan's knowledge, applied in `geometry.ts`.
 */

import { isJsonArray, isJsonObject } from "./json.js";

export type Position = readonly number[];

/** One drawable shape. Multi-geometries and collections are split into these. */
export type Shape =
  | { readonly type: "Point"; readonly coordinates: Position }
  | { readonly type: "LineString"; readonly coordinates: readonly Position[] }
  | { readonly type: "Polygon"; readonly coordinates: readonly (readonly Position[])[] };

export type ShapeType = Shape["type"];

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
  /** Every geometry found, split into single shapes, properties discarded. */
  readonly shapes: readonly Shape[];
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

function position(value: unknown): Position | undefined {
  if (!isJsonArray(value) || value.length < 2) return undefined;
  return value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
    ? (value as Position)
    : undefined;
}

function positions(value: unknown, minimum: number): readonly Position[] | undefined {
  if (!isJsonArray(value) || value.length < minimum) return undefined;
  const found = value.map(position);
  return found.every((entry) => entry !== undefined) ? found : undefined;
}

function rings(value: unknown): readonly (readonly Position[])[] | undefined {
  if (!isJsonArray(value) || value.length === 0) return undefined;
  const found = value.map((ring) => positions(ring, 4));
  return found.every((entry) => entry !== undefined) ? found : undefined;
}

/**
 * The single shapes in a geometry: a GeometryCollection is flattened and every
 * Multi* split into what it stands for. Drawing tools work one shape at a time,
 * and a MultiPolygon is several polygons sharing a feature rather than a
 * different kind of thing — so splitting loses nothing. A geometry whose
 * coordinates do not have its type's shape yields nothing.
 */
function shapesOfGeometry(geometry: unknown, depth = 0): Shape[] {
  if (!isJsonObject(geometry) || depth > 8) return [];
  const coordinates = geometry["coordinates"];
  const many = <T>(read: (value: unknown) => T | undefined): T[] =>
    isJsonArray(coordinates)
      ? coordinates.map(read).filter((entry): entry is T => entry !== undefined)
      : [];

  switch (geometry["type"]) {
    case "Point": {
      const point = position(coordinates);
      return point === undefined ? [] : [{ type: "Point", coordinates: point }];
    }
    case "LineString": {
      const line = positions(coordinates, 2);
      return line === undefined ? [] : [{ type: "LineString", coordinates: line }];
    }
    case "Polygon": {
      const polygon = rings(coordinates);
      return polygon === undefined ? [] : [{ type: "Polygon", coordinates: polygon }];
    }
    case "MultiPoint":
      return many(position).map((point) => ({ type: "Point", coordinates: point }));
    case "MultiLineString":
      return many((value) => positions(value, 2)).map((line) => ({
        type: "LineString",
        coordinates: line,
      }));
    case "MultiPolygon":
      return many(rings).map((polygon) => ({ type: "Polygon", coordinates: polygon }));
    case "GeometryCollection": {
      const geometries = geometry["geometries"];
      return isJsonArray(geometries)
        ? geometries.flatMap((inner) => shapesOfGeometry(inner, depth + 1))
        : [];
    }
    default:
      return [];
  }
}

const GEOMETRY_TYPES: ReadonlySet<unknown> = new Set([
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
  "GeometryCollection",
]);

/**
 * The shapes in a GeoJSON document, whatever it arrived as: a
 * FeatureCollection, a lone Feature, a bare geometry, or a GeometryCollection.
 * `undefined` means it was none of them.
 */
export function shapesIn(document: unknown): readonly Shape[] | undefined {
  if (!isJsonObject(document)) return undefined;
  const type = document["type"];

  if (type === "FeatureCollection") {
    const features = document["features"];
    if (!isJsonArray(features)) return undefined;
    return features.flatMap((feature) =>
      isJsonObject(feature) ? shapesOfGeometry(feature["geometry"]) : [],
    );
  }
  if (type === "Feature") return shapesOfGeometry(document["geometry"]);
  if (GEOMETRY_TYPES.has(type)) return shapesOfGeometry(document);
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
  if (!isJsonObject(document)) return undefined;
  const crs = document["crs"];
  const properties = isJsonObject(crs) ? crs["properties"] : undefined;
  const name = isJsonObject(properties) ? properties["name"] : undefined;
  if (typeof name !== "string" || /CRS84|4326/i.test(name)) return undefined;
  return name;
}

function* positionsOf(shape: Shape): Generator<Position> {
  switch (shape.type) {
    case "Point":
      yield shape.coordinates;
      return;
    case "LineString":
      yield* shape.coordinates;
      return;
    case "Polygon":
      for (const ring of shape.coordinates) yield* ring;
  }
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

  const shapes = shapesIn(document);
  if (shapes === undefined) {
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
  for (const shape of shapes) {
    for (const [x = 0, y = 0] of positionsOf(shape)) {
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

  if (shapes.length === 0) return reject("no-geometry", "That file contains no geometry.");
  return { ok: true, shapes };
}

/** A sentence saying what was loaded and what was left out, by type. */
export function describeLoad(used: number, ignored: Readonly<Record<string, number>>): string {
  const plural = (count: number, noun: string): string =>
    `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
  const loaded = `Loaded ${plural(used, "shape")}.`;
  const rest = Object.entries(ignored).map(([type, count]) => plural(count, type));
  return rest.length === 0 ? loaded : `${loaded} Ignored ${rest.join(", ")}.`;
}
