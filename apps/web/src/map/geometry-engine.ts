/**
 * Terra Draw for a GeoJSON input: place points, lines, areas and boxes, edit
 * them, delete them, and say what is drawn whenever a shape is finished.
 *
 * Built on Sam's `createGeometryDraw` (`apps/web/src/map/draw-geometry.ts` on
 * `feat/T3-prototype-interface-2`), including his fix for Terra Draw's own
 * handles, and reduced to the engine interface the bounding-box drawing already
 * uses, so the hook can be tested with a stub. Our map owns the MapLibre
 * instance; this only adds a draw mode to it.
 *
 * Knows geometry and nothing else. Which tools an input may use, and whether a
 * new shape replaces the old one, is decided above here from the form plan.
 */

import type { Map as MapLibreMap } from "maplibre-gl";
import {
  TerraDraw,
  TerraDrawLineStringMode,
  TerraDrawPointMode,
  TerraDrawPolygonMode,
  TerraDrawRectangleMode,
  TerraDrawSelectMode,
  type GeoJSONStoreFeatures,
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import { INPUT_STYLE, SELECTED_INPUT_STYLES } from "./basemap.js";

type Position = readonly number[];

/** One drawn shape, longitude first. A box is drawn as a Polygon. */
export type MapShape =
  | { readonly type: "Point"; readonly coordinates: Position }
  | { readonly type: "LineString"; readonly coordinates: readonly Position[] }
  | { readonly type: "Polygon"; readonly coordinates: readonly (readonly Position[])[] };

/** Named after what the user places, not after Terra Draw's modes. */
export type Tool = "Point" | "LineString" | "Polygon" | "Rectangle";

export interface GeometryDrawState {
  /** The tool placing a shape now, if any. Ends by itself when the shape closes. */
  readonly placing: Tool | undefined;
  /** A shape is selected, so it can be deleted. */
  readonly hasSelection: boolean;
}

export interface GeometryEngine {
  /** Start placing one shape. Editing resumes once it is finished. */
  place(tool: Tool): void;
  /** Show these shapes instead of whatever is drawn. Shapes no offered tool draws are left off. */
  show(shapes: readonly MapShape[]): void;
  deleteSelected(): void;
  /** Called with everything drawn, after each finished draw, edit or delete. */
  onChange(listener: (shapes: readonly MapShape[]) => void): void;
  onState(listener: (state: GeometryDrawState) => void): void;
  /** Remove the draw mode: its layers, its listeners, its cursor. */
  stop(): void;
}

export interface GeometryEngineOptions {
  readonly tools: readonly Tool[];
  /** Whether several shapes may be drawn. Otherwise a finished shape replaces the rest. */
  readonly several: boolean;
}

export type CreateGeometryEngine = (
  map: MapLibreMap,
  options: GeometryEngineOptions,
) => GeometryEngine;

const MODE: Readonly<Record<Tool, string>> = {
  Point: "point",
  LineString: "linestring",
  Polygon: "polygon",
  Rectangle: "rectangle",
};
const SELECT = "select";

/**
 * Terra Draw's own handles carry one of these, and share the `mode` of the
 * shape they belong to — so the mode alone does not tell them apart (Sam's
 * finding: a drawn triangle came out as one polygon and three points). Its own
 * `GUIDANCE_POINT_PROPERTY_KEYS` also lists `edited`, which is wrong here: that
 * one is set on real shapes when a user moves them.
 */
const HANDLE_PROPERTIES = [
  "midPoint",
  "selectionPoint",
  "closingPoint",
  "snappingPoint",
  "coordinatePoint",
] as const;

/** Six decimals: about 0.1 m, the same as a drawn bounding box. */
function round(position: Position): number[] {
  return position.map((value) => Math.round(value * 1e6) / 1e6);
}

/**
 * Terra Draw refuses a feature with more decimals than its adapter keeps (nine),
 * which a file written by GIS software often has.
 */
function fitPrecision(shape: MapShape): MapShape {
  const nine = (position: Position) => position.map((value) => Math.round(value * 1e9) / 1e9);
  switch (shape.type) {
    case "Point":
      return { type: "Point", coordinates: nine(shape.coordinates) };
    case "LineString":
      return { type: "LineString", coordinates: shape.coordinates.map(nine) };
    case "Polygon":
      return { type: "Polygon", coordinates: shape.coordinates.map((ring) => ring.map(nine)) };
  }
}

/** Exported for tests: what leaves the engine, given a Terra Draw snapshot. */
export function shapesOfSnapshot(features: readonly GeoJSONStoreFeatures[]): MapShape[] {
  const drawn = new Set(Object.values(MODE));
  const shapes: MapShape[] = [];
  for (const feature of features) {
    const properties = feature.properties;
    if (HANDLE_PROPERTIES.some((key) => properties[key] === true)) continue;
    const mode = properties["mode"];
    if (typeof mode !== "string" || !drawn.has(mode)) continue;
    const geometry = feature.geometry;
    if (geometry.type === "Point") {
      shapes.push({ type: "Point", coordinates: round(geometry.coordinates) });
    } else if (geometry.type === "LineString") {
      shapes.push({ type: "LineString", coordinates: geometry.coordinates.map(round) });
    } else {
      shapes.push({
        type: "Polygon",
        coordinates: geometry.coordinates.map((ring) => ring.map(round)),
      });
    }
  }
  return shapes;
}

/** The mode that will edit a shape handed in from outside, if it is registered. */
function modeFor(shape: MapShape, registered: ReadonlySet<string>): string | undefined {
  const own = MODE[shape.type];
  if (registered.has(own)) return own;
  // A polygon can be edited by the rectangle mode's select flags too.
  if (shape.type === "Polygon" && registered.has(MODE.Rectangle)) return MODE.Rectangle;
  return undefined;
}

export const createTerraDrawGeometryEngine: CreateGeometryEngine = (map, { tools, several }) => {
  const fill = {
    fillColor: INPUT_STYLE.fill,
    fillOpacity: INPUT_STYLE.fillOpacity,
    outlineColor: INPUT_STYLE.outline,
    outlineWidth: INPUT_STYLE.outlineWidth,
  } as const;
  const editable = {
    feature: {
      draggable: true,
      coordinates: {
        draggable: true,
        // Sam: with `midpoints: true` a click inserts a vertex, but dragging
        // one needs the object form.
        midpoints: { draggable: true },
        deletable: true,
      },
    },
  };

  // Only the modes the caller offers are registered, so a tool that was never
  // offered cannot be reached by any route.
  const offered = [...new Set(tools)];
  const registered = new Set(offered.map((tool) => MODE[tool]));
  const draw = new TerraDraw({
    adapter: new TerraDrawMapLibreGLAdapter({ map }),
    modes: [
      ...offered.map((tool) => {
        switch (tool) {
          case "Point":
            return new TerraDrawPointMode({
              editable: true,
              styles: {
                pointColor: INPUT_STYLE.fill,
                pointOutlineColor: INPUT_STYLE.outline,
                pointWidth: 6,
              },
            });
          case "LineString":
            return new TerraDrawLineStringMode({
              editable: true,
              styles: { lineStringColor: INPUT_STYLE.outline, lineStringWidth: 3 },
            });
          case "Polygon":
            // A dot on every placed vertex: without it the shape being built
            // is only an outline, and which corners you put down is memory.
            return new TerraDrawPolygonMode({
              editable: true,
              showCoordinatePoints: true,
              styles: fill,
            });
          case "Rectangle":
            return new TerraDrawRectangleMode({
              styles: fill,
              drawInteraction: "click-move-or-drag",
            });
        }
      }),
      new TerraDrawSelectMode({
        styles: SELECTED_INPUT_STYLES,
        // Terra Draw defaults to 40, far wider than the dot it grabs.
        pointerDistance: 15,
        flags: Object.fromEntries(
          [...registered].map((mode) => [
            mode,
            mode === MODE.Rectangle
              ? {
                  feature: {
                    draggable: true,
                    coordinates: { draggable: false, resizable: "opposite" },
                  },
                }
              : editable,
          ]),
        ),
      }),
    ],
  });
  draw.start();
  draw.setMode(SELECT);

  const changeListeners = new Set<(shapes: readonly MapShape[]) => void>();
  const stateListeners = new Set<(state: GeometryDrawState) => void>();
  let placing: Tool | undefined;
  let selected: string | number | undefined;

  const emit = () => {
    const shapes = shapesOfSnapshot(draw.getSnapshot());
    for (const listener of changeListeners) listener(shapes);
  };
  const announce = () => {
    const state = { placing, hasSelection: selected !== undefined };
    for (const listener of stateListeners) listener(state);
  };

  // Only finished shapes leave the engine (Sam): `change` fires on every mouse
  // move while a polygon is being drawn. `finish` fires once a shape is
  // complete and after every edit; a deletion never finishes, so that one
  // comes from `change`.
  draw.on("finish", (id, context) => {
    if (context.action === "draw") {
      if (!several) {
        const others = draw
          .getSnapshot()
          .map((feature) => feature.id)
          .filter((other): other is string | number => other !== undefined && other !== id);
        if (others.length > 0) draw.removeFeatures(others);
      }
      placing = undefined;
      draw.setMode(SELECT);
      // Adjusting what was just drawn is the common case; hunting for it with
      // a click is not.
      draw.selectFeature(id);
      announce();
    }
    emit();
  });
  draw.on("change", (_ids, type) => {
    if (type === "delete" && draw.getMode() === SELECT) emit();
  });
  draw.on("select", (id) => {
    selected = id;
    announce();
  });
  draw.on("deselect", () => {
    selected = undefined;
    announce();
  });

  return {
    place(tool) {
      if (!registered.has(MODE[tool])) return;
      placing = tool;
      draw.setMode(MODE[tool]);
      announce();
    },
    show(shapes) {
      draw.clear();
      selected = undefined;
      const features = shapes.flatMap((shape): GeoJSONStoreFeatures[] => {
        const mode = modeFor(shape, registered);
        return mode === undefined
          ? []
          : [
              {
                type: "Feature",
                geometry: fitPrecision(shape) as GeoJSONStoreFeatures["geometry"],
                properties: { mode },
              },
            ];
      });
      if (features.length > 0) draw.addFeatures(features);
      announce();
    },
    deleteSelected() {
      if (selected === undefined) return;
      draw.removeFeatures([selected]);
      selected = undefined;
      emit();
      announce();
    },
    onChange(listener) {
      changeListeners.add(listener);
    },
    onState(listener) {
      stateListeners.add(listener);
    },
    stop() {
      changeListeners.clear();
      stateListeners.clear();
      if (draw.enabled) draw.stop();
    },
  };
};
