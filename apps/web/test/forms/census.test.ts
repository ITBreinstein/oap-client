/**
 * The generator over every committed description, as numbers.
 *
 * The snapshot is the point: any change to a matcher shows up here as a diff
 * to review, in the same PR, rather than as a surprise at a plugfest. The
 * robustness rows are the "never throws" guarantee, held against every real
 * description and a set of deliberately hostile schemas.
 */

import { describe, expect, it } from "vitest";
import type { Control } from "../../src/forms/plan.js";
import { resolveFormPlan } from "../../src/forms/resolve.js";
import { FIXTURE_DESCRIPTIONS, fixtureProcess, handBuiltProcess, planFor } from "./helpers.js";

function leaf(control: Control): Control["kind"] {
  return control.kind === "list" ? leaf(control.item) : control.kind;
}

function census(keys: readonly string[]) {
  const outer: Record<string, number> = {};
  const diagnostics: Record<string, number> = {};
  let inputs = 0;
  for (const key of keys) {
    const plan = resolveFormPlan(fixtureProcess(key));
    for (const field of plan.fields) {
      inputs += 1;
      const kind = `${field.control.kind}${field.control.kind === "list" ? `:${leaf(field.control)}` : ""}`;
      outer[kind] = (outer[kind] ?? 0) + 1;
    }
    for (const diagnostic of plan.diagnostics) {
      diagnostics[diagnostic.code] = (diagnostics[diagnostic.code] ?? 0) + 1;
    }
  }
  return { descriptions: keys.length, inputs, controls: outer, diagnostics };
}

describe("census over the committed fixtures", () => {
  it("still resolves the seven descriptions of the Task 7 baseline", () => {
    // The brief's §3 baseline, measured with the prototype: 9 text, 3 number,
    // 3 list, 1 bbox, 3 raw JSON — all three from `oneOf`. Now the three are
    // complex controls, and nothing falls back.
    const baseline = [
      "pygeoapi/hello-world",
      "zoo-project/echo",
      "zoo-project/longProcess",
      "zoo-project/Buffer",
      "zoo-project/Centroid",
      "zoo-project/Ogr2Ogr",
      "zoo-project/Gdal_Translate",
    ];
    expect(census(baseline)).toMatchInlineSnapshot(`
      {
        "controls": {
          "bbox": 1,
          "complex": 3,
          "list:text": 3,
          "number": 3,
          "text": 9,
        },
        "descriptions": 7,
        "diagnostics": {},
        "inputs": 19,
      }
    `);
  });

  it("covers every committed description", () => {
    expect(census(Object.keys(FIXTURE_DESCRIPTIONS).sort())).toMatchInlineSnapshot(`
      {
        "controls": {
          "bbox": 3,
          "checkbox": 6,
          "complex": 15,
          "geometry": 4,
          "list:text": 4,
          "number": 17,
          "select": 4,
          "text": 27,
        },
        "descriptions": 33,
        "diagnostics": {
          "contradictory-schema": 1,
        },
        "inputs": 80,
      }
    `);
  });
});

describe("never throws", () => {
  it.each(Object.keys(FIXTURE_DESCRIPTIONS).sort())("on %s", (key) => {
    expect(() => resolveFormPlan(fixtureProcess(key))).not.toThrow();
  });

  const cyclicItems: Record<string, unknown> = { type: "array" };
  cyclicItems["items"] = cyclicItems;
  const cyclicEnum: Record<string, unknown> = {};
  cyclicEnum["self"] = cyclicEnum;

  const hostile: readonly [string, unknown][] = [
    ["a number as the type", { type: 42 }],
    ["a type array of junk", { type: [1, null, {}, "strng"] }],
    ["an empty type array", { type: [] }],
    ["a self-referencing items chain", cyclicItems],
    ["an enum of objects", { enum: [{ a: 1 }, { b: [2] }] }],
    ["an enum holding a cyclic object", { enum: [cyclicEnum] }],
    ["an empty enum", { type: "string", enum: [] }],
    ["an enum that is not an array", { type: "string", enum: "a,b" }],
    ["a string schema", "string"],
    ["an array schema", [{ type: "string" }]],
    ["a null schema", null],
    ["a boolean schema", true],
    ["bounds of the wrong type", { type: "number", minimum: "0", exclusiveMaximum: "9" }],
    ["NaN-ish bounds", { type: "number", minimum: Number.NaN, maximum: Infinity }],
    ["a oneOf that is not an array", { oneOf: { type: "string" } }],
    ["a oneOf of non-objects", { oneOf: [1, "a", null] }],
    ["a bbox with a junk crs", { format: "ogc-bbox", properties: { crs: { enum: [1, null] } } }],
    ["a bbox with junk properties", { format: "ogc-bbox", properties: "bbox" }],
    ["an allOf of junk", { allOf: [null, 1, "ogc-bbox"] }],
    ["a $ref that is not a string", { $ref: { bbox: true } }],
    ["items that are a tuple", { type: "array", items: [{ type: "string" }] }],
  ];

  it.each(hostile)("on %s", (_name, schema) => {
    const process = handBuiltProcess({ id: "hostile", schema: schema as Record<string, unknown> });
    expect(() => resolveFormPlan(process)).not.toThrow();
  });

  it("and every fallback carries a diagnostic", () => {
    for (const [, schema] of hostile) {
      const process = handBuiltProcess({
        id: "hostile",
        schema: schema as Record<string, unknown>,
      });
      const plan = resolveFormPlan(process);
      const control = plan.fields[0]?.control;
      if (control !== undefined && leaf(control) === "json") {
        expect(plan.diagnostics.length).toBeGreaterThan(0);
      }
    }
  });

  it("through the core's parser too, for every hostile shape JSON can carry", () => {
    for (const [name, schema] of hostile) {
      if (name.includes("cyclic") || name.includes("self-referencing")) continue;
      expect(() => planFor({ x: { schema } })).not.toThrow();
    }
  });
});
