/**
 * Moving the map to some shapes: shared by drawing, which moves to a value set
 * from outside, and by shown shapes, which move to a new result.
 */

import type { Map as MapLibreMap } from "maplibre-gl";
import type { MapShape } from "./geometry-engine.js";

/** West, south, east, north around every position, or undefined for none. */
export function boundsOf(
  shapes: readonly MapShape[],
): [number, number, number, number] | undefined {
  const positions = shapes.flatMap((shape) =>
    shape.type === "Point"
      ? [shape.coordinates]
      : shape.type === "LineString"
        ? shape.coordinates
        : shape.coordinates.flat(),
  );
  const xs = positions.map((position) => position[0] ?? Number.NaN).filter(Number.isFinite);
  const ys = positions.map((position) => position[1] ?? Number.NaN).filter(Number.isFinite);
  if (xs.length === 0 || ys.length === 0) return undefined;
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

export function moveTo(map: MapLibreMap, shapes: readonly MapShape[]) {
  const bounds = boundsOf(shapes);
  if (bounds === undefined) return;
  try {
    // maxZoom stops a single point filling the screen at street level.
    map.fitBounds(
      [
        [bounds[0], bounds[1]],
        [bounds[2], bounds[3]],
      ],
      { padding: 40, maxZoom: 16, animate: false },
    );
  } catch {
    // A map that cannot move still shows the shapes.
  }
}
