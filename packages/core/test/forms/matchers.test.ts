import { describe, expect, it } from "vitest";
import {
  type Control,
  type FieldPlan,
  type GeometryType,
  resolveFormPlan,
} from "../../src/index.js";

const ALL_GEOMETRIES: readonly GeometryType[] = [
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
  "GeometryCollection",
];

function fieldFor(schema: unknown): FieldPlan {
  const [field] = resolveFormPlan({ id: "demo", inputs: { subject: { schema } } }).fields;
  if (field === undefined) throw new Error("the resolver produced no field");
  return field;
}

function controlFor(schema: unknown): Control {
  return fieldFor(schema).control;
}

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
    name: "ogc-bbox format",
    schema: { format: "ogc-bbox" },
    expected: { kind: "bbox", crs: ["http://www.opengis.net/def/crs/OGC/1.3/CRS84"] },
  },
  {
    name: "a bbox recognised by its properties, with a CRS choice",
    schema: {
      type: "object",
      properties: {
        bbox: { type: "array", items: { type: "number" } },
        crs: { type: "string", enum: ["urn:ogc:def:crs:EPSG::28992"] },
      },
    },
    expected: { kind: "bbox", crs: ["urn:ogc:def:crs:EPSG::28992"] },
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
      const plan = resolveFormPlan({ inputs: { subject: { schema: { [keyword]: [] } } } });
      const [field] = plan.fields;
      expect(field?.control.kind).toBe("json");

      const [diagnostic] = plan.diagnostics;
      expect(plan.diagnostics).toHaveLength(1);
      expect(diagnostic?.inputId).toBe("subject");
      expect(diagnostic?.code).toBe("unsupported-keyword");
      expect(diagnostic?.message).toContain(keyword);
    },
  );

  it("falls back to a JSON editor for a plain object schema", () => {
    const plan = resolveFormPlan({ inputs: { subject: { schema: { type: "object" } } } });
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
