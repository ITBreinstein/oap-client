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
import { createOwnChanges, isHandle, shapeIds } from "./terra-draw-common.js";

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
  /**
   * Shapes in the value the map cannot show: ones Terra Draw refuses (an area
   * with a hole, a position with a height) or no offered tool draws. They are
   * kept in the value, beside whatever is drawn, and never shown or edited.
   */
  readonly notShown: number;
}

export interface GeometryEngine {
  /** Start placing one shape. Editing resumes once it is finished. */
  place(tool: Tool): void;
  /**
   * Show these shapes instead of whatever is drawn. Shapes the map cannot show
   * are left off the map but kept in what the engine reports (`notShown`).
   */
  show(shapes: readonly MapShape[]): void;
  deleteSelected(): void;
  /**
   * Called with every shape the value holds — drawn, and not shown — after each
   * finished draw, edit or delete by the user. Never for the engine's own
   * changes: showing a value, selecting, or a selection handle coming and going.
   */
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
    if (isHandle(feature)) continue;
    const mode = feature.properties["mode"];
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
  const own = createOwnChanges();
  let placing: Tool | undefined;
  let selected: string | number | undefined;
  /**
   * The shapes drawn when the engine last reported or showed a value, by id.
   * A `delete` Terra Draw reports is an edit only when it names one of these:
   * deselecting a shape also deletes, but only its selection handles (W16).
   */
  let drawnIds = new Set<string | number>();
  /** Shapes of the value the map cannot show, kept so they are not lost (W17). */
  let notShown: readonly MapShape[] = [];

  const remember = () => {
    drawnIds = new Set(shapeIds(draw.getSnapshot(), registered));
  };
  const emit = () => {
    const shapes = [...shapesOfSnapshot(draw.getSnapshot()), ...notShown];
    remember();
    for (const listener of changeListeners) listener(shapes);
  };
  const announce = () => {
    const state = { placing, hasSelection: selected !== undefined, notShown: notShown.length };
    for (const listener of stateListeners) listener(state);
  };

  // Only finished shapes leave the engine (Sam): `change` fires on every mouse
  // move while a polygon is being drawn. `finish` fires once a shape is
  // complete and after every edit; a deletion never finishes, so that one
  // comes from `change`.
  draw.on("finish", (id, context) => {
    if (own.applying()) return;
    try {
      if (context.action === "draw") {
        own.apply(() => {
          if (!several) {
            // Shapes only: the old shape's own handles go with it (W1).
            const others = shapeIds(draw.getSnapshot(), registered).filter((other) => other !== id);
            if (others.length > 0) draw.removeFeatures(others);
            // A new shape replaces the value, the part the map could not show too.
            notShown = [];
          }
          placing = undefined;
          draw.setMode(SELECT);
          // Adjusting what was just drawn is the common case; hunting for it
          // with a click is not.
          draw.selectFeature(id);
        });
      }
    } finally {
      // Whatever happened above, the user finished something: say so.
      emit();
      announce();
    }
  });
  draw.on("change", (ids, type) => {
    if (own.applying()) return;
    if (type !== "delete" || draw.getMode() !== SELECT) return;
    if (ids.some((id) => drawnIds.has(id))) emit();
  });
  draw.on("select", (id) => {
    selected = id;
    announce();
  });
  draw.on("deselect", () => {
    selected = undefined;
    announce();
  });

  /** Whatever is drawn, replaced by `shapes`. Always run as one of our own changes. */
  const replace = (shapes: readonly MapShape[]) => {
    draw.clear();
    selected = undefined;
    const shown: MapShape[] = [];
    const kept: MapShape[] = [];
    const features: GeoJSONStoreFeatures[] = [];
    for (const shape of shapes) {
      const mode = modeFor(shape, registered);
      if (mode === undefined) {
        kept.push(shape);
        continue;
      }
      shown.push(shape);
      features.push({
        type: "Feature",
        geometry: fitPrecision(shape) as GeoJSONStoreFeatures["geometry"],
        properties: { mode },
      });
    }
    // Terra Draw validates each feature and silently leaves out any it
    // refuses; its answer, one entry per feature in order, says which.
    const answers = features.length > 0 ? draw.addFeatures(features) : [];
    shown.forEach((shape, index) => {
      if (answers[index]?.valid !== true) kept.push(shape);
    });
    notShown = kept;
    remember();
  };

  return {
    place(tool) {
      if (!registered.has(MODE[tool])) return;
      placing = tool;
      own.apply(() => {
        draw.setMode(MODE[tool]);
      });
      announce();
    },
    show(shapes) {
      own.apply(() => {
        replace(shapes);
      });
      announce();
    },
    deleteSelected() {
      const id = selected;
      if (id === undefined) return;
      own.apply(() => {
        draw.removeFeatures([id]);
      });
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
      if (!draw.enabled) return;
      try {
        draw.stop();
      } catch {
        // MapView's ref cleanup can remove the map, its style with it, before
        // this runs: React 19 runs ref cleanups ahead of effect cleanups. The
        // draw mode's layers went with the style; nothing is left to remove
        // (W29).
      }
    },
  };
};
