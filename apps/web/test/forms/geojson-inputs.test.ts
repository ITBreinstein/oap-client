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
import { resolveFormPlan } from "../../src/forms/resolve.js";
import { controlFor, fixtureProcess } from "./helpers.js";

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

/** A structural geometry of one type, as the Beleidsnormen API writes them. */
function geometrySchema(type: string): Record<string, unknown> {
  return {
    required: ["type", "coordinates"],
    type: "object",
    properties: {
      type: { enum: [type], type: "string" },
      coordinates: { type: "array", items: { type: "number" } },
    },
  };
}

function collectionOf(geometry: unknown, properties: unknown = { type: "object" }) {
  return {
    required: ["type", "features"],
    type: "object",
    properties: {
      type: { enum: ["FeatureCollection"], type: "string" },
      features: {
        type: "array",
        items: {
          type: "object",
          properties: { type: { enum: ["Feature"], type: "string" }, geometry, properties },
        },
      },
    },
  };
}

describe("#G3: GeoJSON told by its structure", () => {
  it("reads the Beleidsnormen API's what-if layers as repeatable FeatureCollections", () => {
    const plan = resolveFormPlan(fixtureProcess("beleidsnormen/regel_300"));
    const control = (id: string) => plan.fields.find((field) => field.id === id)?.control;
    expect(control("nieuwe_bankjes")).toEqual({
      kind: "list",
      item: {
        kind: "geometry",
        wrapper: "feature-collection",
        geometryTypes: ["Point"],
        recognisedBy: "structural",
      },
      minItems: undefined,
      maxItems: undefined,
    });
    expect(control("nieuwe_grasvelden")).toMatchObject({
      item: { geometryTypes: ["Polygon", "MultiPolygon"], recognisedBy: "structural" },
    });
    expect(control("nieuwe_bomen")).toMatchObject({
      item: { geometryTypes: ["Point", "Polygon", "MultiPolygon"] },
    });
    expect(plan.diagnostics.map((diagnostic) => diagnostic.inputId)).not.toContain(
      "nieuwe_bankjes",
    );
  });

  it("reads a bare structural geometry, and a Feature", () => {
    expect(controlFor(geometrySchema("LineString"))).toEqual({
      kind: "geometry",
      wrapper: "geometry",
      geometryTypes: ["LineString"],
      recognisedBy: "structural",
    });
    expect(
      controlFor({
        type: "object",
        properties: {
          type: { const: "Feature" },
          geometry: geometrySchema("Point"),
          properties: { type: "object" },
        },
      }),
    ).toMatchObject({ kind: "geometry", wrapper: "feature", geometryTypes: ["Point"] });
  });

  it("refuses a type enum of two names", () => {
    const schema = geometrySchema("Polygon");
    const control = controlFor({
      ...schema,
      properties: {
        ...(schema["properties"] as object),
        type: { enum: ["Polygon", "MultiPolygon"] },
      },
    });
    expect(control.kind).toBe("json");
  });

  it("refuses a geometry without coordinates", () => {
    expect(controlFor({ type: "object", properties: { type: { enum: ["Point"] } } }).kind).toBe(
      "json",
    );
  });

  it("refuses a schema that says it is not an object", () => {
    expect(controlFor({ ...geometrySchema("Point"), type: "string" }).kind).not.toBe("geometry");
  });

  it("refuses a FeatureCollection whose features are not structural Features", () => {
    expect(controlFor(collectionOf({ type: "object" })).kind).toBe("json");
    expect(
      controlFor(collectionOf({ oneOf: [geometrySchema("Point"), { type: "object" }] })).kind,
    ).toBe("json");
  });

  it("refuses features whose properties require something a drawn feature leaves out", () => {
    const control = controlFor(
      collectionOf(geometrySchema("Point"), { type: "object", required: ["name"] }),
    );
    expect(control.kind).toBe("json");
  });

  it("leaves a type name it does not know to the other matchers", () => {
    expect(
      controlFor({
        type: "object",
        properties: { type: { enum: ["Topology"] }, coordinates: { type: "array" } },
      }).kind,
    ).toBe("json");
  });

  it("R11 still holds: a bbox is still a bbox, and a Feature is never one", () => {
    expect(
      controlFor({
        type: "object",
        properties: { bbox: { type: "array", items: { type: "number" } }, crs: { type: "string" } },
      }).kind,
    ).toBe("bbox");
    expect(
      controlFor({
        type: "object",
        properties: {
          type: { enum: ["Feature"] },
          geometry: geometrySchema("Point"),
          bbox: { type: "array", minItems: 4, items: { type: "number" } },
        },
      }),
    ).toMatchObject({ kind: "geometry", wrapper: "feature" });
  });
});

describe("#G2: a oneOf of GeoJSON geometries", () => {
  it("reads the Beleidsnormen API's Polygon-or-MultiPolygon as one area input", () => {
    const plan = resolveFormPlan(fixtureProcess("beleidsnormen/regel_30"));
    expect(plan.fields[0]?.control).toEqual({
      kind: "geometry",
      wrapper: "geometry",
      geometryTypes: ["Polygon", "MultiPolygon"],
      recognisedBy: "oneOf-geojson",
    });
    expect(plan.diagnostics).toEqual([]);
  });

  it("keeps a repeatable one a list of them", () => {
    const plan = resolveFormPlan(fixtureProcess("beleidsnormen/laadmogelijkheden"));
    expect(plan.fields.find((field) => field.id === "geometry")?.control).toMatchObject({
      kind: "list",
      item: { kind: "geometry", geometryTypes: ["Polygon", "MultiPolygon"] },
    });
  });

  it("counts a branch by its $ref, its allOf or its structure, too", () => {
    expect(
      controlFor({
        oneOf: [
          { $ref: "https://geojson.org/schema/Point.json" },
          { allOf: [{ format: "geojson-linestring" }, { $ref: GEOMETRY_GEOJSON }] },
          geometrySchema("Polygon"),
        ],
      }),
    ).toMatchObject({
      kind: "geometry",
      wrapper: "geometry",
      geometryTypes: ["Point", "LineString", "Polygon"],
    });
  });

  it("refuses branches in different wrappers", () => {
    const control = controlFor({
      oneOf: [{ format: "geojson-polygon" }, { format: "geojson-feature" }],
    });
    expect(control.kind).toBe("json");
  });

  it("refuses a branch that says one thing by its format and another by its structure", () => {
    const control = controlFor({
      oneOf: [{ ...geometrySchema("Polygon"), format: "geojson-point" }],
    });
    expect(control.kind).toBe("json");
  });

  it("refuses a oneOf with any branch that is not GeoJSON", () => {
    expect(controlFor({ oneOf: [geometrySchema("Point"), { type: "string" }] }).kind).toBe("json");
  });

  it("leaves named alternatives that are not geometries to the JSON editor", () => {
    const plan = resolveFormPlan(fixtureProcess("beleidsnormen/zonal_stats"));
    expect(plan.fields.find((field) => field.id === "statistiek")?.control).toMatchObject({
      kind: "list",
      item: { kind: "json" },
    });
  });
});
