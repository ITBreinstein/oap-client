/**
 * The GeoJSON draw engine against a stubbed Terra Draw: what leaves it, and
 * what it asks Terra Draw to do. The first block is Sam's, from
 * `apps/web/test/map/draw-geometry.test.ts` on `feat/T3-prototype-interface-2`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (...args: unknown[]) => void;

interface FakeFeature {
  id: string;
  geometry: { type: string; coordinates: unknown };
  properties: Record<string, unknown>;
}

interface FakeDraw {
  started: boolean;
  mode: string;
  modes: string[];
  features: FakeFeature[];
  listeners: Map<string, Listener>;
  calls: string[];
}

const instances: FakeDraw[] = [];

vi.mock("terra-draw", () => {
  class TerraDraw {
    readonly state: FakeDraw;
    constructor(options: { modes: { mode: string }[] }) {
      this.state = {
        started: false,
        mode: "static",
        modes: options.modes.map((mode) => mode.mode),
        features: [],
        listeners: new Map(),
        calls: [],
      };
      instances.push(this.state);
    }
    start() {
      this.state.started = true;
    }
    stop() {
      this.state.started = false;
      this.state.calls.push("stop");
    }
    get enabled() {
      return this.state.started;
    }
    setMode(mode: string) {
      this.state.mode = mode;
      this.state.calls.push(`mode:${mode}`);
    }
    getMode() {
      return this.state.mode;
    }
    clear() {
      this.state.features = [];
    }
    addFeatures(features: Omit<FakeFeature, "id">[]) {
      this.state.features.push(
        ...features.map((feature, index) => ({ ...feature, id: `added-${String(index)}` })),
      );
      return [];
    }
    removeFeatures(ids: string[]) {
      this.state.features = this.state.features.filter((feature) => !ids.includes(feature.id));
    }
    selectFeature(id: string) {
      this.state.calls.push(`select:${id}`);
      this.state.listeners.get("select")?.(id);
    }
    getSnapshot() {
      return this.state.features;
    }
    on(event: string, listener: Listener) {
      this.state.listeners.set(event, listener);
    }
  }
  // Each mode is only constructed and handed over; its name is what matters.
  const mode = (name: string) =>
    function Mode() {
      return { mode: name };
    };
  return {
    TerraDraw,
    TerraDrawPointMode: mode("point"),
    TerraDrawLineStringMode: mode("linestring"),
    TerraDrawPolygonMode: mode("polygon"),
    TerraDrawRectangleMode: mode("rectangle"),
    TerraDrawSelectMode: mode("select"),
  };
});

vi.mock("terra-draw-maplibre-gl-adapter", () => ({
  TerraDrawMapLibreGLAdapter: function TerraDrawMapLibreGLAdapter() {
    return {};
  },
}));

const { createTerraDrawGeometryEngine, shapesOfSnapshot } =
  await import("../../src/map/geometry-engine.js");

const corner = { type: "Point", coordinates: [4.6, 52.1] };
const triangle = {
  type: "Polygon",
  coordinates: [
    [
      [4.6, 52.1],
      [6.0, 52.0],
      [5.9, 52.4],
      [4.6, 52.1],
    ],
  ],
};

function feature(properties: Record<string, unknown>, geometry: object) {
  return { type: "Feature", properties, geometry } as never;
}

describe("what leaves the engine", () => {
  it("drops the coordinate dots drawn on a polygon", () => {
    const shapes = shapesOfSnapshot([
      feature({ mode: "polygon" }, triangle),
      feature({ mode: "polygon", coordinatePoint: true }, corner),
      feature({ mode: "polygon", coordinatePoint: true }, corner),
    ]);
    expect(shapes.map((shape) => shape.type)).toEqual(["Polygon"]);
  });

  it("drops midpoints, selection, closing and snapping points too", () => {
    const shapes = shapesOfSnapshot([
      feature({ mode: "polygon" }, triangle),
      feature({ mode: "polygon", midPoint: true }, corner),
      feature({ mode: "polygon", selectionPoint: true }, corner),
      feature({ mode: "polygon", closingPoint: true }, corner),
      feature({ mode: "polygon", snappingPoint: true }, corner),
    ]);
    expect(shapes).toHaveLength(1);
  });

  it("keeps a point the user placed, and a shape the user edited", () => {
    // `edited` marks a real shape that was moved, not a handle.
    const shapes = shapesOfSnapshot([
      feature({ mode: "point" }, corner),
      feature({ mode: "polygon", edited: true }, triangle),
    ]);
    expect(shapes.map((shape) => shape.type)).toEqual(["Point", "Polygon"]);
  });

  it("keeps only the geometry, rounded to six decimals", () => {
    const shapes = shapesOfSnapshot([
      feature({ mode: "point", selected: true }, { type: "Point", coordinates: [5.12345678, 52] }),
    ]);
    expect(shapes).toEqual([{ type: "Point", coordinates: [5.123457, 52] }]);
  });
});

function engine(tools: ("Point" | "LineString" | "Polygon" | "Rectangle")[], several: boolean) {
  const created = createTerraDrawGeometryEngine({} as never, { tools, several });
  const draw = instances.at(-1);
  if (draw === undefined) throw new Error("no Terra Draw instance");
  return { created, draw };
}

function finish(draw: FakeDraw, id: string, mode: string, geometry: FakeFeature["geometry"]) {
  draw.features.push({ id, geometry, properties: { mode } });
  draw.listeners.get("finish")?.(id, { mode, action: "draw" });
}

beforeEach(() => {
  instances.length = 0;
});

describe("the Terra Draw geometry engine", () => {
  it("registers only the offered tools, and rests in select mode", () => {
    const { draw } = engine(["Polygon", "Rectangle"], false);
    expect(draw.modes).toEqual(["polygon", "rectangle", "select"]);
    expect(draw.mode).toBe("select");
  });

  it("ignores a tool that was not offered", () => {
    const { created, draw } = engine(["Polygon"], false);
    created.place("Point");
    expect(draw.mode).toBe("select");
    created.place("Polygon");
    expect(draw.mode).toBe("polygon");
  });

  it("reports a finished shape, returns to editing, and selects it", () => {
    const { created, draw } = engine(["Polygon"], false);
    const seen: unknown[] = [];
    const states: unknown[] = [];
    created.onChange((shapes) => seen.push(shapes));
    created.onState((state) => states.push(state));
    created.place("Polygon");
    finish(draw, "a", "polygon", triangle);
    expect(seen).toEqual([[triangle]]);
    expect(draw.mode).toBe("select");
    expect(draw.calls).toContain("select:a");
    expect(states.at(-1)).toEqual({ placing: undefined, hasSelection: true });
  });

  it("replaces the previous shape when the input holds one", () => {
    const { draw } = engine(["Point"], false);
    finish(draw, "a", "point", corner);
    finish(draw, "b", "point", { type: "Point", coordinates: [5, 52] });
    expect(draw.features.map((entry) => entry.id)).toEqual(["b"]);
  });

  it("keeps every shape when the input holds several", () => {
    const { draw } = engine(["Point"], true);
    finish(draw, "a", "point", corner);
    finish(draw, "b", "point", { type: "Point", coordinates: [5, 52] });
    expect(draw.features.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("deletes the selected shape, and reports what is left", () => {
    const { created, draw } = engine(["Point"], true);
    const seen: unknown[] = [];
    created.onChange((shapes) => seen.push(shapes));
    finish(draw, "a", "point", corner);
    created.deleteSelected();
    expect(draw.features).toEqual([]);
    expect(seen.at(-1)).toEqual([]);
  });

  it("shows a value from outside, leaving off shapes no offered tool edits", () => {
    const { created, draw } = engine(["Rectangle"], true);
    created.show([
      { type: "Polygon", coordinates: triangle.coordinates },
      { type: "Point", coordinates: [5, 52] },
    ]);
    // A polygon is edited by the rectangle mode when that is all there is.
    expect(draw.features.map((entry) => entry.properties["mode"])).toEqual(["rectangle"]);
  });

  it("rounds what it shows to the nine decimals Terra Draw accepts", () => {
    const { created, draw } = engine(["Point"], false);
    created.show([{ type: "Point", coordinates: [5.1234567891234, 52] }]);
    expect(draw.features[0]?.geometry.coordinates).toEqual([5.123456789, 52]);
  });

  it("removes the draw mode when stopped", () => {
    const { created, draw } = engine(["Point"], false);
    created.stop();
    expect(draw.calls).toContain("stop");
    expect(draw.started).toBe(false);
  });
});
