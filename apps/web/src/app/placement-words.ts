/**
 * What the result screen says about where a GeoJSON result went on the map,
 * and why not when it did not (#F1). One place for both kinds of result, a
 * value and an output loaded from its reference.
 */

import type { Placement } from "../results/crs.js";
import type { PlotStatus } from "../results/plottable.js";

const NAMES: Readonly<Record<string, string>> = {
  "EPSG:28992": "RD New (EPSG:28992)",
  "EPSG:4326": "EPSG:4326",
  CRS84: "CRS84",
};

/**
 * The sentence after "shown on the map", or instead of it; undefined when
 * there is nothing more to say: plotted as sent, too many to draw (said
 * elsewhere), or not GeoJSON at all.
 */
export function placementWords(
  status: PlotStatus,
  placement: Placement | undefined,
): string | undefined {
  switch (status.kind) {
    case "plotted":
      if (placement?.kind === "reprojected") {
        return `Its coordinates are in ${NAMES[placement.crs] ?? placement.crs}, as its Content-Crs says: reprojected to longitude and latitude to put it on the map.`;
      }
      if (placement?.kind === "swapped") {
        return "Its Content-Crs is EPSG:4326, latitude first: its axes were swapped to put it on the map.";
      }
      return undefined;
    case "crs-unstated":
      return "GeoJSON, but its coordinates are not longitude and latitude, and the service didn't say which coordinate system they are in, so it is not shown on the map.";
    case "projected":
      if (placement?.kind === "other") {
        return `GeoJSON in ${placement.uri}, a coordinate system this page does not put on a map, so it is not shown there.`;
      }
      if (placement !== undefined && placement.kind !== "as-sent") {
        return `GeoJSON whose coordinates are not where its Content-Crs, ${placement.uri}, would put them, so it is not shown on the map.`;
      }
      return "GeoJSON, but not in a coordinate system this page puts on a map, so it is not shown there.";
    case "too-many":
    case "not-geojson":
      return undefined;
  }
}
