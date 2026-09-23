/**
 * The matcher chain, ported from the prototype's
 * `packages/core/test/forms/matchers.test.ts`. Every original row is here; the
 * ones whose expectation changed say why. The review rows (R…, N…) are the
 * regression tests for docs/reviews/forms-prototype-review.md, and each fails
 * against the prototype as written.
 */

import { describe, expect, it } from "vitest";
import type { Control, GeometryType } from "../../src/forms/plan.js";
import { CRS84, CRS84H } from "../../src/forms/crs.js";
import { resolveFormPlan } from "../../src/forms/resolve.js";
import { controlFor, handBuiltProcess, planFor } from "./helpers.js";

const ALL_GEOMETRIES: readonly GeometryType[] = [
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
  "GeometryCollection",
];

/**
 * One row per schema shape we claim to support. A new matcher is a new row;
 * the fixtures are meant to be replaced with fragments harvested from real
 * servers as the interoperability runs turn them up.
 */
const cases: readonly { name: string; schema: unknown; expected: Control }[] = [
  {
    name: "string",
    schema: { type: "string" },
    expected: { kind: "text" },
  },
  {
    name: "string with constraints",
    schema: {
      type: "string",
      default: "abc",
      format: "date-time",
      pattern: "^a",
      minLength: 1,
      maxLength: 8,
    },
    expected: {
      kind: "text",
      default: "abc",
      format: "date-time",
      pattern: "^a",
      minLength: 1,
      maxLength: 8,
    },
  },
  {
    name: "string with enum",
    schema: { type: "string", enum: ["fast", "slow"], default: "fast" },
    expected: {
      kind: "select",
      options: [
        { value: "fast", label: "fast" },
        { value: "slow", label: "slow" },
      ],
      default: "fast",
    },
  },
  {
    name: "enum of numbers",
    schema: { type: "integer", enum: [10, 20] },
    expected: {
      kind: "select",
      options: [
        { value: 10, label: "10" },
        { value: 20, label: "20" },
      ],
    },
  },
  {
    name: "number",
    schema: { type: "number" },
    expected: { kind: "number", integer: false },
  },
  {
    name: "integer with bounds",
    schema: { type: "integer", minimum: 0, maximum: 10, multipleOf: 2, default: 4 },
    expected: { kind: "number", integer: true, min: 0, max: 10, step: 2, default: 4 },
  },
  {
    name: "boolean",
    schema: { type: "boolean", default: true },
    expected: { kind: "checkbox", default: true },
  },
  {
    name: "nullable string, via a type array",
    schema: { type: ["string", "null"] },
    expected: { kind: "text" },
  },
  {
    name: "array",
    schema: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 4 },
    expected: { kind: "list", item: { kind: "text" }, minItems: 1, maxItems: 4 },
  },
  {
    name: "geojson-geometry format",
    schema: { format: "geojson-geometry" },
    expected: { kind: "geometry", wrapper: "geometry", geometryTypes: ALL_GEOMETRIES },
  },
  {
    name: "a single geometry type in the format",
    schema: { format: "geojson-polygon" },
    expected: { kind: "geometry", wrapper: "geometry", geometryTypes: ["Polygon"] },
  },
  {
    name: "geojson-feature-collection format",
    schema: { format: "geojson-feature-collection" },
    expected: { kind: "geometry", wrapper: "feature-collection", geometryTypes: ALL_GEOMETRIES },
  },
  {
    name: "a $ref to the well-known geometry schema",
    schema: {
      $ref: "http://schemas.opengis.net/ogcapi/features/part1/1.0/openapi/schemas/geometryGeoJSON.yaml",
    },
    expected: { kind: "geometry", wrapper: "geometry", geometryTypes: ALL_GEOMETRIES },
  },
  {
    name: "the GeoJSON media type alone",
    schema: { type: "object", contentMediaType: "application/geo+json" },
    expected: { kind: "geometry", wrapper: "geometry", geometryTypes: ALL_GEOMETRIES },
  },
  {
    // Changed: the plan now also records the default CRS (R5) and the
    // coordinate counts (R4). A bare format hint means bbox.yaml: CRS84 by
    // default, four or six numbers.
    name: "ogc-bbox format",
    schema: { format: "ogc-bbox" },
    expected: { kind: "bbox", crs: [CRS84], defaultCrs: CRS84, dimensions: [4, 6] },
  },
  {
    // Changed as above.
    name: "a bbox recognised by its properties, with a CRS choice",
    schema: {
      type: "object",
      properties: {
        bbox: { type: "array", items: { type: "number" } },
        crs: { type: "string", enum: ["urn:ogc:def:crs:EPSG::28992"] },
      },
    },
    expected: {
      kind: "bbox",
      crs: ["urn:ogc:def:crs:EPSG::28992"],
      defaultCrs: "urn:ogc:def:crs:EPSG::28992",
      dimensions: [4, 6],
    },
  },
];

describe("matcher chain", () => {
  it.each(cases)("resolves $name", ({ schema, expected }) => {
    expect(controlFor(schema)).toEqual(expected);
  });

  it("prefers the geometry hint over the unsupported-keyword refusal", () => {
    // Servers express geometry as a bare $ref far more often than not; refusing
    // it as an unsupported keyword would drop the map input for the common case.
    const control = controlFor({ $ref: "…/schemas/featureGeoJSON.yaml" });
    expect(control.kind).toBe("geometry");
  });

  it("resolves an array of geometries", () => {
    expect(controlFor({ type: "array", items: { format: "geojson-geometry" } })).toEqual({
      kind: "list",
      item: { kind: "geometry", wrapper: "geometry", geometryTypes: ALL_GEOMETRIES },
    });
  });

  it.each(["allOf", "anyOf", "oneOf", "not", "if", "patternProperties"])(
    "refuses %s rather than guessing",
    (keyword) => {
      const plan = planFor({ subject: { schema: { [keyword]: [] } } });
      const [field] = plan.fields;
      expect(field?.control.kind).toBe("json");

      const [diagnostic] = plan.diagnostics;
      expect(plan.diagnostics).toHaveLength(1);
      expect(diagnostic?.inputId).toBe("subject");
      expect(diagnostic?.code).toBe("unsupported-keyword");
      expect(diagnostic?.message).toContain(keyword);
      // New (T4): the keyword travels on its own, for the observation.
      expect(diagnostic?.keyword).toBe(keyword);
    },
  );

  it("falls back to a JSON editor for a plain object schema", () => {
    const plan = planFor({ subject: { schema: { type: "object" } } });
    expect(plan.fields[0]?.control).toEqual({
      kind: "json",
      reason: "no control for type `object`",
      schema: { type: "object" },
    });
    expect(plan.diagnostics[0]?.code).toBe("unsupported-type");
  });

  it("keeps the schema on the fallback control, so an editor can still use it", () => {
    const schema = { type: "object", properties: { a: { type: "string" } } };
    const control = controlFor(schema);
    if (control.kind !== "json") throw new Error("expected the JSON fallback");
    expect(control.schema).toEqual(schema);
  });
});

describe("review regressions", () => {
  it("R1: a multi-type schema gets the JSON editor, not the first type's control", () => {
    const plan = planFor({ subject: { schema: { type: ["string", "number"] } } });
    expect(plan.fields[0]?.control.kind).toBe("json");
    expect(plan.diagnostics[0]).toMatchObject({ code: "unsupported-type", keyword: "type" });
  });

  it("R1: integer and number together are still one number control, not an integer one", () => {
    expect(controlFor({ type: ["integer", "number"] })).toMatchObject({
      kind: "number",
      integer: false,
    });
  });

  it("R2: records OpenAPI 3.0's boolean exclusiveMinimum (the standard's own doubleInput)", () => {
    // OGC 18-062r2 examples/json/ProcessDescription.json, `doubleInput`.
    expect(
      controlFor({
        type: "number",
        format: "double",
        minimum: 0,
        maximum: 10,
        default: 5,
        exclusiveMinimum: true,
      }),
    ).toEqual({ kind: "number", integer: false, min: 0, max: 10, minExclusive: true, default: 5 });
  });

  it("R2: records JSON Schema 2019's numeric exclusive bounds", () => {
    expect(controlFor({ type: "number", exclusiveMinimum: 0, exclusiveMaximum: 1 })).toMatchObject({
      min: 0,
      minExclusive: true,
      max: 1,
      maxExclusive: true,
    });
  });

  it("R2: a numeric exclusive bound looser than the inclusive one does not win", () => {
    const control = controlFor({ type: "number", minimum: 5, exclusiveMinimum: 1 });
    expect(control).toMatchObject({ min: 5 });
    expect(control).not.toHaveProperty("minExclusive");
  });

  it("R3: const offers the one permitted value rather than a free text field", () => {
    expect(controlFor({ type: "string", const: "fixed" })).toEqual({
      kind: "select",
      options: [{ value: "fixed", label: "fixed" }],
      default: "fixed",
    });
  });

  it("R4: records the coordinate counts the bbox member allows", () => {
    const four = {
      format: "ogc-bbox",
      properties: { bbox: { type: "array", minItems: 4, maxItems: 4 } },
    };
    const either = {
      format: "ogc-bbox",
      properties: {
        bbox: {
          type: "array",
          oneOf: [
            { minItems: 4, maxItems: 4 },
            { minItems: 6, maxItems: 6 },
          ],
        },
      },
    };
    expect(controlFor(four)).toMatchObject({ kind: "bbox", dimensions: [4] });
    expect(controlFor(either)).toMatchObject({ kind: "bbox", dimensions: [4, 6] });
  });

  it("R5: keeps the server's declared default when an enum is also present", () => {
    const schema = {
      format: "ogc-bbox",
      properties: { crs: { type: "string", enum: ["urn:a", "urn:b"], default: "urn:b" } },
    };
    expect(controlFor(schema)).toMatchObject({ crs: ["urn:a", "urn:b"], defaultCrs: "urn:b" });
  });

  it("R5: a CRS with a default and no enum offers just that CRS", () => {
    const schema = {
      format: "ogc-bbox",
      properties: { crs: { type: "string", default: "urn:x" } },
    };
    expect(controlFor(schema)).toMatchObject({ crs: ["urn:x"], defaultCrs: "urn:x" });
  });

  it("R11: an inline GeoJSON Feature schema, which has a bbox member, is not a bbox", () => {
    // Shape of https://geojson.org/schema/Feature.json, trimmed.
    const feature = {
      type: "object",
      required: ["type", "properties", "geometry"],
      properties: {
        type: { type: "string", enum: ["Feature"] },
        properties: { oneOf: [{ type: "null" }, { type: "object" }] },
        geometry: { oneOf: [{ type: "null" }, { type: "object" }] },
        bbox: { type: "array", minItems: 4, items: { type: "number" } },
      },
    };
    expect(controlFor(feature).kind).not.toBe("bbox");
  });

  it("R11: a $ref is a bbox only when it names the bbox schema document itself", () => {
    expect(controlFor({ $ref: "https://example.org/schemas/bboxOrPoint.json" }).kind).toBe("json");
    expect(controlFor({ $ref: "https://example.org/openapi/schemas/bbox.yaml" }).kind).toBe("bbox");
  });

  it("R12: null is not offered as an enum option", () => {
    expect(controlFor({ type: "string", enum: ["a", null], nullable: true })).toEqual({
      kind: "select",
      options: [{ value: "a", label: "a" }],
    });
  });

  it("N1: recognises the standard's own bounding box, allOf [ogc-bbox, $ref bbox.yaml]", () => {
    // OGC 18-062r2 examples/json/ProcessDescription.json, `boundingBoxInput`.
    const control = controlFor({
      allOf: [{ format: "ogc-bbox" }, { $ref: "../../openapi/schemas/bbox.yaml" }],
    });
    expect(control).toEqual({
      kind: "bbox",
      crs: [CRS84, CRS84H],
      defaultCrs: CRS84,
      dimensions: [4, 6],
    });
  });

  it("N2: a boolean with a string enum follows its type, and says the schema contradicts itself", () => {
    // The 276-input shape from ZOO's SAGA wrappers; SAGA.climate_tools.0 is one.
    const plan = planFor({
      COEFFICIENTS: {
        minOccurs: 0,
        schema: { type: "boolean", default: false, enum: ["true", "false"], nullable: true },
      },
    });
    expect(plan.fields[0]?.control).toEqual({ kind: "checkbox", default: false });
    expect(plan.diagnostics).toEqual([
      {
        inputId: "COEFFICIENTS",
        code: "contradictory-schema",
        message: "no `enum` value is of the declared type `boolean`",
        keyword: "enum",
      },
    ]);
  });

  it("N2: an enum with some values of the declared type is an ordinary select", () => {
    expect(controlFor({ type: "string", enum: ["a", 1] }).kind).toBe("select");
  });

  it("N6: survives an enum holding a cyclic object", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    // Hand-built: a cycle cannot come out of JSON.parse, so not via the core.
    const process = handBuiltProcess({ id: "cyclic", schema: { enum: [cyclic] } });
    expect(() => resolveFormPlan(process)).not.toThrow();
  });
});

describe("complex inputs (T3)", () => {
  const buffer = {
    oneOf: [
      {
        type: "string",
        contentEncoding: "UTF-8",
        contentMediaType: "text/xml",
        contentSchema: "http://fooa/gml/3.1.0/polygon.xsd",
      },
      { type: "object" },
    ],
  };

  it("R7: resolves ZOO's Buffer.InputPolygon to a complex control, not raw JSON", () => {
    const plan = planFor({ InputPolygon: { schema: buffer } });
    expect(plan.fields[0]?.control).toEqual({
      kind: "complex",
      formats: [
        {
          label: "text/xml",
          mediaType: "text/xml",
          encoding: "UTF-8",
          contentSchema: "http://fooa/gml/3.1.0/polygon.xsd",
          object: false,
        },
        { label: "JSON object", object: true },
      ],
      byReference: true,
    });
    expect(plan.diagnostics).toEqual([]);
  });

  it("labels a binary encoding, and not a text one", () => {
    const control = controlFor({
      oneOf: [
        { type: "string", contentEncoding: "base64", contentMediaType: "image/tiff" },
        { type: "string", contentEncoding: "utf-8", contentMediaType: "text/csv" },
      ],
    });
    if (control.kind !== "complex") throw new Error("expected a complex control");
    expect(control.formats.map((format) => format.label)).toEqual([
      "image/tiff (base64)",
      "text/csv",
    ]);
  });

  it("collapses ZOO's repeated identical branches into one choice (Z2's two 'type' cases)", () => {
    // GdalExtractProfile.Geometry, verbatim.
    const control = controlFor({ oneOf: [{ type: "object" }, { type: "object" }] });
    expect(control).toEqual({
      kind: "complex",
      formats: [{ label: "JSON object", object: true }],
      byReference: true,
    });
  });

  it("refuses a oneOf of plain type alternatives", () => {
    const plan = planFor({
      subject: { schema: { oneOf: [{ type: "string" }, { type: "number" }] } },
    });
    expect(plan.fields[0]?.control.kind).toBe("json");
    expect(plan.diagnostics[0]).toMatchObject({ code: "unsupported-keyword", keyword: "oneOf" });
  });

  it("refuses a oneOf with a $ref branch (the standard's own geometryInput)", () => {
    const control = controlFor({
      oneOf: [
        { type: "string", contentMediaType: "application/gml+xml; version=3.2" },
        {
          allOf: [
            { format: "geojson-geometry" },
            {
              $ref: "http://schemas.opengis.net/ogcapi/features/part1/1.0/openapi/schemas/geometryGeoJSON.yaml",
            },
          ],
        },
      ],
    });
    expect(control.kind).toBe("json");
  });

  it("refuses a oneOf of branches carrying anything but encoding keywords", () => {
    expect(
      controlFor({
        oneOf: [{ type: "string", contentMediaType: "text/xml", minLength: 3 }, { type: "object" }],
      }).kind,
    ).toBe("json");
  });

  it("wraps a repeatable complex input in a list", () => {
    expect(
      controlFor(
        { oneOf: [{ type: "string", contentEncoding: "base64", contentMediaType: "image/png" }] },
        { maxOccurs: 150 },
      ),
    ).toMatchObject({ kind: "list", maxItems: 150, item: { kind: "complex" } });
  });
});

describe("the multi-line string", () => {
  it("is a string with a contentMediaType, which is the nearest standard keyword", () => {
    expect(controlFor({ type: "string", contentMediaType: "text/plain" })).toEqual({
      kind: "text",
      multiline: true,
    });
  });
});
