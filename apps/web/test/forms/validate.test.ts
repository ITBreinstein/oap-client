/**
 * The client-side checks (T5) and the starting values. Each check is one the
 * plan states cheaply; the last rows pin what is deliberately *not* checked.
 */

import { describe, expect, it } from "vitest";
import { initialValues } from "../../src/forms/defaults.js";
import { toExecuteBody } from "../../src/forms/encode.js";
import { validateForm } from "../../src/forms/validate.js";
import { resolveFormPlan } from "../../src/forms/resolve.js";
import { fixtureProcess, planFor, withoutSourceText } from "./helpers.js";

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

  it("checks that a geometry field holds GeoJSON with a geometry in it", () => {
    const area = { area: { schema: { format: "geojson-polygon" } } };
    expect(errorsFor(area, { area: { geojson: "{ half" } })["area"]).toMatch(/not valid JSON/);
    expect(errorsFor(area, { area: { geojson: '{"type": "Feature"}' } })).toEqual({
      area: "This holds no GeoJSON geometry. Draw a shape on the map, or load a GeoJSON file.",
    });
    expect(
      errorsFor(area, { area: { geojson: '{"type":"Point","coordinates":[5.1,52.1]}' } }),
    ).toEqual({});
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

describe("raw JSON with a number a double cannot hold (W28)", () => {
  const raw = { filter: { schema: { type: "object", not: { required: ["x"] } } } };
  const typed = { filter: { rawJson: '{"value":{"id":1234567890123456789,"cap":1e400}}' } };

  it("is let through where the browser sends it as written", () => {
    expect(errorsFor(raw, typed)).toEqual({});
  });

  it("is refused, naming the number, where the browser would send another", () => {
    withoutSourceText(() => {
      expect(errorsFor(raw, typed)).toEqual({
        filter:
          "This browser would send 1234567890123456789 as 1234567890123456800. 1 more number would change too. Open the page in a current browser, or write the number as a string if the process accepts one.",
      });
    });
  });

  it("is refused in a complex input's JSON text too, but not in a geometry", () => {
    withoutSourceText(() => {
      const complex = {
        shape: {
          schema: {
            oneOf: [{ type: "string", contentMediaType: "text/plain" }, { type: "object" }],
          },
        },
      };
      expect(errorsFor(complex, { shape: { format: 1, value: '{"cap":1e400}' } })["shape"]).toMatch(
        /^This browser would send 1e400 as null\. Open the page/,
      );

      const area = { area: { schema: { format: "geojson-point" } } };
      const point = '{"type":"Point","coordinates":[5.12345678901234567890,52.1]}';
      expect(errorsFor(area, { area: { geojson: point } })).toEqual({});
    });
  });
});

describe("a number field holding only spaces (W27)", () => {
  const plan = planFor({
    distance: { schema: { type: "number", minimum: 1 } },
    count: { schema: { type: "integer" }, minOccurs: 0 },
  });

  it("is refused before sending when required", () => {
    // No bounds: Number(" ".trim()) is 0, a finite number, which passed.
    const unbounded = planFor({ distance: { schema: { type: "number" } } });
    expect(validateForm(unbounded, { distance: " " }).get("distance")).toBe(
      "Required. Fill this in before running.",
    );
  });

  it("is left out, not sent as a string, when optional", () => {
    const values = { distance: "5", count: "  " };
    expect(validateForm(plan, values).size).toBe(0);
    expect(toExecuteBody(plan, values).inputs).toEqual({ distance: 5 });
  });

  it("is a blank row in a list of numbers, dropped rather than sent", () => {
    const list = planFor({ n: { maxOccurs: 3, schema: { type: "number" } } });
    expect(validateForm(list, { n: ["1", " "] }).size).toBe(0);
    expect(toExecuteBody(list, { n: ["1", " "] }).inputs).toEqual({ n: [1] });
    expect(validateForm(list, { n: [" "] }).get("n")).toBe(
      "Required. Fill this in before running.",
    );
  });

  it("leaves a text field's spaces alone: they are text", () => {
    const text = planFor({ sep: { schema: { type: "string" } } });
    expect(toExecuteBody(text, { sep: " " }).inputs).toEqual({ sep: " " });
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

  describe("an optional repeatable input left alone (W18)", () => {
    it("does not send [false] for booleans", () => {
      const plan = planFor({
        flags: { schema: { type: "boolean" }, minOccurs: 0, maxOccurs: 5 },
      });
      expect(plan.fields[0]?.control.kind).toBe("list");
      expect(toExecuteBody(plan, initialValues(plan)).inputs).toEqual({});
    });

    it("does not send the item default for an enum", () => {
      const plan = planFor({
        layers: {
          schema: { type: "string", enum: ["roads", "water"], default: "roads" },
          minOccurs: 0,
          maxOccurs: 3,
        },
      });
      expect(toExecuteBody(plan, initialValues(plan)).inputs).toEqual({});
    });

    it("does not send the item default for an array of numbers", () => {
      const plan = planFor({
        weights: { schema: { type: "array", items: { type: "number", default: 1 } }, minOccurs: 0 },
      });
      expect(toExecuteBody(plan, initialValues(plan)).inputs).toEqual({});
    });

    it("still starts a required list's row at the item's default, which is sent", () => {
      const plan = planFor({
        flags: { schema: { type: "boolean" }, minOccurs: 1, maxOccurs: 5 },
        layers: {
          schema: { type: "string", enum: ["roads", "water"], default: "roads" },
          minOccurs: 1,
          maxOccurs: 3,
        },
      });
      expect(toExecuteBody(plan, initialValues(plan)).inputs).toEqual({
        flags: [false],
        layers: ["roads"],
      });
    });
  });
});
