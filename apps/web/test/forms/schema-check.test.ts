/**
 * The schema check behind the warnings: the keywords it knows, silence on the
 * ones it does not, and "not checked" rather than a guess.
 */

import { describe, expect, it } from "vitest";
import { checkAgainstSchema, MAX_VISITS } from "../../src/forms/schema-check.js";

function problems(schema: unknown, value: unknown): readonly string[] {
  const check = checkAgainstSchema(schema, value);
  if (check.kind !== "checked") throw new Error(`not checked: ${check.keyword}`);
  return check.problems;
}

describe("checkAgainstSchema", () => {
  it("checks the type, and says nothing more once the type is wrong", () => {
    expect(problems({ type: "integer", minimum: 5 }, "7")).toEqual([
      "The value should be integer, not string.",
    ]);
    expect(problems({ type: "integer" }, 7.5)).toEqual([
      "The value should be integer, not number.",
    ]);
    expect(problems({ type: ["string", "null"] }, null)).toEqual([]);
    expect(problems({ type: "number" }, 7)).toEqual([]);
  });

  it("checks enum and const by value, objects and arrays included", () => {
    expect(problems({ enum: ["red", "green"] }, "blue")).toEqual([
      'The value should be one of "red", "green".',
    ]);
    expect(problems({ enum: [{ a: [1, 2] }] }, { a: [1, 2] })).toEqual([]);
    expect(problems({ const: 3 }, 4)).toEqual(["The value should be 3."]);
  });

  it("checks numeric bounds in both spellings of exclusivity, and multipleOf", () => {
    expect(problems({ minimum: 1, maximum: 10 }, 11)).toEqual(["The value should be at most 10."]);
    // Draft 4: a boolean beside the bound.
    expect(problems({ minimum: 1, exclusiveMinimum: true }, 1)).toEqual([
      "The value should be above 1.",
    ]);
    // Draft 6 and later: the bound itself.
    expect(problems({ exclusiveMaximum: 10 }, 10)).toEqual(["The value should be below 10."]);
    expect(problems({ multipleOf: 0.1 }, 0.3)).toEqual([]);
    expect(problems({ multipleOf: 5 }, 12)).toEqual(["The value should be a multiple of 5."]);
  });

  it("counts string length in code points, and applies a pattern", () => {
    expect(problems({ maxLength: 2 }, "🌍🌍")).toEqual([]);
    expect(problems({ maxLength: 2 }, "abc")).toEqual([
      "The value should be at most 2 characters long.",
    ]);
    expect(problems({ minLength: 2 }, "a")).toEqual([
      "The value should be at least 2 characters long.",
    ]);
    expect(problems({ pattern: "^[A-Z]{2}$" }, "NL")).toEqual([]);
    expect(problems({ pattern: "^[A-Z]{2}$" }, "nl")).toEqual([
      "The value should match the pattern ^[A-Z]{2}$.",
    ]);
  });

  it("checks arrays: length, uniqueness, items, and a tuple in either spelling", () => {
    expect(problems({ minItems: 4, maxItems: 6 }, [1, 2, 3])).toEqual([
      "The value should have at least 4 items.",
    ]);
    expect(problems({ uniqueItems: true }, [1, 2, 1])).toEqual([
      "The value should not repeat an item.",
    ]);
    expect(problems({ items: { type: "number" } }, [1, "2"])).toEqual([
      "Item 2 should be number, not string.",
    ]);
    expect(
      problems({ prefixItems: [{ type: "string" }], items: { type: "number" } }, ["a", 1]),
    ).toEqual([]);
    expect(problems({ items: [{ type: "string" }], additionalItems: false }, ["a", 1])).toEqual([
      "Item 2 is not allowed.",
    ]);
  });

  it("checks objects: required, properties, additional properties, and member counts", () => {
    const schema = {
      type: "object",
      required: ["type", "coordinates"],
      properties: {
        type: { enum: ["Point"] },
        coordinates: { type: "array", items: { type: "number" }, minItems: 2 },
      },
      additionalProperties: false,
    };
    expect(problems(schema, { type: "Point", coordinates: [5, 52] })).toEqual([]);
    expect(problems(schema, { type: "Polygon", coordinates: [5, "52"], bbox: [] })).toEqual([
      'type should be one of "Point".',
      "coordinates[1] should be number, not string.",
      'The value should not have "bbox".',
    ]);
    expect(problems(schema, { type: "Point" })).toEqual(['The value should have "coordinates".']);
    expect(problems({ maxProperties: 1 }, { a: 1, b: 2 })).toEqual([
      "The value should have at most 1 members.",
    ]);
  });

  it("combines with allOf, anyOf, oneOf and not", () => {
    expect(problems({ allOf: [{ minimum: 1 }, { maximum: 3 }] }, 5)).toEqual([
      "The value should be at most 3.",
    ]);
    expect(problems({ anyOf: [{ type: "string" }, { type: "number" }] }, true)).toEqual([
      "The value matches none of the forms the description allows.",
    ]);
    expect(problems({ oneOf: [{ type: "string" }, { type: "object" }] }, 3)).toEqual([
      "The value matches none of the forms the description allows.",
    ]);
    expect(problems({ not: { const: 0 } }, 0)).toEqual([
      "The value is a value the description rules out.",
    ]);
  });

  it("does not hold a text value to exactly one of several encodings", () => {
    // How OGC describes a complex input: branches that differ by an annotation.
    const complex = {
      oneOf: [
        { type: "string", contentMediaType: "text/xml" },
        { type: "string", contentMediaType: "application/gml+xml" },
        { type: "object" },
      ],
    };
    expect(problems(complex, "<gml:Point/>")).toEqual([]);
  });

  it("ignores keywords it does not know, and annotations", () => {
    expect(
      problems(
        {
          type: "string",
          format: "date-time",
          contentMediaType: "text/plain",
          "x-ogc-role": "anything",
          someFutureKeyword: { minimum: 99 },
        },
        "not a date",
      ),
    ).toEqual([]);
  });

  it("follows boolean schemas", () => {
    expect(problems(true, { anything: 1 })).toEqual([]);
    expect(problems({ properties: { gone: false } }, { gone: 1 })).toEqual([
      "gone is not allowed.",
    ]);
  });

  it("says it did not check, rather than guess: a $ref, a pattern it cannot compile, a huge value", () => {
    expect(checkAgainstSchema({ $ref: "https://example.org/bbox.yaml" }, {})).toEqual({
      kind: "not-checked",
      keyword: "$ref",
    });
    expect(checkAgainstSchema({ oneOf: [{ $ref: "#/x" }, { type: "string" }] }, 1)).toEqual({
      kind: "not-checked",
      keyword: "$ref",
    });
    expect(checkAgainstSchema({ pattern: "(?<=" }, "x")).toEqual({
      kind: "not-checked",
      keyword: "pattern",
    });
    const huge = Array.from({ length: MAX_VISITS + 1 }, () => 1);
    expect(checkAgainstSchema({ items: { type: "number" } }, huge)).toEqual({
      kind: "not-checked",
      keyword: "size",
    });
  });

  it("reports at most five problems", () => {
    const many = Array.from({ length: 20 }, () => "x");
    expect(problems({ items: { type: "number" } }, many)).toHaveLength(5);
  });
});
