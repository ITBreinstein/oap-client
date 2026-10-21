/**
 * STYLE TRIAL: an input's value as its field shows it, for the Copy beside
 * it in "Inputs you sent" (`app/field-text.ts`).
 */

import { describe, expect, it } from "vitest";
import { fieldText } from "../../src/app/field-text.js";
import type { ComplexControl } from "../../src/forms/plan.js";

const POLYGON =
  '{\n\t"type": "Polygon",\n\t"coordinates": [[[4.27, 52.1], [4.4, 52.03], [4.27, 52.1]]]\n}';

describe("fieldText", () => {
  it("gives a geometry as the GeoJSON in its field, not wrapped as it is sent", () => {
    const text = fieldText(
      { kind: "geometry", wrapper: "geometry", geometryTypes: ["Polygon"] },
      { geojson: POLYGON },
    );
    expect(text).toBe(POLYGON);
  });

  it("gives text, a number and raw JSON as typed", () => {
    expect(fieldText({ kind: "text" }, "hello")).toBe("hello");
    expect(fieldText({ kind: "number", integer: false }, "1.50")).toBe("1.50");
    expect(fieldText({ kind: "number", integer: true }, 3)).toBe("3");
    expect(fieldText({ kind: "json", reason: "oneOf" }, { rawJson: '{"a": 1.0}' })).toBe(
      '{"a": 1.0}',
    );
  });

  it("gives a complex input's inline text or its link, and nothing for a file", () => {
    const control: ComplexControl = {
      kind: "complex",
      formats: [{ label: "GeoJSON", mediaType: "application/geo+json", object: true }],
      byReference: true,
    };
    expect(fieldText(control, { format: 0, value: POLYGON })).toBe(POLYGON);
    expect(fieldText(control, { format: 0, href: " https://example.org/a.json " })).toBe(
      "https://example.org/a.json",
    );
    expect(fieldText(control, { format: 0, value: "e30=", file: "a.json" })).toBeUndefined();
  });

  it("gives nothing for a field with no one text to paste", () => {
    expect(fieldText({ kind: "checkbox" }, true)).toBeUndefined();
    expect(fieldText({ kind: "select", options: [] }, "a")).toBeUndefined();
    expect(fieldText({ kind: "list", item: { kind: "text" } }, ["a", "b"])).toBeUndefined();
    expect(
      fieldText(
        { kind: "bbox", crs: [], defaultCrs: "", dimensions: [4] },
        { coordinates: [1, 2, 3, 4], crs: "" },
      ),
    ).toBeUndefined();
  });
});
