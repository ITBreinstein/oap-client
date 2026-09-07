import type { Feature, FeatureCollection } from "geojson";
import { Map as MapLibreMap, setWorkerUrl } from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import {
  type GeoJSONStoreFeatures,
  TerraDraw,
  TerraDrawLineStringMode,
  TerraDrawPointMode,
  TerraDrawPolygonMode,
  TerraDrawRectangleMode,
  TerraDrawSelectMode,
  TerraDrawSessionUndoRedo,
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import { INITIAL_VIEW, OSM_STYLE } from "./basemap.js";
import { boundsOf } from "./geojson.js";
import "maplibre-gl/dist/maplibre-gl.css";

/**
 * Point MapLibre at its own Web Worker, explicitly.
 *
 * Left alone, MapLibre builds the path itself with a template string —
 * `new URL(\`./${name}\`, import.meta.url)` — which no bundler can resolve
 * statically. In development Vite pre-bundles the module into
 * `node_modules/.vite/deps/`, where that sibling file does not exist; in a
 * production build the asset is never emitted at all. Both give a 404.
 *
 * The failure is quiet and misleading: MapLibre parses GeoJSON sources in this
 * worker, so raster basemap tiles keep rendering while every drawn shape
 * silently fails to appear. Vite's `?url` makes the file an asset it knows
 * about, so it is emitted and versioned like any other.
 */
setWorkerUrl(maplibreWorkerUrl);

/**
 * Terra Draw's own id for a feature. Declared here because the package does not
 * re-export the type from its entry point, only uses it in signatures.
 */
type FeatureId = string | number;

/**
 * A tool the map can offer.
 *
 * Named after what the user is placing rather than after Terra Draw's modes.
 * `BoundingBox` draws a rectangle and produces an ordinary Polygon — a box is
 * a constraint on how it is drawn, not a distinct geometry. Turning that
 * polygon into `[west, south, east, north]` is the encoder's job, above here.
 */
export type Tool = "Point" | "LineString" | "Polygon" | "BoundingBox";

/** The geometry a tool produces. */
export function geometryTypeOf(tool: Tool): "Point" | "LineString" | "Polygon" {
  if (tool === "Point" || tool === "LineString") return tool;
  return "Polygon";
}

/** Terra Draw's own name for the mode behind a tool. */
function modeOf(tool: Tool): string {
  switch (tool) {
    case "Point":
      return "point";
    case "LineString":
      return "linestring";
    case "Polygon":
      return "polygon";
    case "BoundingBox":
      return "rectangle";
  }
}

/** The mode that owns an imported geometry, for handing it back to be edited. */
function modeForGeometry(type: string): string {
  if (type === "Point") return "point";
  if (type === "LineString") return "linestring";
  return "polygon";
}

/**
 * Modes whose features are shapes the user placed.
 *
 * Everything else in a snapshot is Terra Draw's own furniture — selection
 * points, midpoints, the dots on a shape being drawn.
 */
const DRAWN_MODES = new Set(["point", "linestring", "polygon", "rectangle"]);

/** What the toolbar needs to know to label and enable itself. */
export interface DrawState {
  /** The tool currently placing a shape, if any. Ends when the shape closes. */
  readonly placing: Tool | undefined;
  /** A shape is selected, so its corners and midpoints are live. */
  readonly hasSelection: boolean;
}

export interface GeometryDrawOptions {
  readonly container: HTMLElement;
  /**
   * Which tools to offer, in the order they should appear.
   *
   * The caller decides: today a fixed list, once form generation lands whatever
   * the process description turns out to permit for that input.
   */
  readonly tools: readonly Tool[];
  /** Called after every draw, edit or delete, with everything currently drawn. */
  readonly onChange: (features: FeatureCollection) => void;
  /** Called whenever the toolbar's enablement could have changed. */
  readonly onStateChange?: ((state: DrawState) => void) | undefined;
}

/** What became of features handed to {@link GeometryDraw.setFeatures}. */
export interface LoadReport {
  readonly added: number;
  /** One reason per feature Terra Draw refused, in its own words. */
  readonly rejected: readonly string[];
}

export interface GeometryDraw {
  /**
   * Replaces everything drawn with `features`, and moves the view to them.
   *
   * Replaces rather than appends: it is the predictable half of the choice, and
   * undo covers the regret. Anything Terra Draw will not accept comes back in
   * the report rather than disappearing.
   */
  setFeatures(features: readonly Feature[]): LoadReport;
  /**
   * Starts placing one new shape with `tool`. Editing resumes by itself once
   * the shape is complete — drawing is finite, so it is an action rather than
   * a mode you have to remember to leave.
   */
  add(tool: Tool): void;
  /** Removes the selected shape. No-op when nothing is selected. */
  deleteSelected(): void;
  /** Steps back through this session's edits. No-op when there is nothing to undo. */
  undo(): void;
  redo(): void;
  /** Discards every drawn shape. */
  clear(): void;
  /** Releases the WebGL context and every listener. Safe to call twice. */
  destroy(): void;
}

/**
 * Terra Draw keeps its own bookkeeping on each feature — the mode that drew it,
 * selection state, an internal id. None of that belongs in a value handed to a
 * server, so only the geometry survives.
 */
function toCollection(features: readonly Feature[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: features
      // Terra Draw renders its own handles as Point features — selection
      // points, midpoints, the coordinate dots on a polygon being drawn. They
      // are indistinguishable from a placed point except by the mode that owns
      // them, so filter on that rather than on geometry type.
      .filter((feature) => DRAWN_MODES.has(String(feature.properties?.["mode"] ?? "")))
      .map((feature) => ({
        type: "Feature",
        geometry: feature.geometry,
        properties: {},
      })),
  };
}

/**
 * Puts a drawable map into `container`.
 *
 * Knows geometry and nothing else: no process, no protocol, no core import.
 * What a drawn shape means, and how it is encoded into a request, is decided
 * above this — see the map boundary rules in README.md.
 */
export function createGeometryDraw({
  container,
  tools,
  onChange,
  onStateChange,
}: GeometryDrawOptions): GeometryDraw {
  const map = new MapLibreMap({
    container,
    style: OSM_STYLE,
    center: INITIAL_VIEW.center,
    zoom: INITIAL_VIEW.zoom,
  });

  // Only the modes the caller asked for are registered, so a mode that was
  // never offered cannot be reached by any route.
  const modeNames = [...new Set(tools.map(modeOf))];

  /**
   * What select mode may do to a shape, per mode.
   *
   * Flags are keyed by the mode that owns the feature and are off by default —
   * a select mode with no flags selects a shape and then permits nothing,
   * which looks broken rather than unconfigured.
   */
  const editing = {
    feature: {
      draggable: true,
      coordinates: {
        draggable: true,
        // `midpoints: true` renders them and lets a click insert a vertex, but
        // dragging one needs the object form — with the boolean the obvious
        // gesture silently does nothing.
        midpoints: { draggable: true },
        deletable: true,
      },
    },
  };

  const drawModes = modeNames.map((name) => {
    if (name === "point") return new TerraDrawPointMode({ editable: true });
    if (name === "linestring")
      return new TerraDrawLineStringMode({ showCoordinatePoints: true, editable: true });
    if (name === "rectangle") return new TerraDrawRectangleMode();
    // A dot on every placed vertex: without it the shape being built is only
    // an outline, and which corners you put down is left to memory.
    return new TerraDrawPolygonMode({ showCoordinatePoints: true, editable: true });
  });

  const draw = new TerraDraw({
    adapter: new TerraDrawMapLibreGLAdapter({ map }),
    modes: [
      ...drawModes,
      new TerraDrawSelectMode({
        // Terra Draw defaults to 40, which is far wider than the dot it grabs.
        pointerDistance: 15,
        flags: Object.fromEntries(modeNames.map((name) => [name, editing])),
      }),
    ],
    // Session-level history is opt-in; without this, undo() does nothing.
    undoRedo: { sessionLevel: new TerraDrawSessionUndoRedo() },
  });

  const emit = (): void => {
    onChange(toCollection(draw.getSnapshot()));
  };

  /**
   * Only finished shapes leave the binding.
   *
   * Terra Draw's `change` event fires on every mouse move while a polygon is
   * being drawn, so forwarding it wrote a half-finished ring into the form and
   * rewrote it as the cursor moved. `finish` fires once a shape is complete,
   * and covers edits too — dragging a vertex, inserting or deleting one. A
   * deletion never finishes, so that one case still comes from `change`.
   */
  const emitOnDelete = (_ids: unknown, type: string): void => {
    if (type === "delete") emit();
  };

  // Terra Draw cannot be driven before it has started, and it cannot start
  // before the style has loaded — its adapter adds layers to the map.
  let started = false;
  let placing: Tool | undefined;
  let selected: FeatureId | undefined;
  let destroyed = false;

  const announce = (): void => {
    onStateChange?.({ placing, hasSelection: selected !== undefined });
  };

  /**
   * Drawing ends itself.
   *
   * A finished ring is the natural end of the action, so the map returns to
   * editing rather than waiting to be switched back — and the new shape is
   * selected, because wanting to adjust what you just drew is the common case
   * and hunting for it with a click is not.
   */
  const onFinish = (id: FeatureId, context: { action: string }): void => {
    emit();
    if (context.action !== "draw") return;
    placing = undefined;
    draw.setMode("select");
    draw.selectFeature(id);
    announce();
  };

  map.on("load", () => {
    draw.start();
    // Editing is the resting state: it is what the map is for most of the time,
    // and it is the one place every gesture behaves the same way.
    draw.setMode("select");
    draw.on("finish", onFinish);
    draw.on("change", emitOnDelete);
    draw.on("select", (id) => {
      selected = id;
      announce();
    });
    draw.on("deselect", () => {
      selected = undefined;
      announce();
    });
    started = true;
    announce();
  });

  return {
    setFeatures(features: readonly Feature[]): LoadReport {
      if (!started) return { added: 0, rejected: ["The map has not finished loading."] };

      draw.clear();
      // Terra Draw stores the mode that owns each feature alongside it, so an
      // imported shape has to declare which mode will be editing it.
      const results = draw.addFeatures(
        features.map((feature) => ({
          ...feature,
          properties: { mode: modeForGeometry(feature.geometry.type) },
        })) as GeoJSONStoreFeatures[],
      );

      const rejected = results
        .filter((result) => !result.valid)
        .map((result) => result.reason ?? "Terra Draw rejected the shape without saying why.");

      const bounds = boundsOf(features);
      if (bounds) {
        const [west, south, east, north] = bounds;
        // maxZoom stops a single point filling the screen at street level.
        map.fitBounds(
          [
            [west, south],
            [east, north],
          ],
          { padding: 40, maxZoom: 16, animate: false },
        );
      }

      emit();
      return { added: results.length - rejected.length, rejected };
    },
    add(tool: Tool): void {
      if (!started) return;
      placing = tool;
      draw.setMode(modeOf(tool));
      announce();
    },
    deleteSelected(): void {
      if (!started || selected === undefined) return;
      draw.removeFeatures([selected]);
      selected = undefined;
      emit();
      announce();
    },
    undo(): void {
      // Undo restores geometry without "finishing" anything, so the form has to
      // be told separately.
      if (started && draw.canUndo()) {
        draw.undo();
        emit();
      }
    },
    redo(): void {
      if (started && draw.canRedo()) {
        draw.redo();
        emit();
      }
    },
    clear(): void {
      draw.clear();
      emit();
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      draw.off("finish", emit);
      draw.off("change", emitOnDelete);
      if (draw.enabled) draw.stop();
      map.remove();
    },
  };
}
