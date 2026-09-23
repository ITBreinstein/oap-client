/**
 * The client-side checks (T5) and the starting values. Each check is one the
 * plan states cheaply; the last rows pin what is deliberately *not* checked.
 */

import { describe, expect, it } from "vitest";
import { initialValues } from "../../src/forms/defaults.js";
import { validateForm } from "../../src/forms/validate.js";
import { resolveFormPlan } from "../../src/forms/resolve.js";
import { fixtureProcess, planFor } from "./helpers.js";

function errorsFor(inputs: Record<string, unknown>, values: Record<string, unknown>) {
  return Object.fromEntries(validateForm(planFor(inputs), values));
}

describe("validateForm", () => {
  it("requires a required field, and nothing of an optional one", () => {
    expect(
      errorsFor(
        { a: { schema: { type: "string" } }, b: { minOccurs: 0, schema: { type: "string" } } },
        { a: "", b: "" },
      ),
    ).toEqual({ a: "Required. Fill this in before running." });
  });

  it("checks a number against its bounds, and says what to enter", () => {
    const count = { count: { schema: { type: "integer", minimum: 1, maximum: 10 } } };
    expect(errorsFor(count, { count: "11" })).toEqual({
      count: "Enter a whole number from 1 to 10.",
    });
    expect(errorsFor(count, { count: "2.5" })).toEqual({
      count: "Enter a whole number from 1 to 10.",
    });
    expect(errorsFor(count, { count: "abc" })).toEqual({
      count: "Enter a whole number from 1 to 10.",
    });
    expect(errorsFor(count, { count: "10" })).toEqual({});
  });

  it("honours an exclusive bound (R2)", () => {
    const ratio = { r: { schema: { type: "number", minimum: 0, exclusiveMinimum: true } } };
    expect(errorsFor(ratio, { r: "0" })).toEqual({ r: "Enter a number above 0." });
    expect(errorsFor(ratio, { r: "0.001" })).toEqual({});
  });

  it("checks enum membership", () => {
    const colour = { c: { schema: { type: "string", enum: ["red", "green"] } } };
    expect(errorsFor(colour, { c: "purple" })).toEqual({ c: "Choose one of the listed values." });
    expect(errorsFor(colour, { c: "red" })).toEqual({});
  });

  it("checks maxLength, counting characters rather than UTF-16 units", () => {
    const label = { l: { schema: { type: "string", maxLength: 3 } } };
    expect(errorsFor(label, { l: "abcd" })).toEqual({
      l: "Use at most 3 characters; this has 4.",
    });
    expect(errorsFor(label, { l: "a😀c" })).toEqual({});
  });

  it("checks that raw JSON parses", () => {
    const raw = { raw: { schema: { type: "object" } } };
    expect(errorsFor(raw, { raw: { rawJson: "{" } })["raw"]).toMatch(/^This is not valid JSON/);
    expect(errorsFor(raw, { raw: { rawJson: "{}" } })).toEqual({});
  });

  it("checks a complex input's JSON object branch parses, and not its text branches", () => {
    const plan = resolveFormPlan(fixtureProcess("zoo-project/Buffer"));
    expect(
      Object.fromEntries(validateForm(plan, { InputPolygon: { format: 1, value: "{" } })),
    ).toHaveProperty("InputPolygon");
    expect(
      Object.fromEntries(validateForm(plan, { InputPolygon: { format: 0, value: "<not xml" } })),
    ).toEqual({});
  });

  it("checks a bbox has as many coordinates as the schema allows", () => {
    const plan = resolveFormPlan(fixtureProcess("pygeoapi/breinstein-bbox"));
    const crs = "http://www.opengis.net/def/crs/OGC/1.3/CRS84";
    expect(
      Object.fromEntries(validateForm(plan, { bbox: { coordinates: [1, 2, 3], crs } })),
    ).toEqual({ bbox: "Draw a box on the map, or enter all 4 coordinates." });
    expect(
      Object.fromEntries(validateForm(plan, { bbox: { coordinates: [3, 50.7, 7, 53.6], crs } })),
    ).toEqual({});
  });

  it("checks a list's length against maxOccurs, and each item", () => {
    const tags = { t: { maxOccurs: 3, schema: { type: "string", maxLength: 2 } } };
    expect(errorsFor(tags, { t: ["a", "b", "c", "d"] })).toEqual({
      t: "Give at most 3 values; remove 1.",
    });
    expect(errorsFor(tags, { t: ["a", "long"] })).toEqual({
      t: "Value 2: Use at most 2 characters; this has 4.",
    });
  });

  it("requires a required list to have at least one value", () => {
    expect(errorsFor({ t: { maxOccurs: 3, schema: { type: "string" } } }, { t: ["", ""] })).toEqual(
      { t: "Required. Fill this in before running." },
    );
  });

  it("does not check pattern or format, which the server is authoritative on", () => {
    const shaped = {
      p: { schema: { type: "string", pattern: "^[0-9]+$" } },
      d: { schema: { type: "string", format: "date-time" } },
    };
    expect(errorsFor(shaped, { p: "letters", d: "yesterday" })).toEqual({});
  });

  it("keys errors in a Map, so an input called __proto__ is an ordinary key (N5)", () => {
    const plan = planFor(
      JSON.parse('{"__proto__":{"schema":{"type":"string"}}}') as Record<string, unknown>,
    );
    expect(validateForm(plan, {}).get("__proto__")).toBe("Required. Fill this in before running.");
  });
});

describe("initialValues", () => {
  it("starts required fields at their default and leaves optional ones empty", () => {
    const plan = resolveFormPlan(fixtureProcess("pygeoapi/breinstein-inputs"));
    expect(initialValues(plan)).toEqual({
      label: "",
      notes: "",
      count: "",
      ratio: "0.5",
      colour: undefined,
      enabled: false,
      tags: [""],
      comment: "",
    });
  });

  it("leaves an optional boolean not set, even with a default (R9)", () => {
    // SAGA.garden_fractals.1 has none; Gdal_Warp's four optional booleans do.
    const plan = resolveFormPlan(fixtureProcess("zoo-project/Gdal_Warp"));
    const booleans = plan.fields.filter((field) => field.control.kind === "checkbox");
    expect(booleans.length).toBeGreaterThan(0);
    const values = initialValues(plan);
    for (const field of booleans) expect(values[field.id]).toBeUndefined();
  });

  it("starts a complex input on its first format", () => {
    const plan = resolveFormPlan(fixtureProcess("zoo-project/Buffer"));
    expect(initialValues(plan)["InputPolygon"]).toEqual({ format: 0 });
  });
});
