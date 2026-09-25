/**
 * A bounding box as the map binding knows it: four numbers, longitude first.
 *
 * `[minX, minY, maxX, maxY]` in CRS84 — west, south, east, north. The binding
 * knows geometry and nothing about the protocol: which CRS the server wants,
 * and whether that means swapping axes, is the form's business (T9).
 */

export type Bbox = readonly [number, number, number, number];

/** The box around a ring of `[lon, lat]` positions, or undefined for no usable position. */
export function bboxOfRing(ring: readonly (readonly number[])[]): Bbox | undefined {
  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  for (const [lon, lat] of ring) {
    if (lon === undefined || lat === undefined || !Number.isFinite(lon) || !Number.isFinite(lat)) {
      continue;
    }
    west = Math.min(west, lon);
    south = Math.min(south, lat);
    east = Math.max(east, lon);
    north = Math.max(north, lat);
  }
  return Number.isFinite(west) ? [west, south, east, north] : undefined;
}

/** A closed rectangle ring, counter-clockwise from the south-west corner. */
export function ringOfBbox([west, south, east, north]: Bbox): number[][] {
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
}

/** Six decimals: about 0.1 m, and short enough to read in a form. */
export function roundBbox(bbox: Bbox): Bbox {
  const round = (value: number) => Math.round(value * 1e6) / 1e6;
  return [round(bbox[0]), round(bbox[1]), round(bbox[2]), round(bbox[3])];
}

export function sameBbox(a: Bbox | undefined, b: Bbox | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.every((value, index) => Math.abs(value - (b[index] ?? Number.NaN)) < 1e-9);
}
