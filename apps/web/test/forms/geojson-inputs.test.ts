/**
 * The GeoJSON patterns beyond a bare format hint or `$ref`: each is a bounded,
 * named pattern with its own rows here, and each near miss is refused rather
 * than approximated.
 *
 * Rows "from the standard's example, not observed" are the fragments of the
 * example process description in clause 8 of OGC API - Processes - Part 1
 * (`core/examples/json/ProcessDescription.json`), verbatim. No server in the
 * testbed has been seen to send them.
 */

import { describe, expect, it } from "vitest";
import { controlFor } from "./helpers.js";

const GEOMETRY_GEOJSON =
  "http://schemas.opengis.net/ogcapi/features/part1/1.0/openapi/schemas/geometryGeoJSON.yaml";

const EVERY_GEOMETRY = [
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
  "GeometryCollection",
];

describe("#G1: a geometry hint inside allOf", () => {
  it("recognises geometryInput's GeoJSON branch (from the standard's example, not observed)", () => {
    expect(
      controlFor({ allOf: [{ format: "geojson-geometry" }, { $ref: GEOMETRY_GEOJSON }] }),
    ).toEqual({
      kind: "geometry",
      wrapper: "geometry",
      geometryTypes: EVERY_GEOMETRY,
      recognisedBy: "allOf",
    });
  });

  it("recognises featureCollectionInput's GeoJSON branch (from the standard's example, not observed)", () => {
    expect(
      controlFor({
        allOf: [
          { format: "geojson-feature-collection" },
          { $ref: "https://geojson.org/schema/FeatureCollection.json" },
        ],
      }),
    ).toEqual({
      kind: "geometry",
      wrapper: "feature-collection",
      geometryTypes: EVERY_GEOMETRY,
      recognisedBy: "allOf",
    });
  });

  it("takes the geometry types every member allows", () => {
    expect(
      controlFor({ allOf: [{ format: "geojson-polygon" }, { $ref: GEOMETRY_GEOJSON }] }),
    ).toMatchObject({ kind: "geometry", geometryTypes: ["Polygon"], recognisedBy: "allOf" });
  });

  it("counts the GeoJSON media type as a member that names no wrapper", () => {
    expect(
      controlFor({
        allOf: [{ format: "geojson-feature" }, { contentMediaType: "application/geo+json" }],
      }),
    ).toMatchObject({ kind: "geometry", wrapper: "feature", recognisedBy: "allOf" });
  });

  it("refuses an allOf with a member that says something other than GeoJSON", () => {
    const control = controlFor({
      allOf: [{ format: "geojson-geometry" }, { type: "object", required: ["crs"] }],
    });
    expect(control).toMatchObject({ kind: "json" });
  });

  it("refuses members that disagree on the wrapper", () => {
    const control = controlFor({
      allOf: [{ format: "geojson-feature" }, { $ref: GEOMETRY_GEOJSON }],
    });
    expect(control).toMatchObject({ kind: "json" });
  });

  it("refuses members that leave no geometry type in common", () => {
    const control = controlFor({
      allOf: [{ format: "geojson-point" }, { format: "geojson-polygon" }],
    });
    expect(control).toMatchObject({ kind: "json" });
  });

  it("still leaves the standard's bounding box to the bbox matcher (N1)", () => {
    expect(
      controlFor({
        allOf: [
          { format: "ogc-bbox" },
          {
            $ref: "http://schemas.opengis.net/ogcapi/processes/part1/1.0/openapi/schemas/bbox.yaml",
          },
        ],
      }),
    ).toMatchObject({ kind: "bbox" });
  });
});

describe("a $ref to the GeoJSON project's own schemas", () => {
  it.each([
    ["Polygon.json", "geometry", ["Polygon"]],
    ["Feature.json", "feature", EVERY_GEOMETRY],
    ["FeatureCollection.json", "feature-collection", EVERY_GEOMETRY],
  ])("reads %s", (document, wrapper, geometryTypes) => {
    expect(controlFor({ $ref: `https://geojson.org/schema/${document}` })).toEqual({
      kind: "geometry",
      wrapper,
      geometryTypes,
      recognisedBy: "ref",
    });
  });

  it("refuses a document of that site it does not know", () => {
    expect(controlFor({ $ref: "https://geojson.org/schema/Thing.json" }).kind).toBe("json");
  });
});
