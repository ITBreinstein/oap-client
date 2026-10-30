/**
 * What the result screen says about where a GeoJSON, GML or KML result went on
 * the map, and why not when it did not (#F1, #F4, #F5). One place for every
 * kind of result: a value, an output loaded from its reference, and GML or KML
 * read for the map.
 */

import type { Placement } from "../results/crs.js";
import type { PlotStatus } from "../results/plottable.js";

const NAMES: Readonly<Record<string, string>> = {
  "EPSG:28992": "RD New (EPSG:28992)",
  "EPSG:4326": "EPSG:4326",
  CRS84: "CRS84",
};

/** What named the coordinate system, in words. */
function namedBy(placement: Exclude<Placement, { kind: "as-sent" }>): string {
  switch (placement.from) {
    case "content-crs":
      return "its Content-Crs";
    case "gml-srsname":
      return "its srsName";
    case "kml":
      return "KML";
  }
}

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
        return `Its coordinates are in ${NAMES[placement.crs] ?? placement.crs}, as ${namedBy(placement)} says: reprojected to longitude and latitude to put it on the map.`;
      }
      if (placement?.kind === "swapped") {
        return placement.from === "gml-srsname"
          ? `Its srsName is ${placement.uri}, latitude first: its axes were swapped to put it on the map.`
          : "Its Content-Crs is EPSG:4326, latitude first: its axes were swapped to put it on the map.";
      }
      // GML 2's bare EPSG:4326 is longitude first: said, because the same
      // code in another spelling would have been swapped (`gml.ts`).
      if (placement?.kind === "crs84" && placement.from === "gml-srsname") {
        return placement.crs === "EPSG:4326"
          ? `Its srsName is ${placement.uri}, which GML writes longitude first: shown as sent.`
          : `Its srsName is ${placement.uri}: longitude and latitude, shown as sent.`;
      }
      return undefined;
    case "crs-unstated":
      if (placement?.kind === "unstated") {
        return "The service didn't say which coordinate system these coordinates are in, so they are not shown on the map.";
      }
      return "GeoJSON, but its coordinates are not longitude and latitude, and the service didn't say which coordinate system they are in, so it is not shown on the map.";
    case "projected":
      if (placement?.kind === "other") {
        const format = placement.from === "gml-srsname" ? "GML" : "GeoJSON";
        return `${format} in ${placement.uri}, a coordinate system this page does not put on a map, so it is not shown there.`;
      }
      if (
        placement !== undefined &&
        placement.kind !== "as-sent" &&
        placement.kind !== "unstated"
      ) {
        return `Its coordinates are not where ${namedBy(placement)}, ${placement.uri}, would put them, so it is not shown on the map.`;
      }
      return "GeoJSON, but not in a coordinate system this page puts on a map, so it is not shown there.";
    case "too-many":
    case "not-geojson":
      return undefined;
  }
}
