/**
 * The resolver, ported from the prototype's
 * `packages/core/test/forms/resolve.test.ts`. The resolver now takes the
 * core's parsed description (T2), so the rows about malformed documents moved:
 * a description that is not an object is the core's to refuse, and an input
 * that is not an object is the core's to drop with a warning. Those rows now
 * assert the core's answer, because it is what the detail screen shows.
 */

import { parseDescription } from "@breinstein/oap-client";
import { describe, expect, it } from "vitest";
import { CRS84 } from "../../src/forms/crs.js";
import { resolveFormPlan } from "../../src/forms/resolve.js";
import { describeProcess, fixtureProcess, handBuiltProcess, planFor } from "./helpers.js";

describe("resolveFormPlan", () => {
  it("reads the field metadata, defaulting the title to the input id", () => {
    const plan = planFor(
      {
        distance: { title: "Distance", description: "metres", schema: { type: "number" } },
        untitled: { schema: { type: "string" } },
      },
      "buffer",
    );

    expect(plan.processId).toBe("buffer");
    expect(plan.fields.map((field) => [field.id, field.title, field.description])).toEqual([
      ["distance", "Distance", "metres"],
      ["untitled", "untitled", undefined],
    ]);
  });

  it("keeps the server's input order", () => {
    const plan = planFor({ c: { schema: {} }, a: { schema: {} }, b: { schema: {} } });
    expect(plan.fields.map((field) => field.id)).toEqual(["c", "a", "b"]);
  });

  it("treats a missing minOccurs as required, and 0 as optional", () => {
    const plan = planFor({
      implicit: { schema: { type: "string" } },
      optional: { minOccurs: 0, schema: { type: "string" } },
    });
    expect(plan.fields.map((field) => field.required)).toEqual([true, false]);
  });

  it("wraps a repeatable input in a list", () => {
    const plan = planFor({ tag: { minOccurs: 1, maxOccurs: 5, schema: { type: "string" } } });
    expect(plan.fields[0]?.control).toEqual({
      kind: "list",
      item: { kind: "text" },
      minItems: 1,
      maxItems: 5,
    });
  });

  it("wraps an unbounded input with no upper limit", () => {
    const plan = planFor({
      tag: { minOccurs: 0, maxOccurs: "unbounded", schema: { type: "string" } },
    });
    expect(plan.fields[0]?.control).toEqual({ kind: "list", item: { kind: "text" } });
  });

  it("R10: wraps an array schema that also repeats, since each occurrence may be an array", () => {
    // Corrected. The prototype's row "does not wrap an array schema twice"
    // pinned `{ kind: "list", item: { kind: "text" } }`: one list where
    // `execute.yaml` allows an array per occurrence. See the review.
    const plan = planFor({
      tags: { maxOccurs: 3, schema: { type: "array", items: { type: "string" } } },
    });
    expect(plan.fields[0]?.control).toEqual({
      kind: "list",
      item: { kind: "list", item: { kind: "text" } },
      maxItems: 3,
      minItems: 1,
    });
  });

  it("carries a top-level contentMediaType through, for display", () => {
    const plan = planFor({
      doc: { schema: { type: "string", contentMediaType: "application/json" } },
    });
    expect(plan.fields[0]?.mediaType).toBe("application/json");
  });

  it("still produces a field when the input has no schema", () => {
    // Changed: the core degrades an absent schema to `{}` and warns
    // (`inputs:mystery:…`), so the resolver sees an empty schema — "anything" —
    // rather than none, and gives it the JSON editor.
    const plan = planFor({ mystery: { title: "Mystery" } });

    expect(plan.fields[0]?.control).toEqual({
      kind: "json",
      reason: "the schema declares no type this client recognises",
      schema: {},
    });
    expect(plan.diagnostics).toEqual([
      {
        inputId: "mystery",
        code: "unsupported-type",
        message: "the schema declares no type this client recognises",
        keyword: "type",
      },
    ]);
  });

  it("leaves an input that is not an object to the core, which drops it and says so", () => {
    // Moved: the prototype produced a JSON field for it. The core's parser
    // owns malformed descriptions now, and its warning is shown on the
    // process detail screen.
    const { process, report } = parseDescription(
      { id: "broken-demo", inputs: { broken: "nonsense" } },
      { documentUrl: "https://example.org/processes/broken-demo" },
    );
    expect(resolveFormPlan(process).fields).toEqual([]);
    expect(report.warnings).toContain("inputs:broken:not-an-object");
  });

  it("accepts a process with no inputs", () => {
    expect(resolveFormPlan(describeProcess(undefined, "noop"))).toEqual({
      processId: "noop",
      fields: [],
      diagnostics: [],
    });
  });

  it("leaves inputs of the wrong shape to the core's report", () => {
    const { process, report } = parseDescription(
      { id: "wrong", inputs: [] },
      { documentUrl: "https://example.org/processes/wrong" },
    );
    expect(resolveFormPlan(process).fields).toEqual([]);
    expect(report.warnings).toContain("inputs-is-not-an-object");
  });

  it("stops descending a self-referential schema", () => {
    const recursive: Record<string, unknown> = { type: "array" };
    recursive["items"] = recursive;

    const plan = resolveFormPlan(handBuiltProcess({ id: "deep", schema: recursive }));
    expect(plan.diagnostics.at(-1)?.message).toMatch(/nests deeper/);
  });

  it("names the input on every diagnostic", () => {
    const plan = planFor({
      ok: { schema: { type: "string" } },
      bad: { schema: { oneOf: [] } },
    });
    expect(plan.diagnostics.map((d) => d.inputId)).toEqual(["bad"]);
  });
});

describe("reading the core's flags, not re-deriving them (T2)", () => {
  it("takes required from the core even where minOccurs would say otherwise", () => {
    // Reduction test (e). The core's parser cannot produce this disagreement —
    // `required` is `minOccurs >= 1` by construction, and a malformed
    // `minOccurs` is normalised to 1 *before* either is set — so the only way
    // to catch a resolver that re-derives is a description built by hand.
    const plan = resolveFormPlan(
      handBuiltProcess({ id: "x", minOccurs: 1, required: false, schema: { type: "string" } }),
    );
    expect(plan.fields[0]?.required).toBe(false);
  });

  it("takes multiple from the core even where maxOccurs would say otherwise", () => {
    const plan = resolveFormPlan(
      handBuiltProcess({ id: "x", maxOccurs: 1, multiple: true, schema: { type: "string" } }),
    );
    expect(plan.fields[0]?.control.kind).toBe("list");
  });

  it("follows the core on a malformed minOccurs, which it reads as the default of 1", () => {
    const plan = planFor({ x: { minOccurs: "0", schema: { type: "string" } } });
    expect(plan.fields[0]?.required).toBe(true);
  });
});

describe("real descriptions", () => {
  it("pins nullable as 'may be left empty', never as a reason to refuse (Buffer.BufferDistance)", () => {
    const plan = resolveFormPlan(fixtureProcess("zoo-project/Buffer"));
    const distance = plan.fields.find((field) => field.id === "BufferDistance");
    expect(distance).toEqual({
      id: "BufferDistance",
      title: "Buffer Distance",
      description: "Distance to be used to calculate buffer.",
      required: false,
      control: { kind: "number", integer: false, default: 10 },
    });
    expect(plan.diagnostics).toEqual([]);
  });

  it("reads pygeoapi's breinstein-bbox as a four-number CRS84 box", () => {
    const [field] = resolveFormPlan(fixtureProcess("pygeoapi/breinstein-bbox")).fields;
    expect(field?.control).toEqual({
      kind: "bbox",
      crs: [CRS84],
      defaultCrs: CRS84,
      dimensions: [4],
    });
  });

  it("reads ZOO's echo bbox, which lists only EPSG:4326 and 3785, keeping its default", () => {
    const echo = resolveFormPlan(fixtureProcess("zoo-project/echo"));
    expect(echo.fields.find((field) => field.id === "c")?.control).toEqual({
      kind: "bbox",
      crs: ["urn:ogc:def:crs:EPSG:6.6:4326", "urn:ogc:def:crs:EPSG:6.6:3785"],
      defaultCrs: "urn:ogc:def:crs:EPSG:6.6:4326",
      dimensions: [4, 6],
    });
  });

  it("gives breinstein-inputs a control of every kind, and no fallback", () => {
    const plan = resolveFormPlan(fixtureProcess("pygeoapi/breinstein-inputs"));
    expect(plan.fields.map((field) => [field.id, field.control.kind, field.required])).toEqual([
      ["label", "text", true],
      ["notes", "text", true],
      ["count", "number", true],
      ["ratio", "number", true],
      ["colour", "select", true],
      ["enabled", "checkbox", true],
      ["tags", "list", true],
      ["comment", "text", false],
    ]);
    expect(plan.diagnostics).toEqual([]);
  });

  it("wraps Ogr2Ogr's maxOccurs: 1024 and Gdal_Translate's 'unbounded' as lists", () => {
    const ogr = resolveFormPlan(fixtureProcess("zoo-project/Ogr2Ogr"));
    const gdal = resolveFormPlan(fixtureProcess("zoo-project/Gdal_Translate"));
    expect(ogr.fields.filter((field) => field.control.kind === "list").length).toBeGreaterThan(0);
    expect(gdal.fields.find((field) => field.id === "GCP")?.control).toMatchObject({
      kind: "list",
    });
    expect(gdal.fields.find((field) => field.id === "GCP")?.control).not.toHaveProperty(
      "maxItems",
      expect.anything(),
    );
  });
});
