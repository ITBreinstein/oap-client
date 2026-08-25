import { describe, expect, it } from "vitest";
import { resolveFormPlan } from "../../src/index.js";

describe("resolveFormPlan", () => {
  it("reads the field metadata, defaulting the title to the input id", () => {
    const plan = resolveFormPlan({
      id: "buffer",
      inputs: {
        distance: { title: "Distance", description: "metres", schema: { type: "number" } },
        untitled: { schema: { type: "string" } },
      },
    });

    expect(plan.processId).toBe("buffer");
    expect(plan.fields.map((field) => [field.id, field.title, field.description])).toEqual([
      ["distance", "Distance", "metres"],
      ["untitled", "untitled", undefined],
    ]);
  });

  it("keeps the server's input order", () => {
    const plan = resolveFormPlan({
      inputs: { c: { schema: {} }, a: { schema: {} }, b: { schema: {} } },
    });
    expect(plan.fields.map((field) => field.id)).toEqual(["c", "a", "b"]);
  });

  it("treats a missing minOccurs as required, and 0 as optional", () => {
    const plan = resolveFormPlan({
      inputs: {
        implicit: { schema: { type: "string" } },
        optional: { minOccurs: 0, schema: { type: "string" } },
      },
    });
    expect(plan.fields.map((field) => field.required)).toEqual([true, false]);
  });

  it("wraps a repeatable input in a list", () => {
    const plan = resolveFormPlan({
      inputs: { tag: { minOccurs: 1, maxOccurs: 5, schema: { type: "string" } } },
    });
    expect(plan.fields[0]?.control).toEqual({
      kind: "list",
      item: { kind: "text" },
      minItems: 1,
      maxItems: 5,
    });
  });

  it("wraps an unbounded input with no upper limit", () => {
    const plan = resolveFormPlan({
      inputs: { tag: { minOccurs: 0, maxOccurs: "unbounded", schema: { type: "string" } } },
    });
    expect(plan.fields[0]?.control).toEqual({ kind: "list", item: { kind: "text" } });
  });

  it("does not wrap an array schema twice", () => {
    const plan = resolveFormPlan({
      inputs: { tags: { maxOccurs: 3, schema: { type: "array", items: { type: "string" } } } },
    });
    expect(plan.fields[0]?.control).toEqual({ kind: "list", item: { kind: "text" } });
  });

  it("carries contentMediaType through for the encoder", () => {
    const plan = resolveFormPlan({
      inputs: { doc: { schema: { type: "string", contentMediaType: "application/json" } } },
    });
    expect(plan.fields[0]?.mediaType).toBe("application/json");
  });

  it("still produces a field when the input has no schema", () => {
    const plan = resolveFormPlan({ inputs: { mystery: { title: "Mystery" } } });

    expect(plan.fields[0]?.control).toEqual({
      kind: "json",
      reason: "the schema fragment is missing",
    });
    expect(plan.diagnostics).toEqual([
      { inputId: "mystery", code: "missing-schema", message: "the schema fragment is missing" },
    ]);
  });

  it("still produces a field when the input description is not an object", () => {
    const plan = resolveFormPlan({ inputs: { broken: "nonsense" } });

    expect(plan.fields[0]).toEqual({
      id: "broken",
      title: "broken",
      required: false,
      control: {
        kind: "json",
        reason: "the input description is not an object",
        schema: "nonsense",
      },
    });
    expect(plan.diagnostics[0]?.code).toBe("malformed-description");
  });

  it("reports a description that is not an object at all", () => {
    const plan = resolveFormPlan("not a process description");
    expect(plan.fields).toEqual([]);
    expect(plan.diagnostics).toEqual([
      {
        code: "malformed-description",
        message: "the process description is not an object",
      },
    ]);
  });

  it("accepts a process with no inputs, and reports inputs of the wrong shape", () => {
    expect(resolveFormPlan({ id: "noop" })).toEqual({
      processId: "noop",
      fields: [],
      diagnostics: [],
    });
    expect(resolveFormPlan({ inputs: [] }).diagnostics[0]?.code).toBe("malformed-description");
  });

  it("stops descending a self-referential schema", () => {
    const recursive: Record<string, unknown> = { type: "array" };
    recursive["items"] = recursive;

    const plan = resolveFormPlan({ inputs: { deep: { schema: recursive } } });
    expect(plan.diagnostics.at(-1)?.message).toMatch(/nests deeper/);
  });

  it("names the input on every diagnostic", () => {
    const plan = resolveFormPlan({
      inputs: {
        ok: { schema: { type: "string" } },
        bad: { schema: { oneOf: [] } },
      },
    });
    expect(plan.diagnostics.map((d) => d.inputId)).toEqual(["bad"]);
  });
});
