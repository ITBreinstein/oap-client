/**
 * The layers for shown shapes, against a stand-in for MapLibre: what goes on
 * the map, that it waits for the style, and that it all comes off again.
 */

import { describe, expect, it } from "vitest";
import { createMapLibreShapeLayers, featureCollectionOf } from "../../src/map/shape-layers.js";

/** Enough of a MapLibre map for the layers: sources, layers and `styledata`. */
function fakeMap({ loaded }: { loaded: boolean }) {
  const sources = new Map<string, { data: unknown; setData: (data: unknown) => Promise<void> }>();
  const layers: string[] = [];
  const waiting: (() => void)[] = [];
  const map = {
    loaded,
    sources,
    layers,
    addSource(id: string, spec: { data: unknown }) {
      if (!map.loaded) throw new Error("Style is not done loading.");
      const source = {
        data: spec.data,
        setData: (data: unknown) => {
          source.data = data;
          return Promise.resolve();
        },
      };
      sources.set(id, source);
    },
    addLayer(layer: { id: string }) {
      layers.push(layer.id);
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
    off(_event: string, listener: () => void) {
      const index = waiting.indexOf(listener);
      if (index >= 0) waiting.splice(index, 1);
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

describe("createMapLibreShapeLayers", () => {
  it("adds one source and a layer per role and kind, input below result", () => {
    const map = fakeMap({ loaded: true });
    createMapLibreShapeLayers(map as never);
    expect([...map.sources.keys()]).toEqual(["oap-shown"]);
    expect(map.layers).toHaveLength(6);
    expect(map.layers.indexOf("oap-shown-input-fill")).toBeLessThan(
      map.layers.indexOf("oap-shown-result-fill"),
    );
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
});
