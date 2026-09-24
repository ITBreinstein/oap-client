import type { Feature, Point, Polygon } from "geojson";
import { describe, expect, it } from "vitest";
import { toCollection } from "../../src/map/draw-geometry.js";

function feature(properties: Record<string, unknown>, geometry: Feature["geometry"]): Feature {
  return { type: "Feature", properties, geometry };
}

const corner: Point = { type: "Point", coordinates: [4.6, 52.1] };
const triangle: Polygon = {
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

describe("what leaves the drawing binding", () => {
  it("drops the coordinate dots drawn on a polygon", () => {
    const snapshot = [
      feature({ mode: "polygon" }, triangle),
      feature({ mode: "polygon", coordinatePoint: true }, corner),
      feature({ mode: "polygon", coordinatePoint: true }, corner),
    ];

    const { features } = toCollection(snapshot);
    expect(features).toHaveLength(1);
    expect(features[0]?.geometry.type).toBe("Polygon");
  });

  it("drops midpoints and selection points too", () => {
    const snapshot = [
      feature({ mode: "polygon" }, triangle),
      feature({ mode: "polygon", midPoint: true }, corner),
      feature({ mode: "polygon", selectionPoint: true }, corner),
      feature({ mode: "polygon", closingPoint: true }, corner),
      feature({ mode: "polygon", snappingPoint: true }, corner),
    ];

    expect(toCollection(snapshot).features).toHaveLength(1);
  });

  it("keeps a point the user actually placed", () => {
    const snapshot = [feature({ mode: "point" }, corner)];
    expect(toCollection(snapshot).features).toHaveLength(1);
  });

  it("keeps a shape the user edited", () => {
    // `edited` marks a real shape that was moved, not a handle.
    const snapshot = [feature({ mode: "polygon", edited: true }, triangle)];
    expect(toCollection(snapshot).features).toHaveLength(1);
  });

  it("strips Terra Draw's bookkeeping from what it keeps", () => {
    const snapshot = [feature({ mode: "polygon", edited: false, selected: true }, triangle)];
    expect(toCollection(snapshot).features[0]?.properties).toEqual({});
  });
});
