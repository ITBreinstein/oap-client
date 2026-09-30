/**
 * Review (2026-09-30), PR #29: what the schema checker says about JSON Schema
 * assertion keywords it does not implement.
 *
 * schema-check.ts promises: "Where it cannot check honestly it says so instead
 * of guessing". It treats `if`/`then`/`else`, `dependentRequired`,
 * `patternProperties`, `propertyNames`, `contains` and `unevaluatedProperties`
 * as unknown keywords and answers "checked, no problems" — the same verdict as
 * a value that really is fine — and nothing reaches `notChecked`, so the
 * `schema-not-checked` observation is not recorded either.
 */

import { describe, expect, it } from "vitest";
import { checkAgainstSchema } from "../../src/forms/schema-check.js";

describe("assertion keywords the checker does not implement", () => {
  it.fails("W19: if/then: a value the schema rules out is not reported as checked-and-fine", () => {
    const schema = {
      type: "object",
      properties: { unit: { type: "string" }, distance: { type: "number" } },
      if: { properties: { unit: { const: "km" } } },
      then: { properties: { distance: { maximum: 100 } } },
    };
    const verdict = checkAgainstSchema(schema, { unit: "km", distance: 5000 });
    expect(verdict).not.toEqual({ kind: "checked", problems: [] });
  });

  it.fails(
    "W19: dependentRequired: a missing dependent member is not reported as checked-and-fine",
    () => {
      const schema = {
        type: "object",
        dependentRequired: { crs: ["bbox"] },
      };
      const verdict = checkAgainstSchema(schema, { crs: "EPSG:28992" });
      expect(verdict).not.toEqual({ kind: "checked", problems: [] });
    },
  );

  it.fails(
    "W19: contains: an array without the required item is not reported as checked-and-fine",
    () => {
      const schema = { type: "array", contains: { const: "id" } };
      const verdict = checkAgainstSchema(schema, ["name", "height"]);
      expect(verdict).not.toEqual({ kind: "checked", problems: [] });
    },
  );

  it.fails("W19: patternProperties: a member it allows is not warned about as forbidden", () => {
    const schema = {
      type: "object",
      patternProperties: { "^x-": { type: "string" } },
      additionalProperties: false,
    };
    const verdict = checkAgainstSchema(schema, { "x-note": "fine" });
    expect(verdict).toEqual({ kind: "checked", problems: [] });
  });
});
