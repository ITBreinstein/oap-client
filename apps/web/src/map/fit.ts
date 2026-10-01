/**
 * Moving the map to some shapes: shared by drawing, which moves to a value set
 * from outside, and by shown shapes, which move to a new result.
 */

import type { Map as MapLibreMap } from "maplibre-gl";
import type { MapShape } from "./geometry-engine.js";

/**
 * West, south, east, north around every position, or undefined for none.
 *
 * A plain loop, never `Math.min(...xs)`: spreading an array into a call has a
 * hard limit (about 120 000 arguments in V8), and a GeoJSON result goes past
 * it long before it goes past the 8 MB the page reads (review W3).
 */
export function boundsOf(
  shapes: readonly MapShape[],
): [number, number, number, number] | undefined {
  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  const include = (position: readonly number[]) => {
    const [x, y] = position;
    if (x !== undefined && Number.isFinite(x)) {
      west = Math.min(west, x);
      east = Math.max(east, x);
    }
    if (y !== undefined && Number.isFinite(y)) {
      south = Math.min(south, y);
      north = Math.max(north, y);
    }
  };
  for (const shape of shapes) {
    if (shape.type === "Point") include(shape.coordinates);
    else if (shape.type === "LineString") shape.coordinates.forEach(include);
    else for (const ring of shape.coordinates) ring.forEach(include);
  }
  return west > east || south > north ? undefined : [west, south, east, north];
}

export function moveTo(map: MapLibreMap, shapes: readonly MapShape[]) {
  // All of it: moving the map is a courtesy, and nothing it can throw may
  // reach the effect that asked for it.
  try {
    const bounds = boundsOf(shapes);
    if (bounds === undefined) return;
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
