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
 * GeoJSON in a projected system the result does not name — RD New's metres,
 * most likely — is not plotted: it would land nowhere near the map, and its
 * system is not guessed from its numbers. It stays in the result as JSON, and
 * the result says why it is not on the map.
 *
 * An image goes on the map when the same results carry exactly one image and
 * exactly one bounding box in CRS84: the box is taken as the image's extent.
 * That pairing is this client's reading. The standard has no way to say that
 * one output is the extent of another, so a process can only say so in its
 * descriptions, and a client can only infer it. With two images, or two
 * boxes, there is nothing to infer from, and nothing is placed.
 *
 * A result with more positions than the page is configured to draw
 * (`config.json`, `map.maxCoordinates`) is not plotted either, and says so as
 * `too-many`: the numbers are still in the result, and its download is the
 * way to them (review W3).
 *
 * An output given by reference joins in once it is loaded (Task 8, T8): its
 * GeoJSON is plotted and its image placed by the same rules, on the same
 * path.
 *
 * A `Content-Crs` comes first, on a reference's answer or on a response whose
 * body is one output's value (#F1, `crs.ts`): CRS84 as it is, EPSG:4326
 * swapped back to longitude first, EPSG:28992 reprojected, and any other CRS
 * not plotted, said as `projected`. With no CRS named, numbers that are not
 * longitude and latitude are not plotted either, and the result says the
 * service did not say which system they are in (`crs-unstated`).
 */

import { CRS84 } from "../forms/crs.js";
import { shapesWithOriginIn, type Shape, type ShapeOrigin } from "../forms/geojson.js";
import { isJsonArray, isJsonObject } from "../forms/json.js";
import type { Placement } from "./crs.js";
import type { RenderableResult } from "./renderable.js";

export type PlotStatus =
  | {
      readonly kind: "plotted";
      readonly shapes: readonly Shape[];
      /** Where each shape came from, by index into `shapes`. */
      readonly origins: readonly ShapeOrigin[];
    }
  /** GeoJSON in a coordinate system the result names and this page does not place. */
  | { readonly kind: "projected" }
  /**
   * GeoJSON whose numbers are not longitude and latitude, from a service that
   * did not say which system they are in (#F1). Never guessed from their size.
   */
  | { readonly kind: "crs-unstated" }
  /** Plottable, but with more positions than the page draws. */
  | { readonly kind: "too-many"; readonly positions: number; readonly limit: number }
  /** Not GeoJSON, or GeoJSON with no geometry in it. */
  | { readonly kind: "not-geojson" };

/** How many positions the shapes hold: what drawing them costs. */
export function positionCount(shapes: readonly Shape[]): number {
  let count = 0;
  for (const shape of shapes) {
    if (shape.type === "Point") count += 1;
    else if (shape.type === "LineString") count += shape.coordinates.length;
    else for (const ring of shape.coordinates) count += ring.length;
  }
  return count;
}

function inDegrees(shape: Shape): boolean {
  const positions =
    shape.type === "Point"
      ? [shape.coordinates]
      : shape.type === "LineString"
        ? shape.coordinates
        : shape.coordinates.flat();
  return positions.every(([x = 0, y = 0]) => Math.abs(x) <= 180 && Math.abs(y) <= 90);
}

/** GML or KML the result was read as, when it was read (#F4, #F5). */
function geoOf(result: RenderableResult) {
  if (result.kind === "text" || result.kind === "download") {
    return result.geo?.ok === true ? result.geo : undefined;
  }
  if (result.kind === "reference" && result.loaded?.outcome === "ok") {
    return result.loaded.geo?.ok === true ? result.loaded.geo : undefined;
  }
  return undefined;
}

/**
 * The GeoJSON a result holds: shown, read and too large to show, loaded from
 * its reference, or read from GML or KML (#F4, #F5).
 */
function jsonOf(result: RenderableResult): unknown {
  const geo = geoOf(result);
  if (geo !== undefined) return geo.geojson;
  if (result.kind === "json") return result.value;
  if (result.kind === "download") return result.json;
  if (result.kind === "reference" && result.loaded?.outcome === "ok") return result.loaded.geojson;
  return undefined;
}

/**
 * Where the result's GeoJSON goes, from the CRS it named (#F1) or its GML
 * `srsName` or KML; undefined when it named none.
 */
export function placementOf(result: RenderableResult): Placement | undefined {
  const geo = geoOf(result);
  if (geo !== undefined) return geo.placement;
  if (result.kind === "json" || result.kind === "download") return result.placement;
  if (result.kind === "reference") return result.loaded?.placement;
  return undefined;
}

/** `limit`: the most positions the map may be given for one result. */
export function plotStatus(
  result: RenderableResult,
  limit: number = Number.POSITIVE_INFINITY,
): PlotStatus {
  const sent = jsonOf(result);
  if (sent === undefined) return { kind: "not-geojson" };
  // The shapes are read from the value in CRS84 when the result named a CRS
  // this page places: swapped or reprojected already, in `crs.ts`. The value
  // shown stays the server's.
  const placement = placementOf(result);
  if (placement?.kind === "other") {
    return shapesWithOriginIn(sent)?.length ? { kind: "projected" } : { kind: "not-geojson" };
  }
  // GML with no srsName: never placed, whatever its numbers (#F4).
  if (placement?.kind === "unstated") {
    return shapesWithOriginIn(sent)?.length ? { kind: "crs-unstated" } : { kind: "not-geojson" };
  }
  const value = placement === undefined || placement.kind === "as-sent" ? sent : placement.value;
  const found = shapesWithOriginIn(value);
  if (found === undefined || found.length === 0) return { kind: "not-geojson" };
  const placed = found.map((entry) => entry.shape);
  if (!placed.every(inDegrees)) {
    // A named system that still is not in degrees is not where it says it is.
    return placement === undefined || placement.kind === "as-sent"
      ? { kind: "crs-unstated" }
      : { kind: "projected" };
  }
  const positions = positionCount(placed);
  if (positions > limit) return { kind: "too-many", positions, limit };
  return { kind: "plotted", shapes: placed, origins: found.map((entry) => entry.origin) };
}

/** One shape on the map, and what a click on it shows (package 5). */
export interface PlottedFeature {
  readonly outputId: string;
  readonly shape: Shape;
  readonly origin: ShapeOrigin;
}

/** Every shape of every result that can be plotted, in output order, with its feature. */
export function plottedFeatures(
  results: readonly RenderableResult[],
  limit: number = Number.POSITIVE_INFINITY,
): readonly PlottedFeature[] {
  return results.flatMap((result) => {
    const status = plotStatus(result, limit);
    if (status.kind !== "plotted") return [];
    return status.shapes.map((shape, index) => ({
      outputId: result.outputId,
      shape,
      origin: status.origins[index] ?? { kind: "bare-geometry" },
    }));
  });
}

/** Every shape of every result that can be plotted, in output order. */
export function plottedShapes(
  results: readonly RenderableResult[],
  limit: number = Number.POSITIVE_INFINITY,
): readonly Shape[] {
  return plottedFeatures(results, limit).map((feature) => feature.shape);
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
