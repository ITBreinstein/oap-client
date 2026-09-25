/**
 * Shapes into the GeoJSON an input takes: the wrapper and geometry types come
 * from the plan, and whatever does not fit is counted rather than dropped.
 */

import { describe, expect, it } from "vitest";
import type { Shape } from "../../src/forms/geojson.js";
import {
  ANY_FEATURE_COLLECTION,
  drawableTypes,
  holdsSeveral,
  shapesOfText,
  toGeoJson,
  type GeometryTarget,
} from "../../src/forms/geometry.js";

const RING = [
  [5.1, 52.1],
  [5.2, 52.1],
  [5.2, 52.2],
  [5.1, 52.1],
];
const area: Shape = { type: "Polygon", coordinates: [RING] };
const other: Shape = { type: "Polygon", coordinates: [RING.map(([x = 0, y = 0]) => [x + 1, y])] };
const point: Shape = { type: "Point", coordinates: [5.1, 52.1] };
const line: Shape = { type: "LineString", coordinates: [RING[0] ?? [], RING[1] ?? []] };

const geometry = (...geometryTypes: GeometryTarget["geometryTypes"]): GeometryTarget => ({
  wrapper: "geometry",
  geometryTypes,
});

describe("which tools an input offers", () => {
  it("offers only the shapes the plan allows", () => {
    expect(drawableTypes(geometry("Polygon"))).toEqual(["Polygon"]);
    expect(drawableTypes(geometry("MultiPoint", "LineString"))).toEqual(["Point", "LineString"]);
  });

  it("offers every shape for a geometry collection", () => {
    expect(drawableTypes(geometry("GeometryCollection"))).toEqual([
      "Point",
      "LineString",
      "Polygon",
    ]);
  });

  it("holds several shapes only where the input can carry them", () => {
    expect(holdsSeveral(geometry("Polygon"))).toBe(false);
    expect(holdsSeveral(geometry("Polygon", "MultiPolygon"))).toBe(true);
    expect(holdsSeveral({ wrapper: "feature-collection", geometryTypes: ["Point"] })).toBe(true);
  });
});

describe("the GeoJSON for what was drawn", () => {
  it("sends one shape as a bare geometry", () => {
    expect(toGeoJson(geometry("Polygon"), [area])).toEqual({
      geojson: area,
      used: 1,
      ignored: {},
    });
  });

  it("wraps it in a Feature when the input wants one", () => {
    const shaped = toGeoJson({ wrapper: "feature", geometryTypes: ["Polygon"] }, [area]);
    expect(shaped.geojson).toEqual({ type: "Feature", properties: {}, geometry: area });
  });

  it("makes several of one type a Multi geometry, when the input accepts one", () => {
    const shaped = toGeoJson(geometry("Polygon", "MultiPolygon"), [area, other]);
    expect(shaped.geojson).toEqual({
      type: "MultiPolygon",
      coordinates: [area.coordinates, other.coordinates],
    });
    expect(shaped.used).toBe(2);
  });

  it("makes a single shape a Multi geometry when that is all the input takes", () => {
    expect(toGeoJson(geometry("MultiPolygon"), [area]).geojson).toEqual({
      type: "MultiPolygon",
      coordinates: [area.coordinates],
    });
  });

  it("mixes types only in a GeometryCollection", () => {
    expect(toGeoJson(geometry("GeometryCollection"), [area, point]).geojson).toEqual({
      type: "GeometryCollection",
      geometries: [area, point],
    });
  });

  it("keeps the first fitting shape, and counts the rest, when only one fits", () => {
    expect(toGeoJson(geometry("Polygon", "Point"), [point, area])).toEqual({
      geojson: point,
      used: 1,
      ignored: { Polygon: 1 },
    });
  });

  it("counts shapes of a type the input does not take", () => {
    expect(toGeoJson(geometry("Polygon"), [line, area, point])).toEqual({
      geojson: area,
      used: 1,
      ignored: { LineString: 1, Point: 1 },
    });
  });

  it("gives nothing when nothing fits", () => {
    expect(toGeoJson(geometry("Polygon"), [point]).geojson).toBeUndefined();
    expect(toGeoJson(geometry("Polygon"), []).geojson).toBeUndefined();
  });

  it("puts every shape in a FeatureCollection for a complex input's object format", () => {
    const shaped = toGeoJson(ANY_FEATURE_COLLECTION, [area, point]);
    expect(shaped.geojson).toEqual({
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: {}, geometry: area },
        { type: "Feature", properties: {}, geometry: point },
      ],
    });
  });
});

describe("back from text to shapes", () => {
  it("round-trips what was drawn, Multi geometries split again", () => {
    const shaped = toGeoJson(geometry("MultiPolygon"), [area, other]);
    expect(shapesOfText(JSON.stringify(shaped.geojson))).toEqual([area, other]);
  });

  it("shows nothing for text that is empty, not JSON, or not GeoJSON", () => {
    expect(shapesOfText("")).toEqual([]);
    expect(shapesOfText("{ half")).toEqual([]);
    expect(shapesOfText("[1, 2]")).toEqual([]);
    expect(shapesOfText('{"hello": "world"}')).toEqual([]);
  });
});
