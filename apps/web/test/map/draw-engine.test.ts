/**
 * The bounding-box draw engine against the real Terra Draw (see
 * `real-terra-draw.ts` for why, and for the one stand-in left, the map): what
 * it reports when the user draws, moves or resizes a box, and what it keeps to
 * itself.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bbox } from "../../src/map/bbox.js";
import { drawnShapes, fakeMap, lastDraw, resetTerraDraw, user } from "./real-terra-draw.js";

vi.mock("terra-draw", async (original) =>
  (await import("./real-terra-draw.js")).spyOnTerraDraw(await original()),
);
vi.mock("terra-draw-maplibre-gl-adapter", async (original) =>
  (await import("./real-terra-draw.js")).spyOnAdapter(await original()),
);

const { createTerraDrawEngine } = await import("../../src/map/draw-engine.js");

function engine() {
  const fake = fakeMap();
  const created = createTerraDrawEngine(fake.map);
  const reported: Bbox[] = [];
  created.onChange((bbox) => reported.push(bbox));
  return { created, draw: lastDraw(), reported, fake };
}

/** Draw a box by clicking two opposite corners, as the rectangle mode allows. */
function drawBox(from: readonly [number, number], to: readonly [number, number]) {
  user.click(...from);
  user.click(...to);
}

function selected(draw: ReturnType<typeof lastDraw>): boolean {
  return drawnShapes(draw).some((shape) => shape.properties["selected"] === true);
}

afterEach(() => {
  resetTerraDraw();
});

describe("the bounding-box engine, on the real Terra Draw", () => {
  it("starts in no mode of its own, and draws a rectangle when asked", () => {
    const { created, draw } = engine();
    created.drawRectangle();
    expect(draw.getMode()).toBe("rectangle");
  });

  it("reports a drawn box as [minX, minY, maxX, maxY], longitude first, then edits it", () => {
    const { created, draw, reported } = engine();
    created.drawRectangle();
    // From the north-east corner to the south-west: the order must not matter.
    drawBox([7, 53.6], [3, 50.7]);
    expect(reported).toEqual([[3, 50.7, 7, 53.6]]);
    expect(draw.getMode()).toBe("select");
  });

  it("keeps one box: a second one replaces the first", () => {
    const { created, draw } = engine();
    created.drawRectangle();
    drawBox([1, 1], [2, 2]);
    created.drawRectangle();
    drawBox([3, 3], [4, 4]);
    expect(drawnShapes(draw)).toHaveLength(1);
  });

  it("reports the box the user moves", () => {
    const { created, draw, reported } = engine();
    created.drawRectangle();
    drawBox([5, 52], [5.2, 52.2]);
    const [box] = drawnShapes(draw);
    draw.selectFeature(box?.id ?? "");
    user.drag([5.1, 52.1], [5.3, 52.3]);
    // Terra Draw moves a shape in Web Mercator, so latitudes land a little off.
    const [west, south, east, north] = reported.at(-1) ?? [];
    expect(west).toBeCloseTo(5.2, 6);
    expect(east).toBeCloseTo(5.4, 6);
    expect(south).toBeCloseTo(52.2, 2);
    expect(north).toBeCloseTo(52.4, 2);
  });

  it("keeps the box selected after a move, ready for the next one (W31)", () => {
    const { created, draw } = engine();
    created.drawRectangle();
    drawBox([5, 52], [5.2, 52.2]);
    const [box] = drawnShapes(draw);
    draw.selectFeature(box?.id ?? "");
    user.drag([5.1, 52.1], [5.3, 52.3]);
    expect(draw.getMode()).toBe("select");
    expect(selected(draw)).toBe(true);
  });

  it("shows a box set from outside, and clears it, without reporting either", () => {
    const { created, draw, reported } = engine();
    created.show([3, 50.7, 7, 53.6]);
    expect(drawnShapes(draw)[0]?.geometry.coordinates).toEqual([
      [
        [3, 50.7],
        [7, 50.7],
        [7, 53.6],
        [3, 53.6],
        [3, 50.7],
      ],
    ]);
    created.show(undefined);
    expect(drawnShapes(draw)).toEqual([]);
    expect(reported).toEqual([]);
  });

  it("stops Terra Draw, which removes its layers", () => {
    const { created, draw, fake } = engine();
    created.stop();
    expect(draw.enabled).toBe(false);
    expect(fake.sources.size).toBe(0);
  });

  it("does not throw once MapView's ref cleanup has removed the map (W29)", () => {
    const { created, fake } = engine();
    fake.remove();
    expect(() => {
      created.stop();
    }).not.toThrow();
  });
});

describe("a box shown while the drawn one is selected (W15)", () => {
  it("is not reported back as the old box", () => {
    const { created, draw, reported } = engine();
    created.drawRectangle();
    drawBox([5, 52], [5.2, 52.2]);
    const [box] = drawnShapes(draw);
    draw.selectFeature(box?.id ?? "");
    reported.length = 0;

    // Typed coordinates, then Clear: both shown by the hook, neither the user's drawing.
    created.show([4, 51, 4.5, 51.5]);
    created.show(undefined);
    expect(reported).toEqual([]);
  });
});
