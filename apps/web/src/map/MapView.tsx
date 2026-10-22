/**
 * The map (S5): MapLibre over PDOK's BRT-Achtergrondkaart (or, in the
 * updated Instrument, OpenFreeMap's world), and drawing when a
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
  ScaleControl,
  setWorkerUrl,
  type CameraOptions,
  type StyleSpecification,
} from "maplibre-gl";
// MapLibre 6 looks for its worker next to its own module, which a bundle moves.
// Vite bundles the worker as an ES module and hands its URL over instead.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  INITIAL_BOUNDS,
  OPENFREEMAP_STYLES,
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

/**
 * Said beside the tools when the value holds shapes the map cannot draw: an
 * area with a hole, a position with a height. They are still sent.
 */
function notShownHint(count: number): string {
  return count === 1
    ? "One shape in this input cannot be shown on the map (for example an area with a hole, or a point with a height). It stays in the input and is sent as it is."
    : `${String(count)} shapes in this input cannot be shown on the map (for example an area with a hole, or a point with a height). They stay in the input and are sent as they are.`;
}

const NO_GEOMETRY: GeometryDrawProps = {
  active: false,
  tools: [],
  several: false,
  value: [],
  onChange: () => undefined,
};

export type CreateMap = (container: HTMLElement, reducedMotion: boolean) => MapLibreMap;

const PDOK_STYLE: StyleSpecification = {
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
};

/**
 * A map over `style`, starting on the Netherlands. A style given by address
 * that can't be fetched falls back to `fallback`: the map still works, over
 * the basemap the page has always had.
 */
function startMap(
  container: HTMLElement,
  reducedMotion: boolean,
  style: StyleSpecification | string,
  fallback?: StyleSpecification,
): MapLibreMap {
  setWorkerUrl(workerUrl);
  const map = new MapLibreMap({
    container,
    style,
    bounds: [
      [INITIAL_BOUNDS[0], INITIAL_BOUNDS[1]],
      [INITIAL_BOUNDS[2], INITIAL_BOUNDS[3]],
    ],
    attributionControl: false,
    fadeDuration: reducedMotion ? 0 : 300,
  });
  if (fallback !== undefined && typeof style === "string") {
    // Only the style document itself: a tile that fails is just a gap.
    const onError = (event: { error?: unknown }) => {
      const failed = event.error;
      if (typeof failed !== "object" || failed === null || !("url" in failed)) return;
      if (failed.url !== style) return;
      map.off("error", onError);
      map.setStyle(fallback);
    };
    map.on("error", onError);
    map.once("load", () => {
      map.off("error", onError);
    });
  }
  map.addControl(new AttributionControl({ compact: false }));
  map.addControl(new NavigationControl({ showCompass: false, visualizePitch: false }));
  // A scale, so a shape's size can be judged on the map too (#15).
  map.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");
  return map;
}

export const createPdokMap: CreateMap = (container, reducedMotion) =>
  startMap(container, reducedMotion, PDOK_STYLE);

/**
 * STYLE TRIAL (updated Instrument): the world, in the theme's colours, from
 * OpenFreeMap; PDOK's map when OpenFreeMap can't be reached. One per theme,
 * each the same function every time, so the map is only made afresh when the
 * theme changes.
 */
export const createWorldMap: Readonly<Record<"light" | "dark", CreateMap>> = {
  light: (container, reducedMotion) =>
    startMap(container, reducedMotion, OPENFREEMAP_STYLES.light, PDOK_STYLE),
  dark: (container, reducedMotion) =>
    startMap(container, reducedMotion, OPENFREEMAP_STYLES.dark, PDOK_STYLE),
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
  /** A result shape was clicked: its index in the `result` set of {@link shown}. */
  readonly onResultClick?: ((index: number) => void) | undefined;
  /** Whether the map started, so the form can offer "Draw on the map" or not. */
  readonly onAvailable?: ((available: boolean) => void) | undefined;
  /**
   * How to read what the map shows now, west, south, east, north in
   * longitude and latitude (#18); handed back as undefined when the map goes.
   */
  readonly onViewReader?:
    | ((read: (() => readonly [number, number, number, number] | undefined) | undefined) => void)
    | undefined;
  /**
   * Where the drawing tools go (#18): beside the field drawing, so they come
   * next in the tab order. Over the map when there is none.
   */
  readonly toolsSlot?: HTMLElement | undefined;
  /** Each new token: the tools take the focus once, as Draw was just pressed (#18). */
  readonly focusToken?: number | undefined;
  /**
   * A place to move the map to, west, south, east, north (#16): each new
   * `id` moves it once.
   */
  readonly goTo?:
    { readonly id: number; readonly extent: readonly [number, number, number, number] } | undefined;
  readonly createMap?: CreateMap | undefined;
  /** What the map region is called, for a screen reader: the basemap's area and name. */
  readonly label?: string | undefined;
  readonly createEngine?: CreateDrawEngine | undefined;
  readonly createGeometryEngine?: CreateGeometryEngine | undefined;
  readonly createShapeLayers?: CreateShapeLayers | undefined;
}

const NOTHING_SHOWN: readonly ShownShapes[] = [];

/** Six decimals: about 10 cm, more than any view needs. */
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * What a map shows, west, south, east, north, kept to longitude's and
 * latitude's ranges (a map zoomed out shows more than one world). Undefined
 * when the map can't say.
 */
export function viewOf(
  map: Pick<MapLibreMap, "getBounds">,
): readonly [number, number, number, number] | undefined {
  try {
    const bounds = map.getBounds();
    const west = Math.max(-180, bounds.getWest());
    const east = Math.min(180, bounds.getEast());
    const south = Math.max(-90, bounds.getSouth());
    const north = Math.min(90, bounds.getNorth());
    return west < east && south < north
      ? [round(west), round(south), round(east), round(north)]
      : undefined;
  } catch {
    return undefined;
  }
}

export function MapView({
  draw,
  geometry = NO_GEOMETRY,
  shown = NOTHING_SHOWN,
  image,
  onResultClick,
  onAvailable,
  onViewReader,
  toolsSlot,
  focusToken,
  goTo,
  createMap = createPdokMap,
  label = "Map of the Netherlands (BRT-Achtergrondkaart)",
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
  // before a new one is made if `createMap` changes. A new one for the same
  // view (another basemap, as the theme changes) opens where the last one was.
  const camera = useRef<CameraOptions | undefined>(undefined);
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
      if (camera.current !== undefined) created.jumpTo(camera.current);
      setMap(created);
      available.current?.(true);
      return () => {
        camera.current = { center: created.getCenter(), zoom: created.getZoom() };
        available.current?.(false);
        setMap(undefined);
        created.remove();
      };
    },
    [createMap],
  );

  // Where the map is, once it stops moving: for a test, or a person with the
  // dev tools, to see where it went (#19).
  const [view, setView] = useState<string | undefined>();
  useEffect(() => {
    if (map === undefined) return undefined;
    const onMoveEnd = () => {
      try {
        const center = map.getCenter();
        setView(`${center.lng.toFixed(3)},${center.lat.toFixed(3)},${map.getZoom().toFixed(1)}`);
      } catch {
        // A map that cannot say where it is is still a map.
      }
    };
    try {
      map.on("load", onMoveEnd);
      map.on("moveend", onMoveEnd);
    } catch {
      return undefined;
    }
    return () => {
      try {
        map.off("load", onMoveEnd);
        map.off("moveend", onMoveEnd);
      } catch {
        // Gone already.
      }
    };
  }, [map]);

  useEffect(() => {
    if (map === undefined || onViewReader === undefined) return undefined;
    onViewReader(() => viewOf(map));
    return () => {
      onViewReader(undefined);
    };
  }, [map, onViewReader]);

  // A place found (#16): its outline's extent, or around a point, a street's
  // width either way.
  const goToId = goTo?.id;
  const latestGoTo = useRef(goTo);
  useEffect(() => {
    latestGoTo.current = goTo;
  });
  useEffect(() => {
    const target = latestGoTo.current;
    if (map === undefined || target === undefined || goToId === undefined) return;
    const [west, south, east, north] = target.extent;
    const pad = 0.002;
    try {
      map.fitBounds(
        [
          [west - pad, south - pad],
          [east + pad, north + pad],
        ],
        // A short, straight move: not MapLibre's flight, which takes seconds.
        { padding: 40, maxZoom: 17, linear: true, duration: 600, animate: !prefersReducedMotion() },
      );
    } catch {
      // A map that cannot move still shows where it is.
    }
  }, [map, goToId]);

  useBoundingBoxDraw(map, draw, createEngine);
  const shapes = useGeometryDraw(map, geometry, createGeometryEngine);
  const { resultShapes, resultImage, resultAway, showResult } = useShownShapes(
    map,
    shown,
    image,
    createShapeLayers,
    onResultClick,
  );
  const drawingShapes = geometry.active && map !== undefined;
  // Drawing starts with the focus on the first tool (#18), once for each
  // press of Draw: not when drawing comes back by itself. Once the tools are
  // beside the field, which makes them anew.
  const firstTool = useRef<HTMLButtonElement>(null);
  const focusedFor = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!drawingShapes || focusToken === undefined || focusedFor.current === focusToken) return;
    if (toolsSlot === undefined && firstTool.current === null) return;
    const tool = firstTool.current;
    if (toolsSlot !== undefined) focusedFor.current = focusToken;
    tool?.focus({ preventScroll: true });
    // In view, beside the field: not when the tools are over the map.
    if (toolsSlot !== undefined && tool !== null && "scrollIntoView" in tool) {
      tool.scrollIntoView({ block: "nearest" });
    }
  }, [drawingShapes, toolsSlot, focusToken]);

  const toolbar = drawingShapes && (
    <div className="map-tools" role="toolbar" aria-label="Drawing tools">
      {geometry.tools.map((tool, index) => (
        <button
          key={tool}
          ref={index === 0 ? firstTool : undefined}
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
        {shapes.notShown > 0 && ` ${notShownHint(shapes.notShown)}`}
      </p>
    </div>
  );

  return (
    <div className="map-view">
      {/* Beside the field drawing, when it gave a place for them (#18). */}
      {toolsSlot === undefined ? toolbar : toolbar !== false && createPortal(toolbar, toolsSlot)}
      <div
        ref={attach}
        className="map-canvas"
        role="region"
        aria-label={
          draw.active
            ? "Map: drag a rectangle to set the bounding box"
            : geometry.active
              ? "Map: draw shapes for the input"
              : label
        }
        data-drawing={draw.active || geometry.active ? "true" : "false"}
        data-result-shapes={resultShapes}
        data-result-image={resultImage ? "true" : "false"}
        data-view={view}
      />
      {resultAway && (
        <button type="button" className="secondary map-show-result" onClick={showResult}>
          Show the result
        </button>
      )}
      {failure !== undefined && (
        <p className="map-failure">
          The map could not be started ({failure}). Bounding boxes and GeoJSON can still be typed
          in.
        </p>
      )}
    </div>
  );
}
