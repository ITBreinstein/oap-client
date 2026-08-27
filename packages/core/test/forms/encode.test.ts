import { describe, expect, it } from "vitest";
import {
  type FormPlan,
  type FormValues,
  type RequestOptions,
  resolveFormPlan,
  toExecuteBody,
  toExecuteRequest,
} from "../../src/index.js";

/** Plans come from the resolver, so the two halves are exercised together. */
function planFor(inputs: Record<string, unknown>): FormPlan {
  return resolveFormPlan({ id: "demo", inputs });
}

function inputsFor(inputs: Record<string, unknown>, values: FormValues): unknown {
  return toExecuteBody(planFor(inputs), values).inputs;
}

function bodyOf(request: RequestOptions): unknown {
  const raw = typeof request.body === "string" ? request.body : "null";
  const parsed: unknown = JSON.parse(raw);
  return parsed;
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
  });

  describe("geospatial values", () => {
    it("sends a geometry inline, untouched", () => {
      const geometry = { type: "Point", coordinates: [5.1, 52.1] };
      const inputs = inputsFor(
        { area: { schema: { format: "geojson-geometry" } } },
        { area: geometry },
      );
      expect(inputs).toEqual({ area: geometry });
    });

    it("sends a bbox inline, untouched", () => {
      const bbox = { bbox: [3.3, 50.7, 7.2, 53.6], crs: "urn:ogc:def:crs:EPSG::28992" };
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

  describe("qualified values", () => {
    it("wraps a value whose media type the body cannot carry natively", () => {
      const inputs = inputsFor(
        { doc: { schema: { type: "string", contentMediaType: "text/plain" } } },
        { doc: "hello" },
      );
      expect(inputs).toEqual({ doc: { value: "hello", mediaType: "text/plain" } });
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

  it("carries the response preference when one is asked for", () => {
    const plan = planFor({ name: { schema: { type: "string" } } });
    expect(toExecuteBody(plan, { name: "a" })).toEqual({ inputs: { name: "a" } });
    expect(toExecuteBody(plan, { name: "a" }, { response: "raw" })).toEqual({
      inputs: { name: "a" },
      response: "raw",
    });
  });
});

describe("toExecuteRequest", () => {
  const plan = planFor({ name: { schema: { type: "string" } } });

  it("produces a POST that client.send can take as-is", () => {
    const request = toExecuteRequest(plan, { name: "World" });

    expect(request.method).toBe("POST");
    expect(request.headers).toEqual({ "content-type": "application/json" });
    expect(bodyOf(request)).toEqual({ inputs: { name: "World" } });
  });

  it("asks for async execution with Prefer", () => {
    const request = toExecuteRequest(plan, { name: "World" }, { mode: "async" });
    expect(request.headers).toEqual({
      "content-type": "application/json",
      prefer: "respond-async",
    });
  });

  it("sends no Prefer header when the mode is left to the server", () => {
    expect(toExecuteRequest(plan, {}, { mode: "sync" }).headers).toEqual({
      "content-type": "application/json",
    });
  });
});
