/**
 * #10: each process's form is kept for the visit, by service and process, and
 * comes back as it was left. An untouched form is nothing to keep.
 */

import { describe, expect, it } from "vitest";
import {
  formKey,
  isUntouched,
  remember,
  restoredValues,
  type FormMemory,
} from "../../src/app/form-memory.js";
import { workflowReducer, type Workflow } from "../../src/app/workflow.js";
import { initialValues } from "../../src/forms/defaults.js";
import { resolveFormPlan } from "../../src/forms/resolve.js";
import { fixtureProcess } from "../forms/helpers.js";

const plan = resolveFormPlan(fixtureProcess("pygeoapi/breinstein-inputs"));
const initial = initialValues(plan);

describe("formKey", () => {
  it("is the same for an address with or without a trailing slash", () => {
    expect(formKey("http://localhost:5080/", "slow")).toBe(
      formKey("http://localhost:5080", "slow"),
    );
  });

  it("tells services and processes apart", () => {
    expect(formKey("http://localhost:5080", "slow")).not.toBe(
      formKey("http://localhost:5081", "slow"),
    );
    expect(formKey("http://localhost:5080", "slow")).not.toBe(
      formKey("http://localhost:5080", "hello-world"),
    );
  });
});

describe("isUntouched", () => {
  it("is true for the starting values, defaults included", () => {
    expect(isUntouched(initial, initialValues(plan))).toBe(true);
  });

  it("is false once a value is typed, chosen or drawn", () => {
    expect(isUntouched({ ...initial, label: "Barcelona" }, initial)).toBe(false);
    expect(isUntouched({ ...initial, enabled: true }, initial)).toBe(false);
    expect(
      isUntouched({ ...initial, area: { type: "Point", coordinates: [2.17, 41.39] } }, initial),
    ).toBe(false);
  });

  it("compares lists and objects by what they hold", () => {
    expect(isUntouched({ ...initial, tags: [""] }, { ...initial, tags: [""] })).toBe(true);
    expect(isUntouched({ ...initial, tags: ["a"] }, { ...initial, tags: [""] })).toBe(false);
  });
});

describe("remember", () => {
  const key = formKey("http://localhost:5080", "breinstein-inputs");

  it("keeps a touched form", () => {
    const filled = { ...initial, label: "Barcelona", count: "4" };
    expect(remember(new Map(), key, filled, initial).get(key)).toEqual(filled);
  });

  it("forgets a form put back as it started: cleared, or never touched", () => {
    const memory: FormMemory = new Map([[key, { ...initial, label: "Barcelona" }]]);
    expect(remember(memory, key, initial, initial).has(key)).toBe(false);
  });

  it("leaves the other forms as they are, and the memory it was given", () => {
    const other = formKey("http://localhost:5080", "slow");
    const memory: FormMemory = new Map([[other, { seconds: "20" }]]);
    const next = remember(memory, key, { ...initial, label: "x" }, initial);
    expect(next.get(other)).toEqual({ seconds: "20" });
    expect(memory.has(key)).toBe(false);
  });
});

describe("restoredValues", () => {
  it("is the starting values when nothing was kept", () => {
    expect(restoredValues(plan, initial, undefined)).toBe(initial);
  });

  it("brings back what was kept, over the starting values", () => {
    const kept = { ...initial, label: "Barcelona", notes: "Two lines\nof notes", count: "4" };
    expect(restoredValues(plan, initial, kept)).toEqual(kept);
  });

  it("keeps only inputs the description has", () => {
    const restored = restoredValues(plan, initial, { label: "Barcelona", gone: "x" });
    expect(restored).not.toHaveProperty("gone");
    expect(restored["label"]).toBe("Barcelona");
    expect(restored["ratio"]).toEqual(initial["ratio"]);
  });
});

describe("reset-form", () => {
  const open = (stage: "process" | "result"): Workflow =>
    ({
      stage,
      plan,
      values: { ...initial, label: "Barcelona" },
      error: { title: "The service reported an error." },
    }) as unknown as Workflow;

  it("puts every value back as it started, and drops the last run's error", () => {
    const next = workflowReducer(open("process"), { type: "reset-form", values: initial });
    expect(next.stage === "process" ? next.values : undefined).toBe(initial);
    expect(next.stage === "process" ? next.error : "kept").toBeUndefined();
  });

  it("does nothing but on the form", () => {
    const result = open("result");
    expect(workflowReducer(result, { type: "reset-form", values: initial })).toBe(result);
  });
});
