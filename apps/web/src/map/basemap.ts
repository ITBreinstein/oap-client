import type { StyleSpecification } from "maplibre-gl";

/**
 * A raster basemap from OpenStreetMap.
 *
 * Declared inline rather than fetched as a style URL: a hosted style is one
 * more service to be reachable, and every vector style worth using needs an API
 * key. The `attribution` here is not decoration — OpenStreetMap's licence
 * requires it, and MapLibre's attribution control is what renders it. See
 * THIRD_PARTY.md.
 */
export const OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

/** Roughly the whole Netherlands, as somewhere to open rather than a default. */
export const INITIAL_VIEW = { center: [5.2913, 52.1326] as [number, number], zoom: 6.5 };
