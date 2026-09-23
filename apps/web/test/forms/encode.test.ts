/**
 * The encoder, ported from the prototype's
 * `packages/core/test/forms/encode.test.ts`.
 *
 * Dropped, on purpose, because the code they tested is gone: the prototype's
 * `toExecuteRequest` rows ("produces a POST that client.send can take as-is",
 * "asks for async execution with Prefer", "sends no Prefer header when the mode
 * is left to the server") and "carries the response preference when one is
 * asked for". The web app hands `inputs` to the core's `execute()`, which
 * builds the request, and whose own suite covers the method, `Content-Type`,
 * `Prefer` and `response` (packages/core/test/execution/).
 */

import { describe, expect, it } from "vitest";
import { CRS84 } from "../../src/forms/crs.js";
import { toExecuteBody, type FormValues } from "../../src/forms/encode.js";
import { resolveFormPlan } from "../../src/forms/resolve.js";
import { fixtureProcess, planFor } from "./helpers.js";

/** Plans come from the resolver, so the two halves are exercised together. */
function inputsFor(inputs: Record<string, unknown>, values: FormValues): unknown {
  // Round-tripped, so what is asserted is what reaches the wire.
  return JSON.parse(JSON.stringify(toExecuteBody(planFor(inputs), values).inputs));
}

describe("toExecuteBody", () => {
  it("sends primitives inline", () => {
    const inputs = inputsFor(
      {
        name: { schema: { type: "string" } },
        count: { schema: { type: "integer" } },
        flag: { schema: { type: "boolean" } },
      },
      { name: "World", count: 3, flag: true },
    );
    expect(inputs).toEqual({ name: "World", count: 3, flag: true });
  });

  it("coerces what a form control hands back as a string", () => {
    const inputs = inputsFor(
      {
        distance: { schema: { type: "number" } },
        steps: { schema: { type: "integer" } },
        enabled: { schema: { type: "boolean" } },
        disabled: { schema: { type: "boolean" } },
      },
      { distance: "2.5", steps: "10", enabled: "true", disabled: "false" },
    );
    expect(inputs).toEqual({ distance: 2.5, steps: 10, enabled: true, disabled: false });
  });

  it("leaves an unparseable number alone, for the server to refuse", () => {
    const inputs = inputsFor({ distance: { schema: { type: "number" } } }, { distance: "far" });
    expect(inputs).toEqual({ distance: "far" });
  });

  it("omits values the user never supplied", () => {
    const inputs = inputsFor(
      {
        a: { schema: { type: "string" } },
        b: { schema: { type: "string" } },
        c: { schema: { type: "string" } },
        d: { schema: { type: "string" } },
      },
      { a: "kept", b: "", c: undefined, d: null },
    );
    expect(inputs).toEqual({ a: "kept" });
  });

  it("keeps a zero and a false, which are supplied values", () => {
    const inputs = inputsFor(
      { n: { schema: { type: "number" } }, f: { schema: { type: "boolean" } } },
      { n: 0, f: false },
    );
    expect(inputs).toEqual({ n: 0, f: false });
  });

  it("leaves an optional boolean that is not set out of the request (R9)", () => {
    // The three-state control's "Not set" is `undefined`, which the encoder
    // already omits. Refuted as a defect of the prototype; see the review.
    expect(
      inputsFor({ f: { minOccurs: 0, schema: { type: "boolean" } } }, { f: undefined }),
    ).toEqual({});
  });

  describe("repeatable inputs", () => {
    const declaration = { tag: { maxOccurs: 3, schema: { type: "string" } } };

    it("encodes each item", () => {
      expect(inputsFor(declaration, { tag: ["a", "b"] })).toEqual({ tag: ["a", "b"] });
    });

    it("treats a lone value as a list of one", () => {
      expect(inputsFor(declaration, { tag: "a" })).toEqual({ tag: ["a"] });
    });

    it("drops blank rows", () => {
      expect(inputsFor(declaration, { tag: ["a", "", "b"] })).toEqual({ tag: ["a", "b"] });
    });

    it("omits a list with nothing left in it", () => {
      expect(inputsFor(declaration, { tag: ["", ""] })).toEqual({});
    });

    it("coerces inside the list", () => {
      const inputs = inputsFor(
        { n: { maxOccurs: "unbounded", schema: { type: "integer" } } },
        { n: ["1", "2"] },
      );
      expect(inputs).toEqual({ n: [1, 2] });
    });

    it("R10: sends an array per occurrence for an array input that repeats", () => {
      const inputs = inputsFor(
        { n: { maxOccurs: 3, schema: { type: "array", items: { type: "integer" } } } },
        { n: [["1", "2"], ["3"]] },
      );
      expect(inputs).toEqual({ n: [[1, 2], [3]] });
    });
  });

  describe("geospatial values", () => {
    it("sends a geometry inline, untouched — accepted limitation N4", () => {
      // Pinned to the current behaviour, which the review found does not match
      // the standard: `inputValueNoObject` admits no bare object, so 1.0 wants
      // `{ "value": { … } }`, and ZOO answers a bare object for a complex input
      // with a 500. Accepted because drawing geometries is out of scope here:
      // the renderer shows a raw JSON editor, where the user writes the wire
      // value. Revisit when geometry drawing lands.
      const geometry = { type: "Point", coordinates: [5.1, 52.1] };
      const inputs = inputsFor(
        { area: { schema: { format: "geojson-geometry" } } },
        { area: geometry },
      );
      expect(inputs).toEqual({ area: geometry });
    });

    it("passes an already-encoded bbox object through untouched (the raw JSON route)", () => {
      // Corrected test data. The prototype's row sent degrees labelled as
      // EPSG:28992, whose coordinates are metres; this is the Netherlands in RD.
      const bbox = {
        bbox: [13_600, 306_900, 278_000, 619_300],
        crs: "urn:ogc:def:crs:EPSG::28992",
      };
      const inputs = inputsFor({ extent: { schema: { format: "ogc-bbox" } } }, { extent: bbox });
      expect(inputs).toEqual({ extent: bbox });
    });

    it("does not wrap application/geo+json, which the body carries natively", () => {
      const geometry = { type: "Point", coordinates: [5.1, 52.1] };
      const inputs = inputsFor(
        {
          area: {
            schema: { format: "geojson-geometry", contentMediaType: "application/geo+json" },
          },
        },
        { area: geometry },
      );
      expect(inputs).toEqual({ area: geometry });
    });
  });

  describe("bounding boxes (R6, T9)", () => {
    const pygeoapi = resolveFormPlan(fixtureProcess("pygeoapi/breinstein-bbox"));
    const zooEcho = resolveFormPlan(fixtureProcess("zoo-project/echo"));
    const netherlands = [3, 50.7, 7, 53.6];

    it("R6: builds { bbox, crs } from the widget's coordinates and the chosen CRS", () => {
      const body = toExecuteBody(pygeoapi, { bbox: { coordinates: netherlands, crs: CRS84 } });
      expect(body.inputs).toEqual({ bbox: { bbox: netherlands, crs: CRS84 } });
      expect(body.notes).toEqual([]);
    });

    it("R6: always sends the CRS, even for a bare array in the default CRS", () => {
      // Reduction test (a) breaks exactly this.
      expect(toExecuteBody(pygeoapi, { bbox: netherlands }).inputs).toEqual({
        bbox: { bbox: netherlands, crs: CRS84 },
      });
    });

    it("T9: swaps to latitude-first for an EPSG:4326-only input, and says it did", () => {
      const body = toExecuteBody(zooEcho, {
        c: { coordinates: netherlands, crs: "urn:ogc:def:crs:EPSG:6.6:4326" },
      });
      expect(body.inputs).toEqual({
        c: { bbox: [50.7, 3, 53.6, 7], crs: "urn:ogc:def:crs:EPSG:6.6:4326" },
      });
      expect(body.notes).toEqual([
        { inputId: "c", code: "bbox-axis-swapped", crs: "urn:ogc:def:crs:EPSG:6.6:4326" },
      ]);
    });

    it("T9: swaps a six-number box pairwise, leaving the heights where they are", () => {
      const body = toExecuteBody(zooEcho, {
        c: {
          coordinates: [3, 50.7, 0, 7, 53.6, 100],
          crs: "http://www.opengis.net/def/crs/EPSG/0/4326",
        },
      });
      expect(body.inputs).toEqual({
        c: { bbox: [50.7, 3, 0, 53.6, 7, 100], crs: "http://www.opengis.net/def/crs/EPSG/0/4326" },
      });
    });

    it("T9: sends a projected CRS's coordinates as typed, and never reprojects", () => {
      const rd = planFor({
        extent: {
          schema: {
            format: "ogc-bbox",
            properties: { crs: { type: "string", enum: ["urn:ogc:def:crs:EPSG::28992"] } },
          },
        },
      });
      const box = [13_600, 306_900, 278_000, 619_300];
      const body = toExecuteBody(rd, {
        extent: { coordinates: box, crs: "urn:ogc:def:crs:EPSG::28992" },
      });
      expect(body.inputs).toEqual({ extent: { bbox: box, crs: "urn:ogc:def:crs:EPSG::28992" } });
      expect(body.notes).toEqual([]);
    });
  });

  describe("complex values (R7, T3)", () => {
    const buffer = resolveFormPlan(fixtureProcess("zoo-project/Buffer"));

    it("R7: qualifies the value with the chosen branch's media type and encoding", () => {
      expect(
        toExecuteBody(buffer, { InputPolygon: { format: 0, value: "<gml:Polygon/>" } }).inputs,
      ).toEqual({
        InputPolygon: { value: "<gml:Polygon/>", mediaType: "text/xml", encoding: "UTF-8" },
      });
    });

    it("sends a JSON object branch as { value: object }, which ZOO accepts", () => {
      expect(
        toExecuteBody(buffer, { InputPolygon: { format: 1, value: '{"type":"Point"}' } }).inputs,
      ).toEqual({ InputPolygon: { value: { type: "Point" } } });
    });

    it("sends a URL as { href, type } with the chosen format's media type", () => {
      expect(
        toExecuteBody(buffer, {
          InputPolygon: { format: 0, href: " https://example.org/polygon.gml ", value: "" },
        }).inputs,
      ).toEqual({ InputPolygon: { href: "https://example.org/polygon.gml", type: "text/xml" } });
    });

    it("types a URL for the JSON object branch as application/json", () => {
      expect(
        toExecuteBody(buffer, {
          InputPolygon: { format: 1, href: "https://example.org/polygon.json" },
        }).inputs,
      ).toEqual({
        InputPolygon: { href: "https://example.org/polygon.json", type: "application/json" },
      });
    });

    it("leaves a complex input with neither a value nor a URL out", () => {
      expect(
        toExecuteBody(buffer, { InputPolygon: { format: 0, value: "", href: "" } }).inputs,
      ).toEqual({});
    });
  });

  describe("qualified values", () => {
    it("N3: sends a single-format string as a string, which is what its schema says it is", () => {
      // Corrected. The prototype's row "wraps a value whose media type the body
      // cannot carry natively" pinned `{ value, mediaType: "text/plain" }`: a
      // JSON string carries text/plain natively, the server already knows the
      // one format, and pygeoapi hands the wrapper to the processor as-is
      // (pygeoapi/execution/breinstein-inputs-qualified-not-unwrapped.http).
      const inputs = inputsFor(
        { doc: { schema: { type: "string", contentMediaType: "text/plain" } } },
        { doc: "hello" },
      );
      expect(inputs).toEqual({ doc: "hello" });
    });
  });

  describe("by reference", () => {
    it("passes an href through instead of the value", () => {
      const inputs = inputsFor(
        { area: { schema: { format: "geojson-geometry" } } },
        { area: { href: "https://example.org/area.geojson", type: "application/geo+json" } },
      );
      expect(inputs).toEqual({
        area: { href: "https://example.org/area.geojson", type: "application/geo+json" },
      });
    });

    it("drops a type that is not a string, rather than inventing one", () => {
      const inputs = inputsFor(
        { area: { schema: { format: "geojson-geometry" } } },
        { area: { href: "https://example.org/a.json", type: 7 } },
      );
      expect(inputs).toEqual({ area: { href: "https://example.org/a.json" } });
    });

    it("leaves a raw JSON field's own href alone", () => {
      // The user typed this object into a JSON editor; it means what they meant.
      const authored = { href: "https://example.org/thing", extra: true };
      const inputs = inputsFor({ raw: { schema: { type: "object" } } }, { raw: authored });
      expect(inputs).toEqual({ raw: authored });
    });
  });

  describe("raw JSON", () => {
    it("parses the editor's text into the wire value", () => {
      expect(
        inputsFor(
          { raw: { schema: { type: "object" } } },
          { raw: { rawJson: '{"value":{"a":1}}' } },
        ),
      ).toEqual({ raw: { value: { a: 1 } } });
    });

    it("treats an empty editor as not supplied", () => {
      expect(
        inputsFor({ raw: { schema: { type: "object" } } }, { raw: { rawJson: "  " } }),
      ).toEqual({});
    });
  });

  describe("input ids that collide with Object.prototype (N5)", () => {
    it("sends a value for an input whose id is __proto__", () => {
      const plan = planFor(
        JSON.parse('{"__proto__":{"schema":{"type":"string"}}}') as Record<string, unknown>,
      );
      const values = JSON.parse('{"__proto__":"x"}') as Record<string, unknown>;
      expect(JSON.stringify(toExecuteBody(plan, values).inputs)).toBe('{"__proto__":"x"}');
    });

    it("sends nothing for a repeatable input named constructor that the user never filled", () => {
      expect(inputsFor({ constructor: { maxOccurs: 3, schema: { type: "string" } } }, {})).toEqual(
        {},
      );
    });
  });
});
