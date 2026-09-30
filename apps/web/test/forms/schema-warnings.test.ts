/**
 * Schema warnings per field, on what will be sent: qualified values opened,
 * references skipped, repeatable inputs checked value by value, and a `$ref`
 * listed as not checked.
 */

import { describe, expect, it } from "vitest";
import { validateForm } from "../../src/forms/validate.js";
import { schemaWarnings } from "../../src/forms/schema-warnings.js";
import { resolveFormPlan } from "../../src/forms/resolve.js";
import { describeProcess, fixtureProcess } from "./helpers.js";

const inputs = fixtureProcess("pygeoapi/breinstein-inputs");
const plan = resolveFormPlan(inputs);

describe("schemaWarnings", () => {
  it("says nothing about values the schema allows", () => {
    const result = schemaWarnings(inputs, plan, { label: "short", count: "3", colour: "red" });
    expect(result.byField.size).toBe(0);
    expect(result.notChecked).toEqual([]);
  });

  it("warns, per field, about what the schema says, on the value as it will be sent", () => {
    const result = schemaWarnings(inputs, plan, {
      label: "a label much longer than twenty characters",
      count: "12",
    });
    expect(result.byField.get("label")).toEqual([
      "The value should be at most 20 characters long.",
    ]);
    // "12" from the text field is sent as the number 12.
    expect(result.byField.get("count")).toEqual(["The value should be at most 10."]);
  });

  it("lists an input behind a $ref as not checked, and does not guess", () => {
    const point = { type: "Point", coordinates: [5, 52] };
    const result = schemaWarnings(inputs, plan, { area: { geojson: JSON.stringify(point) } });
    expect(result.byField.has("area")).toBe(false);
    expect(result.notChecked).toEqual([{ inputId: "area", keyword: "$ref" }]);
  });

  it("checks a qualified value's value, and skips a reference", () => {
    const process = describeProcess({
      shape: {
        schema: {
          oneOf: [{ type: "string", contentMediaType: "text/xml" }, { type: "object" }],
        },
      },
    });
    const shapePlan = resolveFormPlan(process);
    expect(shapePlan.fields[0]?.control.kind).toBe("complex");
    // An array typed into the JSON-object format: sent as `{ "value": [1, 2] }`.
    // The wrapper is an object and would pass; the value inside it does not.
    expect(
      schemaWarnings(process, shapePlan, { shape: { format: 1, value: "[1, 2]" } }).byField.get(
        "shape",
      ),
    ).toEqual(["The value matches none of the forms the description allows."]);
    expect(
      schemaWarnings(process, shapePlan, {
        shape: { format: 0, href: "https://example.org/shape.gml" },
      }).byField.size,
    ).toBe(0);
  });

  it("checks a repeatable input value by value, and says which", () => {
    const process = describeProcess({
      codes: { maxOccurs: 3, schema: { type: "string", pattern: "^[A-Z]{2}$" } },
    });
    const codesPlan = resolveFormPlan(process);
    expect(
      schemaWarnings(process, codesPlan, { codes: ["NL", "be", "DE"] }).byField.get("codes"),
    ).toEqual(["Value 2: The value should match the pattern ^[A-Z]{2}$."]);
  });

  it("checks a raw JSON value as typed, and never makes it an error", () => {
    const process = describeProcess({
      settings: { schema: { oneOf: [{ type: "string" }, { type: "number" }] } },
    });
    const settingsPlan = resolveFormPlan(process);
    const values = { settings: { rawJson: '{"k": 1}' } };
    expect(schemaWarnings(process, settingsPlan, values).byField.get("settings")).toEqual([
      "The value matches none of the forms the description allows.",
    ]);
    // The blocking checks do not care: the run goes ahead.
    expect(validateForm(settingsPlan, values).size).toBe(0);
  });
});
