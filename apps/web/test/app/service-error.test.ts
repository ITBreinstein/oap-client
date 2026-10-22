/**
 * #23: a failure is the service's, and the inputs are blamed only when the
 * service's own words name one, by the label the form shows.
 */

import { describe, expect, it } from "vitest";
import { namedInput, serviceError, serviceErrorTitle } from "../../src/app/run.js";
import type { FieldPlan, FormPlan } from "../../src/forms/plan.js";
import { withoutExceptionCode } from "../../src/jobs/job-message.js";

function field(id: string, title: string): FieldPlan {
  return { id, title, required: true, control: { kind: "text" } } as unknown as FieldPlan;
}

const plan = {
  fields: [field("area", "Area"), field("moment", "Moment"), field("a.b", "Dotted")],
} as unknown as FormPlan;

describe("serviceErrorTitle", () => {
  it("says the service reported an error, and nothing about the inputs", () => {
    expect(serviceErrorTitle(undefined)).toBe("The service reported an error.");
  });

  it("names the input to check by its label", () => {
    expect(serviceErrorTitle("Area")).toBe(
      "The service reported an error. Check the input “Area” and run again.",
    );
  });
});

describe("namedInput", () => {
  it("finds an input named in double quotes, single quotes, backticks or angle brackets", () => {
    for (const words of [
      'The "area" input is 3738 m across',
      "The 'area' input is too big",
      "The `area` input is too big",
      "The <area> input is too big",
    ]) {
      expect(namedInput(words, plan)?.id).toBe("area");
    }
  });

  it("does not take a word in the text for an input", () => {
    expect(namedInput("The area is too big", plan)).toBeUndefined();
    expect(namedInput("Failed on purpose, after running for a while.", plan)).toBeUndefined();
    expect(namedInput(undefined, plan)).toBeUndefined();
  });

  it("matches an id literally, not as a pattern", () => {
    expect(namedInput('"axb" is wrong', plan)).toBeUndefined();
    expect(namedInput('"a.b" is wrong', plan)?.id).toBe("a.b");
  });
});

describe("serviceError", () => {
  it("keeps the service's own words as the detail", () => {
    expect(serviceError("Error executing process: Failed on purpose", plan)).toEqual({
      title: "The service reported an error.",
      detail: "Error executing process: Failed on purpose",
      inputId: undefined,
    });
  });

  it("names the input by its label, and keeps its id for the form", () => {
    expect(serviceError('The "moment" input is not a date-time', plan)).toEqual({
      title: "The service reported an error. Check the input “Moment” and run again.",
      detail: 'The "moment" input is not a date-time',
      inputId: "moment",
    });
  });

  it("has no detail when the service gave no words", () => {
    expect(serviceError(undefined, plan)).toEqual({
      title: "The service reported an error.",
      detail: undefined,
      inputId: undefined,
    });
  });
});

describe("withoutExceptionCode", () => {
  it("drops a leading OGC exception code", () => {
    expect(withoutExceptionCode("InvalidParameterValue: The area is too big")).toBe(
      "The area is too big",
    );
    expect(withoutExceptionCode("NoApplicableCode: Failed on purpose")).toBe("Failed on purpose");
  });

  it("leaves a single word before a colon, and a code later in the text", () => {
    expect(withoutExceptionCode("Error: out of memory")).toBe("Error: out of memory");
    expect(withoutExceptionCode("Note: slow today")).toBe("Note: slow today");
    expect(withoutExceptionCode("Failed: InvalidParameterValue: x")).toBe(
      "Failed: InvalidParameterValue: x",
    );
  });

  it("leaves a message that would be nothing without its code", () => {
    expect(withoutExceptionCode("InvalidParameterValue: ")).toBe("InvalidParameterValue: ");
  });

  it("leaves a message without a code as it is", () => {
    expect(withoutExceptionCode("Job accepted and ready for execution")).toBe(
      "Job accepted and ready for execution",
    );
  });
});
