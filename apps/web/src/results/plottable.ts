/**
 * Which results can go on the map (T10, the GeoJSON arm).
 *
 * A result is plotted when its value is GeoJSON — a FeatureCollection, a
 * Feature, a bare geometry or a GeometryCollection — in longitude and
 * latitude, whether it is shown or is too large to show and offered as a
 * download. Recognised by what the value is, not by the media type the server
 * put on it: pygeoapi labels GeoJSON `application/geo+json`, ZOO's geometry
 * services send it as `application/json`, and either way it is the same
 * document. Nothing here knows a process.
 *
 * GeoJSON in a projected system — RD New's metres, most likely — is not
 * plotted: it would land nowhere near the map, and nothing here reprojects.
 * It stays in the result as JSON, and the result says why it is not on the
 * map.
 *
 * An image goes on the map when the same results carry exactly one image and
 * exactly one bounding box in CRS84: the box is taken as the image's extent.
 * That pairing is this client's reading. The standard has no way to say that
 * one output is the extent of another, so a process can only say so in its
 * descriptions, and a client can only infer it. With two images, or two
 * boxes, there is nothing to infer from, and nothing is placed.
 *
 * An output given by reference joins in once it is loaded (Task 8, T8): its
 * GeoJSON is plotted and its image placed by the same rules, on the same
 * path. Its `Content-Crs` comes first: EPSG:4326 is swapped back to longitude
 * first, and any other CRS is not plotted and says so as `projected`.
 */

import { CRS84 } from "../forms/crs.js";
import { shapesIn, type Shape } from "../forms/geojson.js";
import { isJsonArray, isJsonObject } from "../forms/json.js";
import type { RenderableResult } from "./renderable.js";

export type PlotStatus =
  | { readonly kind: "plotted"; readonly shapes: readonly Shape[] }
  /** GeoJSON, but its coordinates are outside longitude and latitude. */
  | { readonly kind: "projected" }
  /** Not GeoJSON, or GeoJSON with no geometry in it. */
  | { readonly kind: "not-geojson" };

function inDegrees(shape: Shape): boolean {
  const positions =
    shape.type === "Point"
      ? [shape.coordinates]
      : shape.type === "LineString"
        ? shape.coordinates
        : shape.coordinates.flat();
  return positions.every(([x = 0, y = 0]) => Math.abs(x) <= 180 && Math.abs(y) <= 90);
}

/** The JSON a result holds: shown, read and too large to show, or loaded from its reference. */
function jsonOf(result: RenderableResult): unknown {
  if (result.kind === "json") return result.value;
  if (result.kind === "download") return result.json;
  if (result.kind === "reference" && result.loaded?.outcome === "ok") return result.loaded.geojson;
  return undefined;
}

function swapped(position: readonly number[]): number[] {
  const [first = 0, second = 0, ...rest] = position;
  return [second, first, ...rest];
}

/** Latitude-first to longitude-first, as `forms/crs.ts` does the other way (Task 8, T5). */
export function swapAxes(shape: Shape): Shape {
  switch (shape.type) {
    case "Point":
      return { type: "Point", coordinates: swapped(shape.coordinates) };
    case "LineString":
      return { type: "LineString", coordinates: shape.coordinates.map(swapped) };
    case "Polygon":
      return { type: "Polygon", coordinates: shape.coordinates.map((ring) => ring.map(swapped)) };
  }
}

export function plotStatus(result: RenderableResult): PlotStatus {
  const value = jsonOf(result);
  if (value === undefined) return { kind: "not-geojson" };
  const shapes = shapesIn(value);
  if (shapes === undefined || shapes.length === 0) return { kind: "not-geojson" };
  const axes = result.kind === "reference" ? result.loaded?.axes : undefined;
  if (axes === "not-plotted") return { kind: "projected" };
  const placed = axes === "swapped" ? shapes.map(swapAxes) : shapes;
  if (!placed.every(inDegrees)) return { kind: "projected" };
  return { kind: "plotted", shapes: placed };
}

/** Every shape of every result that can be plotted, in output order. */
export function plottedShapes(results: readonly RenderableResult[]): readonly Shape[] {
  return results.flatMap((result) => {
    const status = plotStatus(result);
    return status.kind === "plotted" ? status.shapes : [];
  });
}

/** Image types a browser shows by itself, so a map can too. */
const MAP_IMAGE_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

/** The image a result holds, inline or loaded from its reference, when a browser shows it. */
export function shownImage(result: RenderableResult): Blob | undefined {
  if (result.kind === "download") {
    return result.mediaType !== undefined && MAP_IMAGE_TYPES.has(result.mediaType)
      ? result.blob
      : undefined;
  }
  if (result.kind === "reference" && result.loaded?.representation === "image") {
    const blob = result.loaded.blob;
    return blob !== undefined && MAP_IMAGE_TYPES.has(blob.type) ? blob : undefined;
  }
  return undefined;
}

export function isShownImage(result: RenderableResult): boolean {
  return shownImage(result) !== undefined;
}

/** West, south, east, north, from an OGC bbox object in CRS84, or undefined. */
export function crs84Box(value: unknown): readonly [number, number, number, number] | undefined {
  if (!isJsonObject(value)) return undefined;
  const crs = value["crs"];
  if (crs !== undefined && crs !== CRS84) return undefined;
  const box = value["bbox"];
  if (!isJsonArray(box) || box.length !== 4) return undefined;
  const [west, south, east, north] = box;
  if (
    typeof west !== "number" ||
    typeof south !== "number" ||
    typeof east !== "number" ||
    typeof north !== "number"
  ) {
    return undefined;
  }
  const inDegrees =
    [west, east].every((x) => Math.abs(x) <= 180) && [south, north].every((y) => Math.abs(y) <= 90);
  return inDegrees && west < east && south < north ? [west, south, east, north] : undefined;
}

export interface MapImage {
  /** The image's output id. */
  readonly outputId: string;
  /** The box's output id. */
  readonly bboxOutputId: string;
  readonly blob: Blob;
  /** West, south, east, north in CRS84. */
  readonly bounds: readonly [number, number, number, number];
}

/** The one image and the one box that places it, or undefined. See the module comment. */
export function mapImage(results: readonly RenderableResult[]): MapImage | undefined {
  const images = results.flatMap((result) => {
    const blob = shownImage(result);
    return blob === undefined ? [] : [{ outputId: result.outputId, blob }];
  });
  const boxes = results.flatMap((result) => {
    if (result.kind !== "json") return [];
    const bounds = crs84Box(result.value);
    return bounds === undefined ? [] : [{ outputId: result.outputId, bounds }];
  });
  const [image] = images;
  const [box] = boxes;
  if (images.length !== 1 || boxes.length !== 1 || image === undefined || box === undefined) {
    return undefined;
  }
  return {
    outputId: image.outputId,
    bboxOutputId: box.outputId,
    blob: image.blob,
    bounds: box.bounds,
  };
}
