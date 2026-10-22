/**
 * The layers for shown shapes, against a stand-in for MapLibre: what goes on
 * the map, that it waits for the style, and that it all comes off again.
 */

import { describe, expect, it } from "vitest";
import {
  clickedIndex,
  createMapLibreShapeLayers,
  featureCollectionOf,
} from "../../src/map/shape-layers.js";

type Listener = (event: { point: { x: number; y: number } }) => void;

/** Enough of a MapLibre map for the layers: sources, layers, `styledata` and clicks. */
function fakeMap({ loaded }: { loaded: boolean }) {
  const sources = new Map<
    string,
    { data?: unknown; spec: unknown; setData: (data: unknown) => Promise<void> }
  >();
  const layers: string[] = [];
  const waiting: (() => void)[] = [];
  /** Listeners added with `on`, by event, with the layer when one was given. */
  const handlers: { event: string; layer: string | undefined; listener: Listener }[] = [];
  /** What `queryRenderedFeatures` answers, and what it was asked. */
  const rendered: { properties?: unknown }[] = [];
  const queried: unknown[] = [];
  const canvas = { style: { cursor: "" }, clientWidth: 800 };
  /** Each layer's filter, as last set (#20). */
  const filters = new Map<string, unknown>();
  const map = {
    loaded,
    sources,
    layers,
    handlers,
    rendered,
    queried,
    canvas,
    filters,
    setFilter(id: string, filter: unknown) {
      if (!layers.includes(id)) throw new Error(`no layer ${id}`);
      filters.set(id, filter);
    },
    on(event: string, layerOrListener: string | Listener, maybe?: Listener) {
      if (typeof layerOrListener === "string") {
        if (maybe !== undefined) handlers.push({ event, layer: layerOrListener, listener: maybe });
      } else {
        handlers.push({ event, layer: undefined, listener: layerOrListener });
      }
    },
    getCanvas: () => canvas,
    queryRenderedFeatures(box: unknown, options: unknown) {
      queried.push({ box, options });
      return rendered;
    },
    /** A click at a pixel, as MapLibre fires it. */
    click(x: number, y: number) {
      map.fire("click", x, y);
    },
    /** Any pointer event at a pixel. */
    fire(event: string, x: number, y: number) {
      for (const handler of handlers.filter((entry) => entry.event === event)) {
        handler.listener({ point: { x, y } });
      }
    },
    addSource(id: string, spec: { data?: unknown }) {
      if (!map.loaded) throw new Error("Style is not done loading.");
      const source = {
        spec,
        data: spec.data,
        setData: (data: unknown) => {
          source.data = data;
          return Promise.resolve();
        },
      };
      sources.set(id, source);
    },
    addLayer(layer: { id: string }, beforeId?: string) {
      const at = beforeId === undefined ? -1 : layers.indexOf(beforeId);
      if (at < 0) layers.push(layer.id);
      else layers.splice(at, 0, layer.id);
    },
    getLayer: (id: string) => (layers.includes(id) ? { id } : undefined),
    getSource: (id: string) => sources.get(id),
    removeLayer(id: string) {
      layers.splice(layers.indexOf(id), 1);
    },
    removeSource(id: string) {
      sources.delete(id);
    },
    once(_event: string, listener: () => void) {
      waiting.push(listener);
    },
    off(event: string, layerOrListener: string | Listener, maybe?: Listener) {
      const listener = typeof layerOrListener === "string" ? maybe : layerOrListener;
      const index = waiting.findIndex((entry) => entry === listener);
      if (index >= 0) waiting.splice(index, 1);
      const at = handlers.findIndex(
        (entry) => entry.event === event && entry.listener === listener,
      );
      if (at >= 0) handlers.splice(at, 1);
    },
    styleLoads() {
      map.loaded = true;
      for (const listener of waiting.splice(0)) listener();
    },
  };
  return map;
}

const polygon = {
  type: "Polygon" as const,
  coordinates: [
    [
      [5, 52],
      [5.1, 52],
      [5.1, 52.1],
      [5, 52],
    ],
  ],
};

describe("featureCollectionOf", () => {
  it("tags every shape with its role", () => {
    const collection = featureCollectionOf([
      { role: "input", shapes: [polygon] },
      { role: "result", shapes: [{ type: "Point", coordinates: [5, 52] }] },
    ]);
    expect(
      collection.features.map((feature) => [
        String(feature.properties?.["role"]),
        feature.geometry.type,
      ]),
    ).toEqual([
      ["input", "Polygon"],
      ["result", "Point"],
    ]);
  });
});

describe("featureCollectionOf: the index a click reports", () => {
  it("numbers each set's shapes from zero, and carries nothing else of theirs", () => {
    const collection = featureCollectionOf([
      { role: "input", shapes: [polygon] },
      { role: "result", shapes: [polygon, { type: "Point", coordinates: [5, 52] }] },
    ]);
    expect(collection.features.map((feature) => feature.properties)).toEqual([
      { role: "input", index: 0 },
      { role: "result", index: 0 },
      { role: "result", index: 1 },
    ]);
  });
});

describe("clickedIndex", () => {
  it("takes the first feature with a whole, non-negative index", () => {
    expect(
      clickedIndex([
        { properties: undefined },
        { properties: { index: "2" } },
        { properties: { index: -1 } },
        { properties: { index: 1.5 } },
        { properties: { index: 3 } },
        { properties: { index: 4 } },
      ]),
    ).toBe(3);
    expect(clickedIndex([])).toBeUndefined();
  });
});

describe("clicking a result", () => {
  it("reports the clicked result's index, asking MapLibre about result layers only", () => {
    const map = fakeMap({ loaded: true });
    const layers = createMapLibreShapeLayers(map as never);
    const seen: unknown[] = [];
    layers.onResultClick((index, at) => seen.push(index, at));
    map.rendered.push({ properties: { role: "result", index: 2 } });
    map.click(100, 50);
    // And where across the map it was, for the properties to open away from it (#20).
    expect(seen).toEqual([2, { x: 100, width: 800 }]);
    expect(map.queried).toEqual([
      {
        box: [
          [96, 46],
          [104, 54],
        ],
        options: {
          layers: ["oap-shown-result-fill", "oap-shown-result-line", "oap-shown-result-point"],
        },
      },
    ]);
  });

  it("reports nothing for a click beside every result", () => {
    const map = fakeMap({ loaded: true });
    const layers = createMapLibreShapeLayers(map as never);
    const seen: number[] = [];
    layers.onResultClick((index) => seen.push(index));
    map.click(10, 10);
    expect(seen).toEqual([]);
  });

  it("stops listening when stopped", () => {
    const map = fakeMap({ loaded: true });
    const layers = createMapLibreShapeLayers(map as never);
    expect(map.handlers.length).toBeGreaterThan(0);
    layers.stop();
    expect(map.handlers).toEqual([]);
  });
});

describe("the pointer over a result", () => {
  function hovered() {
    const map = fakeMap({ loaded: true });
    const layers = createMapLibreShapeLayers(map as never);
    layers.onResultClick(() => undefined);
    return { map, layers };
  }

  it("is the pointing hand wherever a click would show a result, the open hand elsewhere", () => {
    const { map } = hovered();
    map.rendered.push({ properties: { role: "result", index: 0 } });
    map.fire("mousemove", 100, 50);
    expect(map.canvas.style.cursor).toBe("pointer");
    map.rendered.splice(0);
    map.fire("mousemove", 10, 10);
    expect(map.canvas.style.cursor).toBe("");
  });

  it("stays the pointing hand moving from a shape's outline onto its fill", () => {
    const { map } = hovered();
    // The outline, then the fill: two layers, one shape.
    map.rendered.push({ properties: { role: "result", index: 0 } });
    map.fire("mousemove", 100, 50);
    map.rendered.splice(0, 1, { properties: { role: "result", index: 0 } });
    map.fire("mousemove", 104, 50);
    expect(map.canvas.style.cursor).toBe("pointer");
  });

  it("is the open hand again when the pointer leaves the map, or the layers stop", () => {
    const { map, layers } = hovered();
    map.rendered.push({ properties: { role: "result", index: 0 } });
    map.fire("mousemove", 100, 50);
    map.fire("mouseout", 0, 0);
    expect(map.canvas.style.cursor).toBe("");
    map.fire("mousemove", 100, 50);
    layers.stop();
    expect(map.canvas.style.cursor).toBe("");
  });

  it("is never the pointing hand over an input, which a click does not show", () => {
    const { map } = hovered();
    map.fire("mousemove", 100, 50);
    expect(map.canvas.style.cursor).toBe("");
  });
});

describe("createMapLibreShapeLayers", () => {
  it("adds one source and a layer per role and kind, input below result", () => {
    const map = fakeMap({ loaded: true });
    createMapLibreShapeLayers(map as never);
    expect([...map.sources.keys()]).toEqual(["oap-shown"]);
    // And the outline of a clicked result, over both (#20).
    expect(map.layers).toHaveLength(9);
    expect(map.layers.indexOf("oap-shown-input-fill")).toBeLessThan(
      map.layers.indexOf("oap-shown-result-fill"),
    );
    expect(map.layers.slice(-3)).toEqual([
      "oap-shown-selected-casing",
      "oap-shown-selected-line",
      "oap-shown-selected-point",
    ]);
  });

  it("outlines the selected result shape, and none once it is put down (#20)", () => {
    const map = fakeMap({ loaded: false });
    const layers = createMapLibreShapeLayers(map as never);
    // Asked before the style is in: done once it is.
    layers.select(2);
    map.styleLoads();
    const indexIn = (filter: unknown) => JSON.stringify(filter).match(/"index"\],(-?\d+)/)?.[1];
    expect(indexIn(map.filters.get("oap-shown-selected-line"))).toBe("2");
    expect(indexIn(map.filters.get("oap-shown-selected-point"))).toBe("2");
    expect(JSON.stringify(map.filters.get("oap-shown-selected-line"))).toContain('"result"');
    layers.select(undefined);
    expect(indexIn(map.filters.get("oap-shown-selected-casing"))).toBe("-1");
  });

  it("waits for the style, keeps what it was asked to show meanwhile, then says it is ready", () => {
    const map = fakeMap({ loaded: false });
    const layers = createMapLibreShapeLayers(map as never);
    let ready = false;
    layers.onReady(() => {
      ready = true;
    });
    layers.show([{ role: "result", shapes: [polygon] }]);
    expect(map.sources.size).toBe(0);
    expect(ready).toBe(false);

    map.styleLoads();
    expect(ready).toBe(true);
    expect(map.sources.get("oap-shown")?.data).toEqual(
      featureCollectionOf([{ role: "result", shapes: [polygon] }]),
    );
  });

  it("replaces the shown shapes", () => {
    const map = fakeMap({ loaded: true });
    const layers = createMapLibreShapeLayers(map as never);
    layers.show([{ role: "result", shapes: [polygon] }]);
    layers.show([]);
    expect(map.sources.get("oap-shown")?.data).toEqual(featureCollectionOf([]));
  });

  it("takes everything off the map when stopped, and stops waiting for the style", () => {
    const loadedMap = fakeMap({ loaded: true });
    createMapLibreShapeLayers(loadedMap as never).stop();
    expect(loadedMap.layers).toEqual([]);
    expect(loadedMap.sources.size).toBe(0);

    const loadingMap = fakeMap({ loaded: false });
    createMapLibreShapeLayers(loadingMap as never).stop();
    loadingMap.styleLoads();
    expect(loadingMap.sources.size).toBe(0);
  });

  it("places an image beneath the shapes, at its four corners", () => {
    const map = fakeMap({ loaded: true });
    const layers = createMapLibreShapeLayers(map as never);
    layers.showImage({ url: "data:image/jpeg;base64,AA==", bounds: [5.1, 52.08, 5.14, 52.1] });
    expect(map.layers[0]).toBe("oap-shown-image");
    expect(map.sources.get("oap-shown-image")?.spec).toEqual({
      type: "image",
      url: "data:image/jpeg;base64,AA==",
      coordinates: [
        [5.1, 52.1],
        [5.14, 52.1],
        [5.14, 52.08],
        [5.1, 52.08],
      ],
    });
  });

  it("replaces an image, removes it, and waits for the style before placing one", () => {
    const map = fakeMap({ loaded: false });
    const layers = createMapLibreShapeLayers(map as never);
    layers.showImage({ url: "data:first", bounds: [5, 52, 5.1, 52.1] });
    layers.showImage({ url: "data:second", bounds: [5, 52, 5.1, 52.1] });
    expect(map.sources.has("oap-shown-image")).toBe(false);

    map.styleLoads();
    expect(map.sources.get("oap-shown-image")?.spec).toMatchObject({ url: "data:second" });
    expect(map.layers.filter((id) => id === "oap-shown-image")).toHaveLength(1);

    layers.showImage(undefined);
    expect(map.sources.has("oap-shown-image")).toBe(false);
    expect(map.layers).not.toContain("oap-shown-image");
  });
});
