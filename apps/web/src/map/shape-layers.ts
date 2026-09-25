/**
 * Shapes shown on the map and not drawn: a result, and the input it came from.
 *
 * One GeoJSON source and a layer per role and geometry kind, added to the map
 * the page already has. Nothing here can be edited or selected; that is the
 * draw mode's job, and the two never run at once (the form is closed while a
 * result is shown).
 *
 * Knows geometry and nothing else. What counts as a result, and which shapes
 * are the input, is decided above here from the workflow.
 */

import type {
  ExpressionSpecification,
  GeoJSONSource,
  LayerSpecification,
  Map as MapLibreMap,
} from "maplibre-gl";
import { INPUT_STYLE, RESULT_STYLE } from "./basemap.js";
import type { MapShape } from "./geometry-engine.js";

/** `input` in the drawn input's amber, `result` in blue. */
export type ShownRole = "input" | "result";

export interface ShownShapes {
  readonly role: ShownRole;
  readonly shapes: readonly MapShape[];
}

export interface ShapeLayers {
  /** Show these instead of whatever is shown. An empty list clears the map. */
  show(sets: readonly ShownShapes[]): void;
  /** Called once the layers are on the map, which waits for its style to load. */
  onReady(listener: () => void): void;
  /** Remove the layers and the source. */
  stop(): void;
}

export type CreateShapeLayers = (map: MapLibreMap) => ShapeLayers;

const SOURCE = "oap-shown";

function geometryOf(shape: MapShape): GeoJSON.Geometry {
  switch (shape.type) {
    case "Point":
      return { type: "Point", coordinates: [...shape.coordinates] };
    case "LineString":
      return { type: "LineString", coordinates: shape.coordinates.map((p) => [...p]) };
    case "Polygon":
      return {
        type: "Polygon",
        coordinates: shape.coordinates.map((ring) => ring.map((p) => [...p])),
      };
  }
}

/** Exported for tests: the source's data for some shown sets. */
export function featureCollectionOf(sets: readonly ShownShapes[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: sets.flatMap((set) =>
      set.shapes.map((shape): GeoJSON.Feature => ({
        type: "Feature",
        properties: { role: set.role },
        geometry: geometryOf(shape),
      })),
    ),
  };
}

const byRole = (role: ShownRole): ExpressionSpecification => ["==", ["get", "role"], role];
const isPolygon: ExpressionSpecification = ["==", ["geometry-type"], "Polygon"];
const isLine: ExpressionSpecification = ["==", ["geometry-type"], "LineString"];
const isPoint: ExpressionSpecification = ["==", ["geometry-type"], "Point"];

function layersFor(role: ShownRole): LayerSpecification[] {
  const style = role === "result" ? RESULT_STYLE : INPUT_STYLE;
  const prefix = `${SOURCE}-${role}`;
  return [
    {
      id: `${prefix}-fill`,
      type: "fill",
      source: SOURCE,
      filter: ["all", byRole(role), isPolygon],
      paint: { "fill-color": style.fill, "fill-opacity": style.fillOpacity },
    },
    {
      id: `${prefix}-line`,
      type: "line",
      source: SOURCE,
      filter: ["all", byRole(role), ["any", isPolygon, isLine]],
      paint: {
        "line-color": style.outline,
        "line-width": style.outlineWidth,
        // The input dashed, so the two read apart without colour too.
        ...(role === "input" ? { "line-dasharray": [2, 2] } : {}),
      },
    },
    {
      id: `${prefix}-point`,
      type: "circle",
      source: SOURCE,
      filter: ["all", byRole(role), isPoint],
      paint: {
        "circle-color": style.fill,
        "circle-radius": 6,
        "circle-stroke-color": style.outline,
        "circle-stroke-width": 2,
      },
    },
  ];
}

/** The input first, so a result that overlaps it is drawn on top. */
const LAYERS = [...layersFor("input"), ...layersFor("result")];

export const createMapLibreShapeLayers: CreateShapeLayers = (map) => {
  let data = featureCollectionOf([]);
  let added = false;
  let stopped = false;
  let ready: (() => void) | undefined;

  const add = () => {
    if (added || stopped) return;
    try {
      map.addSource(SOURCE, { type: "geojson", data });
      for (const layer of LAYERS) map.addLayer(layer);
    } catch {
      // The style is still loading: MapLibre refuses a source until it is.
      // Undo what did go on, and try again on the next style event.
      try {
        removeAll();
      } catch {
        // Nothing went on.
      }
      map.once("styledata", add);
      return;
    }
    added = true;
    ready?.();
  };

  const removeAll = () => {
    for (const layer of [...LAYERS].reverse()) {
      if (map.getLayer(layer.id) !== undefined) map.removeLayer(layer.id);
    }
    if (map.getSource(SOURCE) !== undefined) map.removeSource(SOURCE);
  };

  add();

  return {
    show: (sets) => {
      data = featureCollectionOf(sets);
      if (added) void map.getSource<GeoJSONSource>(SOURCE)?.setData(data);
    },
    onReady: (listener) => {
      ready = listener;
      if (added) listener();
    },
    stop: () => {
      stopped = true;
      map.off("styledata", add);
      try {
        removeAll();
      } catch {
        // The map is being removed with its style; nothing is left to clean.
      }
    },
  };
};
