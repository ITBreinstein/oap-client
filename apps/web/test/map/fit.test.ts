/**
 * Moving the map to what it shows, however much that is (review W3): the
 * bounds of 150 000 positions — about 3.3 MB of GeoJSON, well under the 8 MB
 * the page reads — used to be spread into `Math.min(...)`, which V8 refuses
 * past about 120 000 arguments. The RangeError escaped from an effect and
 * React took the whole page down.
 */

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { boundsOf, moveTo } from "../../src/map/fit.js";
import type { MapShape } from "../../src/map/geometry-engine.js";
import type { CreateShapeLayers, ShownShapes } from "../../src/map/shape-layers.js";
import { useShownShapes } from "../../src/map/useShownShapes.js";

function bigLine(count: number): MapShape {
  const coordinates: number[][] = [];
  for (let index = 0; index < count; index += 1) {
    coordinates.push([4 + (index % 1000) / 1000, 52 + Math.floor(index / 1000) / 1000]);
  }
  return { type: "LineString", coordinates };
}

describe("boundsOf", () => {
  it("is the box around every position of every shape", () => {
    expect(
      boundsOf([
        { type: "Point", coordinates: [5, 52] },
        {
          type: "Polygon",
          coordinates: [
            [
              [4, 51],
              [6, 51],
              [6, 53],
              [4, 51],
            ],
          ],
        },
      ]),
    ).toEqual([4, 51, 6, 53]);
  });

  it("skips coordinates that are not finite, and is undefined for no positions", () => {
    expect(
      boundsOf([
        {
          type: "LineString",
          coordinates: [
            [Number.NaN, 52],
            [5, 53],
          ],
        },
      ]),
    ).toEqual([5, 52, 5, 53]);
    expect(boundsOf([])).toBeUndefined();
  });

  it("copes with 150 000 positions", () => {
    expect(boundsOf([bigLine(150_000)])).toEqual([4, 52, 4.999, 52.149]);
  });
});

describe("moveTo", () => {
  it("fits the map to 150 000 positions", () => {
    const fitted: unknown[] = [];
    const map = { fitBounds: (bounds: unknown) => fitted.push(bounds) } as never;
    moveTo(map, [bigLine(150_000)]);
    expect(fitted).toEqual([
      [
        [4, 52],
        [4.999, 52.149],
      ],
    ]);
  });

  it("never throws, whatever the map does", () => {
    const map = {
      fitBounds: () => {
        throw new Error("not ready");
      },
    } as never;
    expect(() => {
      moveTo(map, [bigLine(10)]);
    }).not.toThrow();
  });
});

describe("a large result reaching the map", () => {
  it("leaves the page on screen", async () => {
    const layers: CreateShapeLayers = () => ({
      show: () => undefined,
      showImage: () => undefined,
      onReady: (listener) => {
        listener();
      },
      onResultClick: () => undefined,
      stop: () => undefined,
    });
    const map = { fitBounds: () => undefined } as never;
    const result: readonly ShownShapes[] = [
      { role: "input", shapes: [] },
      { role: "result", shapes: [bigLine(150_000)] },
    ];
    function Page() {
      useShownShapes(map, result, undefined, layers);
      return createElement("p", null, "Result: 1 output");
    }
    const container = document.createElement("div");
    const uncaught: unknown[] = [];
    const root = createRoot(container, {
      onUncaughtError: (error) => {
        uncaught.push(error);
      },
    });
    await act(async () => {
      root.render(createElement(Page));
      await Promise.resolve();
    });
    expect(container.textContent).toBe("Result: 1 output");
    expect(uncaught).toEqual([]);
    root.unmount();
  });
});
