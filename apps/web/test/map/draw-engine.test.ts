/**
 * The Terra Draw engine against a stubbed Terra Draw: what it asks Terra Draw
 * to do, and what it reports back when a rectangle is finished.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (...args: unknown[]) => void;

interface FakeDraw {
  started: boolean;
  mode: string;
  features: { id: string; geometry: { type: string; coordinates: number[][][] } }[];
  listeners: Map<string, Listener>;
  calls: string[];
}

const instances: FakeDraw[] = [];

vi.mock("terra-draw", () => {
  class TerraDraw {
    readonly state: FakeDraw;
    constructor() {
      this.state = {
        started: false,
        mode: "static",
        features: [],
        listeners: new Map(),
        calls: [],
      };
      instances.push(this.state);
    }
    start() {
      this.state.started = true;
      this.state.calls.push("start");
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
      this.state.calls.push("clear");
    }
    addFeatures(features: FakeDraw["features"]) {
      this.state.features.push(
        ...features.map((feature, index) => ({ ...feature, id: `added-${String(index)}` })),
      );
      this.state.calls.push("add");
      return [];
    }
    removeFeatures(ids: string[]) {
      this.state.features = this.state.features.filter((feature) => !ids.includes(feature.id));
    }
    getSnapshot() {
      return this.state.features;
    }
    on(event: string, listener: Listener) {
      this.state.listeners.set(event, listener);
    }
  }
  // Modes and the adapter are only constructed and handed over; a function
  // called with `new` stands in for each.
  function TerraDrawRectangleMode() {
    return {};
  }
  function TerraDrawSelectMode() {
    return {};
  }
  return { TerraDraw, TerraDrawRectangleMode, TerraDrawSelectMode };
});

vi.mock("terra-draw-maplibre-gl-adapter", () => ({
  TerraDrawMapLibreGLAdapter: function TerraDrawMapLibreGLAdapter() {
    return {};
  },
}));

const { createTerraDrawEngine } = await import("../../src/map/draw-engine.js");

function engine() {
  const created = createTerraDrawEngine({} as never);
  const draw = instances.at(-1);
  if (draw === undefined) throw new Error("no Terra Draw instance");
  return { created, draw };
}

function finish(draw: FakeDraw, id: string, ring: number[][]) {
  draw.features.push({ id, geometry: { type: "Polygon", coordinates: [ring] } });
  draw.listeners.get("finish")?.(id, {});
}

beforeEach(() => {
  instances.length = 0;
});

describe("the Terra Draw engine", () => {
  it("starts Terra Draw, and draws a rectangle when asked", () => {
    const { created, draw } = engine();
    created.drawRectangle();
    expect(draw.calls).toEqual(["start", "mode:rectangle"]);
  });

  it("reports a finished rectangle as [minX, minY, maxX, maxY], longitude first", () => {
    const { created, draw } = engine();
    const seen: unknown[] = [];
    created.onChange((bbox) => seen.push(bbox));
    // Drawn from the north-east corner to the south-west: the order must not matter.
    finish(draw, "a", [
      [7, 53.6],
      [3, 53.6],
      [3, 50.7],
      [7, 50.7],
      [7, 53.6],
    ]);
    expect(seen).toEqual([[3, 50.7, 7, 53.6]]);
    expect(draw.mode).toBe("select");
  });

  it("keeps one box: a second rectangle replaces the first", () => {
    const { created, draw } = engine();
    created.onChange(() => undefined);
    finish(draw, "a", [
      [1, 1],
      [2, 1],
      [2, 2],
      [1, 2],
      [1, 1],
    ]);
    finish(draw, "b", [
      [3, 3],
      [4, 3],
      [4, 4],
      [3, 4],
      [3, 3],
    ]);
    expect(draw.features.map((feature) => feature.id)).toEqual(["b"]);
  });

  it("reports an edit made in select mode", () => {
    const { created, draw } = engine();
    const seen: unknown[] = [];
    created.onChange((bbox) => seen.push(bbox));
    finish(draw, "a", [
      [1, 1],
      [2, 1],
      [2, 2],
      [1, 2],
      [1, 1],
    ]);
    const feature = draw.features[0];
    if (feature === undefined) throw new Error("no feature");
    feature.geometry.coordinates = [
      [
        [1, 1],
        [5, 1],
        [5, 2],
        [1, 2],
        [1, 1],
      ],
    ];
    draw.listeners.get("change")?.(["a"], "update");
    expect(seen.at(-1)).toEqual([1, 1, 5, 2]);
  });

  it("shows a box set from outside, and clears it", () => {
    const { created, draw } = engine();
    created.show([3, 50.7, 7, 53.6]);
    expect(draw.features[0]?.geometry.coordinates[0]).toEqual([
      [3, 50.7],
      [7, 50.7],
      [7, 53.6],
      [3, 53.6],
      [3, 50.7],
    ]);
    created.show(undefined);
    expect(draw.features).toEqual([]);
  });

  it("stops Terra Draw, which removes its layers and listeners", () => {
    const { created, draw } = engine();
    created.stop();
    expect(draw.calls.at(-1)).toBe("stop");
    expect(draw.started).toBe(false);
  });
});
