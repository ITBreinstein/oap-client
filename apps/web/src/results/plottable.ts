/**
 * Which results can go on the map (T10, the GeoJSON arm).
 *
 * A result is plotted when its value is GeoJSON — a FeatureCollection, a
 * Feature, a bare geometry or a GeometryCollection — in longitude and
 * latitude. Recognised by what the value is, not by the media type the server
 * put on it: pygeoapi labels GeoJSON `application/geo+json`, ZOO's geometry
 * services send it as `application/json`, and either way it is the same
 * document. Nothing here knows a process.
 *
 * GeoJSON in a projected system — RD New's metres, most likely — is not
 * plotted: it would land nowhere near the map, and nothing here reprojects.
 * It stays in the result as JSON, and the result says why it is not on the
 * map.
 */

import { shapesIn, type Shape } from "../forms/geojson.js";
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

export function plotStatus(result: RenderableResult): PlotStatus {
  if (result.kind !== "json") return { kind: "not-geojson" };
  const shapes = shapesIn(result.value);
  if (shapes === undefined || shapes.length === 0) return { kind: "not-geojson" };
  if (!shapes.every(inDegrees)) return { kind: "projected" };
  return { kind: "plotted", shapes };
}

/** Every shape of every result that can be plotted, in output order. */
export function plottedShapes(results: readonly RenderableResult[]): readonly Shape[] {
  return results.flatMap((result) => {
    const status = plotStatus(result);
    return status.kind === "plotted" ? status.shapes : [];
  });
}
