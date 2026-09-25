/**
 * The GeoJSON reader. Ported from Sam's `apps/web/test/map/geojson.test.ts`
 * on `feat/T3-prototype-interface-2`, for a reader that returns shapes rather
 * than features; the malformed-input rows are new, for the same reader now
 * reading what a user types.
 */

import { describe, expect, it } from "vitest";
import {
  describeLoad,
  readGeoJson,
  shapesIn,
  type GeoJsonAccepted,
} from "../../src/forms/geojson.js";

const SQUARE = [
  [
    [5.1, 52.1],
    [5.2, 52.1],
    [5.2, 52.2],
    [5.1, 52.1],
  ],
];

/** Narrows to the success case, failing with the rejection message if not. */
function accept(text: string): GeoJsonAccepted {
  const result = readGeoJson(text);
  if (!result.ok) throw new Error(`expected a successful read, got: ${result.message}`);
  return result;
}

const types = (read: GeoJsonAccepted) => read.shapes.map((shape) => shape.type);

describe("the shapes a GeoJSON file arrives in", () => {
  it("reads a feature collection", () => {
    const text = JSON.stringify({
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: SQUARE } },
      ],
    });
    expect(accept(text).shapes).toEqual([{ type: "Polygon", coordinates: SQUARE }]);
  });

  it("reads a lone feature, and leaves its properties behind", () => {
    const text = JSON.stringify({
      type: "Feature",
      properties: { name: "dropped" },
      geometry: { type: "Polygon", coordinates: SQUARE },
    });
    expect(accept(text).shapes).toEqual([{ type: "Polygon", coordinates: SQUARE }]);
  });

  it("reads a bare geometry", () => {
    expect(types(accept(JSON.stringify({ type: "Polygon", coordinates: SQUARE })))).toEqual([
      "Polygon",
    ]);
  });

  it("flattens a geometry collection", () => {
    const text = JSON.stringify({
      type: "GeometryCollection",
      geometries: [
        { type: "Polygon", coordinates: SQUARE },
        { type: "Point", coordinates: [5.1, 52.1] },
      ],
    });
    expect(types(accept(text))).toEqual(["Polygon", "Point"]);
  });

  it("splits a MultiPolygon into one shape per polygon", () => {
    const text = JSON.stringify({ type: "MultiPolygon", coordinates: [SQUARE, SQUARE] });
    expect(types(accept(text))).toEqual(["Polygon", "Polygon"]);
  });

  it("keeps points and lines rather than discarding them", () => {
    // What an input accepts is the plan's decision; the reader reads.
    const text = JSON.stringify({
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [5.1, 52.1] } },
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: [
              [5.1, 52.1],
              [5.2, 52.2],
            ],
          },
        },
      ],
    });
    expect(types(accept(text))).toEqual(["Point", "LineString"]);
  });

  it("skips a feature without a geometry", () => {
    const text = JSON.stringify({
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: {}, geometry: null },
        { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [5.1, 52.1] } },
      ],
    });
    expect(types(accept(text))).toEqual(["Point"]);
  });
});

describe("files that cannot be used", () => {
  it("refuses text that is not JSON", () => {
    expect(readGeoJson("<xml/>")).toMatchObject({ ok: false, code: "not-json" });
  });

  it("refuses JSON that is not GeoJSON", () => {
    expect(readGeoJson(JSON.stringify({ hello: "world" }))).toMatchObject({
      ok: false,
      code: "not-geojson",
    });
  });

  it("refuses a file carrying no geometry", () => {
    expect(readGeoJson(JSON.stringify({ type: "FeatureCollection", features: [] }))).toMatchObject({
      ok: false,
      code: "no-geometry",
    });
  });

  it("refuses coordinates in metres rather than degrees", () => {
    // RD New: what QGIS produces for Dutch data unless told otherwise. Loaded
    // as WGS 84 it would render nowhere visible and look like nothing happened.
    const text = JSON.stringify({
      type: "Polygon",
      coordinates: [
        [
          [155000, 463000],
          [155100, 463000],
          [155100, 463100],
          [155000, 463000],
        ],
      ],
    });
    const result = readGeoJson(text);
    expect(result).toMatchObject({ ok: false, code: "projected-coordinates" });
    expect(result.ok ? "" : result.message).toContain("28992");
  });

  it("refuses a declared coordinate system that is not WGS 84", () => {
    const text = JSON.stringify({
      type: "Polygon",
      coordinates: SQUARE,
      crs: { type: "name", properties: { name: "urn:ogc:def:crs:EPSG::28992" } },
    });
    expect(readGeoJson(text)).toMatchObject({ ok: false, code: "projected-coordinates" });
  });

  it("accepts a crs member that names WGS 84, since that is the default anyway", () => {
    const text = JSON.stringify({
      type: "Polygon",
      coordinates: SQUARE,
      crs: { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } },
    });
    expect(accept(text).shapes).toHaveLength(1);
  });
});

describe("malformed geometry, as typed by hand", () => {
  it.each([
    ["a point with one number", { type: "Point", coordinates: [5.1] }],
    ["a point with a string", { type: "Point", coordinates: [5.1, "52"] }],
    ["a line of one position", { type: "LineString", coordinates: [[5.1, 52.1]] }],
    ["a ring of three positions", { type: "Polygon", coordinates: [SQUARE[0]?.slice(0, 3)] }],
    ["a polygon with no rings", { type: "Polygon", coordinates: [] }],
    ["coordinates that are not an array", { type: "Polygon", coordinates: "5,52" }],
  ])("reads no shape from %s", (_name, geometry) => {
    expect(shapesIn(geometry)).toEqual([]);
  });

  it("does not recurse forever through nested collections", () => {
    let nested: unknown = { type: "Point", coordinates: [5, 52] };
    for (let depth = 0; depth < 1000; depth += 1) {
      nested = { type: "GeometryCollection", geometries: [nested] };
    }
    expect(shapesIn(nested)).toEqual([]);
  });
});

describe("saying what was loaded", () => {
  it("counts what was used and what was left out", () => {
    expect(describeLoad(1, { Point: 2 })).toBe("Loaded 1 shape. Ignored 2 Points.");
  });

  it("says nothing about a remainder when there is none", () => {
    expect(describeLoad(3, {})).toBe("Loaded 3 shapes.");
  });
});
