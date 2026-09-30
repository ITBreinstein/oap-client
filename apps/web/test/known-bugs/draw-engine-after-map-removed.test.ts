/**
 * Review 2026-09-30, W29: stopping a draw engine after MapView's ref cleanup
 * has already removed the map. React 19 runs the ref cleanup (`map.remove()`,
 * MapView.tsx) in the mutation phase and the hooks' effect cleanups
 * (`engine.stop()`) afterwards, so the real Terra Draw's own `stop()` meets a
 * map with no style. Latent: `App` never unmounts MapView while drawing today.
 *
 * Runs on the real Terra Draw and its real MapLibre adapter. The map is a
 * stand-in that behaves like MapLibre 6.11 after `remove()`: the style is gone
 * (`delete this.style`), so its style methods throw.
 */

import { describe, expect, it } from "vitest";
import { createTerraDrawGeometryEngine } from "../../src/map/geometry-engine.js";

function removableMap() {
  const container = document.createElement("div");
  const canvas = document.createElement("canvas");
  container.append(canvas);
  const sources = new Set<string>();
  let removed = false;
  const gone = (method: string) =>
    new TypeError(`Cannot read properties of undefined (reading '${method}')`);
  const toggle = { isEnabled: () => true, enable: () => undefined, disable: () => undefined };
  const map = {
    version: "6.11.1",
    getContainer: () => container,
    getCanvas: () => canvas,
    dragRotate: toggle,
    dragPan: toggle,
    doubleClickZoom: toggle,
    hasImage: () => false,
    addSource(id: string) {
      if (removed) throw gone("addSource");
      sources.add(id);
    },
    getSource: (id: string) =>
      removed || !sources.has(id) ? undefined : { setData: () => undefined },
    addLayer() {
      if (removed) throw gone("addLayer");
    },
    removeLayer() {
      if (removed) throw gone("removeLayer");
    },
    removeSource(id: string) {
      if (removed) throw gone("removeSource");
      sources.delete(id);
    },
    moveLayer: () => undefined,
    project: ({ lng, lat }: { lng: number; lat: number }) => ({ x: lng * 1000, y: -lat * 1000 }),
    unproject: ({ x, y }: { x: number; y: number }) => ({ lng: x / 1000, lat: -y / 1000 }),
  };
  return {
    map: map as never,
    remove() {
      removed = true;
    },
  };
}

describe("unmounting the map while a draw mode is active", () => {
  it.fails(
    "W29: stops the engine without throwing after MapView's ref cleanup removed the map",
    () => {
      const fake = removableMap();
      const engine = createTerraDrawGeometryEngine(fake.map, { tools: ["Polygon"], several: true });
      fake.remove();
      expect(() => {
        engine.stop();
      }).not.toThrow();
    },
  );
});
