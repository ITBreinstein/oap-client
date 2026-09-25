/**
 * The map (S5): MapLibre over PDOK's BRT-Achtergrondkaart, and drawing when a
 * form field asks for it — a bounding box, or shapes for a GeoJSON input. Once
 * a run is done, it shows the GeoJSON in the result beside the input it came
 * from.
 *
 * Knows geometry, not the protocol (`map-binding-knows-no-protocol`): it is
 * handed four numbers or some shapes, and hands the same back. When the map
 * cannot start — no WebGL, as in a test runner or an old browser — it says so
 * and the form's typed coordinates and GeoJSON remain the way in.
 */

import "maplibre-gl/dist/maplibre-gl.css";
import {
  AttributionControl,
  Map as MapLibreMap,
  NavigationControl,
  setWorkerUrl,
} from "maplibre-gl";
// MapLibre 6 looks for its worker next to its own module, which a bundle moves.
// Vite bundles the worker as an ES module and hands its URL over instead.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  INITIAL_BOUNDS,
  PDOK_BRT_ATTRIBUTION,
  PDOK_BRT_MAX_ZOOM,
  PDOK_BRT_TILES,
} from "./basemap.js";
import type { CreateDrawEngine } from "./draw-engine.js";
import type { CreateGeometryEngine, Tool } from "./geometry-engine.js";
import type { CreateShapeLayers, ShownImage, ShownShapes } from "./shape-layers.js";
import { useBoundingBoxDraw, type BboxDrawProps } from "./useBoundingBoxDraw.js";
import { useGeometryDraw, type GeometryDrawProps } from "./useGeometryDraw.js";
import { useShownShapes } from "./useShownShapes.js";

/** Toolbar wording, in the user's terms rather than GeoJSON's (Sam's). */
const TOOL_LABELS: Readonly<Record<Tool, string>> = {
  Point: "Add point",
  LineString: "Add line",
  Polygon: "Add area",
  Rectangle: "Add box",
};

const TOOL_HINTS: Readonly<Record<Tool, string>> = {
  Point: "Click to place the point.",
  LineString: "Click to place each point along the line; double-click to finish.",
  Polygon:
    "Click to place each corner. Click the first corner again, or double-click, to close the shape.",
  Rectangle: "Drag, or click two corners, to draw a box.",
};

const NO_GEOMETRY: GeometryDrawProps = {
  active: false,
  tools: [],
  several: false,
  value: [],
  onChange: () => undefined,
};

export type CreateMap = (container: HTMLElement, reducedMotion: boolean) => MapLibreMap;

export const createPdokMap: CreateMap = (container, reducedMotion) => {
  setWorkerUrl(workerUrl);
  const map = new MapLibreMap({
    container,
    style: {
      version: 8,
      sources: {
        brt: {
          type: "raster",
          tiles: [PDOK_BRT_TILES],
          tileSize: 256,
          maxzoom: PDOK_BRT_MAX_ZOOM,
          attribution: PDOK_BRT_ATTRIBUTION,
        },
      },
      layers: [{ id: "brt", type: "raster", source: "brt" }],
    },
    bounds: [
      [INITIAL_BOUNDS[0], INITIAL_BOUNDS[1]],
      [INITIAL_BOUNDS[2], INITIAL_BOUNDS[3]],
    ],
    attributionControl: false,
    fadeDuration: reducedMotion ? 0 : 300,
  });
  map.addControl(new AttributionControl({ compact: false }));
  map.addControl(new NavigationControl({ showCompass: false }));
  return map;
};

function prefersReducedMotion(): boolean {
  try {
    return globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export interface MapViewProps {
  /** Bounding-box drawing for one form field; absent when nothing is drawing. */
  readonly draw: BboxDrawProps;
  /** GeoJSON drawing for one form field; absent or inactive when nothing is drawing. */
  readonly geometry?: GeometryDrawProps | undefined;
  /** Shapes to show and not edit: a result, and its input. */
  readonly shown?: readonly ShownShapes[] | undefined;
  /** An image result, over the area it covers. */
  readonly image?: ShownImage | undefined;
  /** Whether the map started, so the form can offer "Draw on the map" or not. */
  readonly onAvailable?: ((available: boolean) => void) | undefined;
  readonly createMap?: CreateMap | undefined;
  readonly createEngine?: CreateDrawEngine | undefined;
  readonly createGeometryEngine?: CreateGeometryEngine | undefined;
  readonly createShapeLayers?: CreateShapeLayers | undefined;
}

const NOTHING_SHOWN: readonly ShownShapes[] = [];

export function MapView({
  draw,
  geometry = NO_GEOMETRY,
  shown = NOTHING_SHOWN,
  image,
  onAvailable,
  createMap = createPdokMap,
  createEngine,
  createGeometryEngine,
  createShapeLayers,
}: MapViewProps) {
  const [map, setMap] = useState<MapLibreMap | undefined>();
  const [failure, setFailure] = useState<string | undefined>();
  const available = useRef(onAvailable);
  useEffect(() => {
    available.current = onAvailable;
  });

  // A ref callback with a cleanup (React 19): the map is created when its
  // container is attached and removed when it is detached — on unmount, and
  // before a new one is made if `createMap` changes.
  const attach = useCallback(
    (element: HTMLDivElement | null) => {
      if (element === null) return;
      let created: MapLibreMap;
      try {
        created = createMap(element, prefersReducedMotion());
      } catch (cause) {
        setFailure(cause instanceof Error ? cause.message : String(cause));
        available.current?.(false);
        return;
      }
      setMap(created);
      available.current?.(true);
      return () => {
        available.current?.(false);
        setMap(undefined);
        created.remove();
      };
    },
    [createMap],
  );

  useBoundingBoxDraw(map, draw, createEngine);
  const shapes = useGeometryDraw(map, geometry, createGeometryEngine);
  const { resultShapes, resultImage } = useShownShapes(map, shown, image, createShapeLayers);
  const drawingShapes = geometry.active && map !== undefined;

  return (
    <div className="map-view">
      {drawingShapes && (
        <div className="map-tools" role="toolbar" aria-label="Drawing tools">
          {geometry.tools.map((tool) => (
            <button
              key={tool}
              type="button"
              className={shapes.placing === tool ? "" : "secondary"}
              aria-pressed={shapes.placing === tool}
              onClick={() => {
                shapes.place(tool);
              }}
            >
              {TOOL_LABELS[tool]}
            </button>
          ))}
          <button
            type="button"
            className="secondary"
            disabled={!shapes.hasSelection}
            onClick={() => {
              shapes.deleteSelected();
            }}
          >
            Delete selected
          </button>
          <p className="map-hint" role="status">
            {shapes.placing === undefined
              ? "Choose a tool to add a shape. Click a shape to select it; drag it or its corners to adjust."
              : TOOL_HINTS[shapes.placing]}
          </p>
        </div>
      )}
      <div
        ref={attach}
        className="map-canvas"
        role="region"
        aria-label={
          draw.active
            ? "Map: drag a rectangle to set the bounding box"
            : geometry.active
              ? "Map: draw shapes for the input"
              : "Map of the Netherlands (BRT-Achtergrondkaart)"
        }
        data-drawing={draw.active || geometry.active ? "true" : "false"}
        data-result-shapes={resultShapes}
        data-result-image={resultImage ? "true" : "false"}
      />
      {failure !== undefined && (
        <p className="map-failure">
          The map could not be started ({failure}). Bounding boxes and GeoJSON can still be typed
          in.
        </p>
      )}
    </div>
  );
}
