import { describe, expect, it } from "vitest";
import {
  type GeoJsonAccepted,
  boundsOf,
  describeLoad,
  partitionByType,
  readGeoJson,
} from "../../src/map/geojson.js";

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

describe("the shapes a GeoJSON file arrives in", () => {
  it("reads a feature collection", () => {
    const text = JSON.stringify({
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: SQUARE } },
      ],
    });
    expect(accept(text).features).toHaveLength(1);
  });

  it("reads a lone feature", () => {
    const text = JSON.stringify({
      type: "Feature",
      properties: { name: "dropped" },
      geometry: { type: "Polygon", coordinates: SQUARE },
    });
    const [feature] = accept(text).features;
    expect(feature?.geometry.type).toBe("Polygon");
    // Properties belong to the file, not to the value being built.
    expect(feature?.properties).toEqual({});
  });

  it("reads a bare geometry", () => {
    expect(accept(JSON.stringify({ type: "Polygon", coordinates: SQUARE })).features).toHaveLength(
      1,
    );
  });

  it("flattens a geometry collection", () => {
    const text = JSON.stringify({
      type: "GeometryCollection",
      geometries: [
        { type: "Polygon", coordinates: SQUARE },
        { type: "Point", coordinates: [5.1, 52.1] },
      ],
    });
    expect(accept(text).features.map((f) => f.geometry.type)).toEqual(["Polygon", "Point"]);
  });

  it("splits a MultiPolygon into one feature per polygon", () => {
    const text = JSON.stringify({ type: "MultiPolygon", coordinates: [SQUARE, SQUARE] });
    const types = accept(text).features.map((f) => f.geometry.type);
    expect(types).toEqual(["Polygon", "Polygon"]);
  });

  it("keeps points and lines rather than discarding them", () => {
    // What an input accepts is the caller's decision; the reader reads.
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
    expect(accept(text).features.map((f) => f.geometry.type)).toEqual(["Point", "LineString"]);
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
    expect(accept(text).features).toHaveLength(1);
  });
});

describe("bounding what was read", () => {
  it("spans every feature", () => {
    const { features } = accept(
      JSON.stringify({
        type: "GeometryCollection",
        geometries: [
          { type: "Point", coordinates: [4.9, 52.3] },
          { type: "Polygon", coordinates: SQUARE },
        ],
      }),
    );
    expect(boundsOf(features)).toEqual([4.9, 52.1, 5.2, 52.3]);
  });

  it("has nothing to bound when there are no features", () => {
    expect(boundsOf([])).toBeUndefined();
  });
});

describe("choosing what a particular input can use", () => {
  const features = accept(
    JSON.stringify({
      type: "GeometryCollection",
      geometries: [
        { type: "Polygon", coordinates: SQUARE },
        { type: "Point", coordinates: [5.1, 52.1] },
        { type: "Point", coordinates: [5.2, 52.2] },
      ],
    }),
  ).features;

  it("splits the usable from the rest", () => {
    const { usable, ignored } = partitionByType(features, ["Polygon"]);
    expect(usable).toHaveLength(1);
    expect(ignored).toEqual({ Point: 2 });
  });

  it("says what happened to the remainder", () => {
    const { usable, ignored } = partitionByType(features, ["Polygon"]);
    expect(describeLoad(usable, ignored)).toBe("Loaded 1 shape. Ignored 2 Points.");
  });

  it("says nothing about a remainder when there is none", () => {
    const { usable, ignored } = partitionByType(features, ["Polygon", "Point"]);
    expect(describeLoad(usable, ignored)).toBe("Loaded 3 shapes.");
  });
});
