import { describe, expect, it } from "vitest";
import { executionUrlFor } from "../../src/execution/build-request.js";
import { jobUrlFor } from "../../src/jobs/job-url.js";
import { processUrlFor } from "../../src/processes/get-process.js";

const JOBS = "https://service.test/oapi/jobs";
const PROCESSES = "https://service.test/oapi/processes";

describe("a server-chosen id of . or ..", () => {
  // A URL reads either as a step, `%2e` spellings included, so no request can
  // name the resource. Refused, rather than sent to the list or its parent.
  it.each([".", ".."])("is refused rather than resolved as a path step: %s", (id) => {
    expect(() => jobUrlFor(JOBS, id)).toThrow(TypeError);
    expect(() => processUrlFor(PROCESSES, id)).toThrow(TypeError);
    expect(() => executionUrlFor(PROCESSES, id)).toThrow(TypeError);
  });

  it("leaves every other id as encodeURIComponent has it", () => {
    expect(jobUrlFor(JOBS, "a.b")).toBe(`${JOBS}/a.b`);
    expect(jobUrlFor(JOBS, "...")).toBe(`${JOBS}/...`);
    expect(jobUrlFor(JOBS, "a/b")).toBe(`${JOBS}/a%2Fb`);
    expect(executionUrlFor(PROCESSES, "OTB.BandMath")).toBe(`${PROCESSES}/OTB.BandMath/execution`);
  });
});
