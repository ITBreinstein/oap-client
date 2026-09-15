import { describe, expect, it } from "vitest";
import {
  DEFAULT_RUN_SETTINGS,
  buildExecutePlan,
  requestedOutputs,
} from "../../src/execution/build-execute-options.js";
import { capturedDescription } from "./captured-forms.js";

describe("the outputs member", () => {
  it("asks for every declared output, with no preference", () => {
    const description = capturedDescription("zoo-inline-csv");
    expect(requestedOutputs(description)).toEqual({ RESULT: {} });
  });

  it("is present on the plan, because ZOO refuses a body without one", () => {
    // 400 InvalidParameterValue, "cannot parse your POST data", for a body
    // carrying only `inputs`.
    const description = capturedDescription("zoo-inline-csv");
    const { options } = buildExecutePlan(description, { FIELDS_ALL: true });
    expect(options.outputs).toEqual({ RESULT: {} });
  });

  it("is left out entirely when a process declares no outputs", () => {
    const description = { ...capturedDescription("zoo-inline-csv"), outputs: [] };
    expect(buildExecutePlan(description, {}).options).not.toHaveProperty("outputs");
  });
});

describe("the rest of the body", () => {
  it("asks for a document response by default", () => {
    expect(DEFAULT_RUN_SETTINGS.response).toBe("document");
    const description = capturedDescription("bgt-numeric-ranges");
    expect(buildExecutePlan(description, { latitude: 52.6 }).options.response).toBe("document");
  });

  it("carries the description, so the advertised execute link wins", () => {
    const description = capturedDescription("bgt-numeric-ranges");
    expect(buildExecutePlan(description, {}).options.description).toBe(description);
  });
});

describe("warnings", () => {
  it("reports a missing required input without refusing to send", () => {
    const description = capturedDescription("bgt-numeric-ranges");
    const plan = buildExecutePlan(description, { latitude: 52.6 });

    expect(plan.warnings.join(" ")).toContain('missing required input "longitude"');
    expect(plan.options.inputs).toEqual({ latitude: 52.6 });
  });

  it("says nothing when the form satisfies the description", () => {
    const description = capturedDescription("bgt-numeric-ranges");
    const plan = buildExecutePlan(description, { latitude: 52.6, longitude: 4.75 });
    expect(plan.warnings).toEqual([]);
  });
});
