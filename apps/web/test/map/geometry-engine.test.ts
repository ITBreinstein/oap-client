/**
 * The GeoJSON draw engine against the real Terra Draw (see `real-terra-draw.ts`
 * for why, and for the one stand-in left, the map). The first block, what
 * leaves the engine, is Sam's, from `apps/web/test/map/draw-geometry.test.ts`
 * on `feat/T3-prototype-interface-2`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { GeometryDrawState, MapShape, Tool } from "../../src/map/geometry-engine.js";
import { drawnShapes, fakeMap, lastDraw, resetTerraDraw, user } from "./real-terra-draw.js";

vi.mock("terra-draw", async (original) =>
  (await import("./real-terra-draw.js")).spyOnTerraDraw(await original()),
);
vi.mock("terra-draw-maplibre-gl-adapter", async (original) =>
  (await import("./real-terra-draw.js")).spyOnAdapter(await original()),
);

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
} as const;
const triangleShape: MapShape = {
  type: "Polygon",
  coordinates: triangle.coordinates.map((ring) => ring.map((position) => [...position])),
};
/** A square with a square hole: Terra Draw refuses holes. */
const withHole: MapShape = {
  type: "Polygon",
  coordinates: [
    [
      [5.0, 52.0],
      [5.4, 52.0],
      [5.4, 52.4],
      [5.0, 52.4],
      [5.0, 52.0],
    ],
    [
      [5.1, 52.1],
      [5.1, 52.2],
      [5.2, 52.2],
      [5.2, 52.1],
      [5.1, 52.1],
    ],
  ],
};
/** Terra Draw refuses a position with a height. */
const lineWithHeights: MapShape = {
  type: "LineString",
  coordinates: [
    [5.1, 52.1, 3],
    [5.2, 52.2, 4],
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

function engine(tools: Tool[], several: boolean) {
  const created = createTerraDrawGeometryEngine(fakeMap().map, { tools, several });
  const reported: (readonly MapShape[])[] = [];
  const states: GeometryDrawState[] = [];
  created.onChange((shapes) => reported.push(shapes));
  created.onState((state) => states.push(state));
  return { created, draw: lastDraw(), reported, states };
}

/** Click each corner, then the first one again to close the area. */
function drawArea(corners: readonly (readonly [number, number])[]) {
  for (const [lng, lat] of corners) user.click(lng, lat);
  const [first] = corners;
  if (first !== undefined) user.click(...first);
}

/** Click two opposite corners. */
function drawBox(from: readonly [number, number], to: readonly [number, number]) {
  user.click(...from);
  user.click(...to);
}

afterEach(() => {
  resetTerraDraw();
});

describe("the geometry engine, on the real Terra Draw", () => {
  it("registers only the offered tools, and rests in select mode", () => {
    const { created, draw } = engine(["Polygon"], false);
    expect(draw.getMode()).toBe("select");
    created.place("Point");
    expect(draw.getMode()).toBe("select");
    created.place("Polygon");
    expect(draw.getMode()).toBe("polygon");
  });

  it("reports a finished shape, returns to editing, and selects it", () => {
    const { created, draw, reported, states } = engine(["Point"], false);
    created.place("Point");
    user.click(5, 52);
    expect(reported).toEqual([[{ type: "Point", coordinates: [5, 52] }]]);
    expect(draw.getMode()).toBe("select");
    expect(states.at(-1)).toEqual({ placing: undefined, hasSelection: true, notShown: 0 });
  });

  it("Terra Draw reports our own calls synchronously, inside the call", () => {
    // What makes a guard around our own calls work at all.
    const { created, draw } = engine(["Polygon"], true);
    const heard: string[] = [];
    draw.on("change", (_ids, type) => heard.push(type));
    created.show([triangleShape]);
    expect(heard).toContain("create");
  });
});

describe("an input that holds one shape (W1)", () => {
  it("replaces an area it was shown with a box the user draws", () => {
    const { created, draw, reported } = engine(["Polygon", "Rectangle"], false);
    created.show([triangleShape]);
    created.place("Rectangle");
    expect(() => {
      drawBox([5.5, 52.5], [5.6, 52.6]);
    }).not.toThrow();
    expect(reported).toHaveLength(1);
    expect(reported[0]).toHaveLength(1);
    expect(draw.getMode()).toBe("select");
    expect(drawnShapes(draw)).toHaveLength(1);
  });

  it("replaces an area the user drew with a second one", () => {
    const { created, draw, reported } = engine(["Polygon", "Rectangle"], false);
    created.place("Polygon");
    drawArea([
      [5.0, 52.0],
      [5.2, 52.0],
      [5.1, 52.2],
    ]);
    created.place("Polygon");
    expect(() => {
      drawArea([
        [6.0, 52.0],
        [6.2, 52.0],
        [6.1, 52.2],
      ]);
    }).not.toThrow();
    expect(reported).toHaveLength(2);
    const [second] = reported.at(-1) ?? [];
    expect(second?.type).toBe("Polygon");
    expect(second?.type === "Polygon" ? second.coordinates[0]?.[0] : undefined).toEqual([6, 52]);
    expect(draw.getMode()).toBe("select");
    expect(drawnShapes(draw)).toHaveLength(1);
  });

  it("replaces a point with the next point", () => {
    const { created, draw } = engine(["Point"], false);
    created.place("Point");
    user.click(4.6, 52.1);
    created.place("Point");
    user.click(5, 52);
    expect(drawnShapes(draw).map((shape) => shape.geometry)).toEqual([
      { type: "Point", coordinates: [5, 52] },
    ]);
  });
});

describe("an input that holds several shapes", () => {
  it("keeps every shape drawn", () => {
    const { created, draw, reported } = engine(["Point"], true);
    created.place("Point");
    user.click(4.6, 52.1);
    created.place("Point");
    user.click(5, 52);
    expect(drawnShapes(draw)).toHaveLength(2);
    expect(reported.at(-1)).toHaveLength(2);
  });

  it("deletes the selected shape, and reports what is left", () => {
    const { created, draw, reported } = engine(["Point"], true);
    created.place("Point");
    user.click(4.6, 52.1);
    created.deleteSelected();
    expect(drawnShapes(draw)).toEqual([]);
    expect(reported.at(-1)).toEqual([]);
  });
});

describe("a value shown from outside", () => {
  it("is not reported back as the user's doing (#24)", () => {
    const { created, draw, reported } = engine(["Polygon"], false);
    created.show([triangleShape]);
    created.show([triangleShape]);
    expect(reported).toEqual([]);
    expect(drawnShapes(draw)).toHaveLength(1);
  });

  it("is rounded to the nine decimals Terra Draw accepts", () => {
    const { created, draw } = engine(["Point"], false);
    created.show([{ type: "Point", coordinates: [5.1234567891234, 52] }]);
    expect(drawnShapes(draw)[0]?.geometry.coordinates).toEqual([5.123456789, 52]);
  });

  it("still lets a deletion Terra Draw makes for the user through", () => {
    const { created, draw, reported } = engine(["Polygon"], false);
    created.show([triangleShape]);
    const [shown] = drawnShapes(draw);
    // Not one of the engine's calls: as when Terra Draw deletes a shape itself.
    draw.removeFeatures([shown?.id ?? ""]);
    expect(reported).toEqual([[]]);
  });
});

describe("selecting and deselecting is not an edit (W16)", () => {
  it("reports nothing, so the field keeps its GeoJSON as it was", () => {
    const { created, draw, reported } = engine(
      ["Point", "LineString", "Polygon", "Rectangle"],
      true,
    );
    created.show([triangleShape]);
    const [shown] = drawnShapes(draw);
    const id = shown?.id ?? "";
    draw.selectFeature(id);
    draw.deselectFeature(id);
    expect(reported).toEqual([]);
  });

  it("does report a shape the user moves", () => {
    const { created, draw, reported } = engine(["Point"], true);
    created.show([{ type: "Point", coordinates: [5, 52] }]);
    const [shown] = drawnShapes(draw);
    draw.selectFeature(shown?.id ?? "");
    user.drag([5, 52], [5.1, 52.1]);
    expect(reported.at(-1)).toEqual([{ type: "Point", coordinates: [5.1, 52.1] }]);
  });
});

describe("shapes the map cannot show are kept in the value (W17)", () => {
  it("keeps an area with a hole beside the shapes drawn, and says so", () => {
    const { created, draw, reported, states } = engine(
      ["Point", "LineString", "Polygon", "Rectangle"],
      true,
    );
    created.show([withHole, triangleShape]);
    expect(drawnShapes(draw)).toHaveLength(1);
    expect(states.at(-1)?.notShown).toBe(1);

    created.place("Point");
    user.click(6, 53);
    const last = reported.at(-1) ?? [];
    expect(last).toHaveLength(3);
    expect(last).toContainEqual(withHole);
  });

  it("keeps positions with a height", () => {
    const { created, reported } = engine(["Point", "LineString", "Polygon", "Rectangle"], true);
    created.show([lineWithHeights, triangleShape]);
    created.place("Point");
    user.click(6, 53);
    expect(reported.at(-1)).toContainEqual(lineWithHeights);
  });

  it("keeps a shape no offered tool draws", () => {
    const { created, reported, states } = engine(["Point"], true);
    created.show([triangleShape, { type: "Point", coordinates: [5, 52] }]);
    expect(states.at(-1)?.notShown).toBe(1);
    created.place("Point");
    user.click(6, 53);
    expect(reported.at(-1)).toContainEqual(triangleShape);
  });

  it("lets a newly drawn shape replace them, when the input holds one", () => {
    const { created, draw, reported, states } = engine(["Polygon", "Rectangle"], false);
    created.show([withHole]);
    created.place("Rectangle");
    drawBox([5.5, 52.5], [5.6, 52.6]);
    // Exactly the new box: nothing kept, nothing shown before.
    const drawn = shapesOfSnapshot(draw.getSnapshot());
    expect(drawn).toHaveLength(1);
    expect(reported.at(-1)).toEqual(drawn);
    expect(states.at(-1)?.notShown).toBe(0);
  });

  it("replaces kept and shown shapes alike with the one area drawn, when the input holds one", () => {
    const { created, draw, reported, states } = engine(["Polygon", "Rectangle"], false);
    // A refused area, an area the map shows, and a point no offered tool draws.
    created.show([withHole, triangleShape, { type: "Point", coordinates: [5, 52] }]);
    expect(states.at(-1)?.notShown).toBe(2);

    created.place("Polygon");
    drawArea([
      [6.0, 52.0],
      [6.2, 52.0],
      [6.1, 52.2],
    ]);
    const drawn = shapesOfSnapshot(draw.getSnapshot());
    expect(drawn).toHaveLength(1);
    expect(reported.at(-1)).toEqual(drawn);
    const [area] = reported.at(-1) ?? [];
    expect(area?.type === "Polygon" ? area.coordinates[0]?.[0] : undefined).toEqual([6, 52]);
    expect(states.at(-1)?.notShown).toBe(0);
  });
});

describe("stopping", () => {
  it("removes the draw mode and its layers", () => {
    const fake = fakeMap();
    const created = createTerraDrawGeometryEngine(fake.map, { tools: ["Point"], several: false });
    expect(fake.sources.size).toBeGreaterThan(0);
    created.stop();
    expect(lastDraw().enabled).toBe(false);
    expect(fake.sources.size).toBe(0);
  });

  it("does not throw once MapView's ref cleanup has removed the map (W29)", () => {
    const fake = fakeMap();
    const created = createTerraDrawGeometryEngine(fake.map, { tools: ["Polygon"], several: true });
    fake.remove();
    expect(() => {
      created.stop();
    }).not.toThrow();
  });
});
