/**
 * The OGC job status vocabulary: the check that narrows, the reader that
 * forgives a server's capitalisation, and the parsers that use the reader.
 */

import { describe, expect, it } from "vitest";
import { isJobDocument } from "../../src/execution/classify-execution.js";
import { parseJobStatus } from "../../src/jobs/parse-status.js";
import { isJobState, toJobState, type JobState } from "../../src/vocabulary/job-status.js";

const VOCABULARY: readonly JobState[] = [
  "accepted",
  "running",
  "successful",
  "failed",
  "dismissed",
];

describe("isJobState", () => {
  it("accepts each value of the vocabulary as it is spelled", () => {
    for (const state of VOCABULARY) expect(isJobState(state)).toBe(true);
    expect(isJobState("done")).toBe(false);
  });

  it("narrows only to a JobState the string really is (C12)", () => {
    // It accepted "Successful" and told the compiler it was "successful".
    for (const raw of ["Successful", "RUNNING", "Failed"]) {
      if (isJobState(raw)) expect(VOCABULARY).toContain(raw);
      expect(isJobState(raw)).toBe(false);
    }
  });
});

describe("toJobState", () => {
  it("reads a status in any case as the vocabulary spells it", () => {
    expect(toJobState("Successful")).toBe("successful");
    expect(toJobState("RUNNING")).toBe("running");
    expect(toJobState("dismissed")).toBe("dismissed");
  });

  it("is undefined for a word outside the vocabulary", () => {
    expect(toJobState("done")).toBeUndefined();
    expect(toJobState("")).toBeUndefined();
  });
});

describe("a server that capitalises its status", () => {
  it("is still read as the status it names, its own spelling kept", () => {
    const status = parseJobStatus(
      { jobID: "j1", status: "Successful" },
      { documentUrl: "https://service.test/jobs/j1" },
    );
    expect(status).toMatchObject({
      status: "successful",
      rawStatus: "Successful",
      statusRecognised: true,
      terminal: true,
    });
    expect(status.warnings).not.toContain("unrecognised-status");
  });

  it("is still a job document to the execution classifier", () => {
    expect(isJobDocument({ jobID: "j1", status: "Running" })).toBe(true);
    expect(isJobDocument({ jobID: "j1", status: "done" })).toBe(false);
  });
});
