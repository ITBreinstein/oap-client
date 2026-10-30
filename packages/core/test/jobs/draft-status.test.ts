/**
 * The 2.0 draft's status document: `id` and `processingEntityType` where 1.0
 * has `jobID` and `type`, and a handful of optional members. Read whatever the
 * version, because a status is classified by what arrives.
 */

import { describe, expect, it } from "vitest";
import { parseJobStatus } from "../../src/jobs/parse-status.js";
import { isJobDocument } from "../../src/execution/classify-execution.js";

const URL_OF = "http://localhost:5100/processes/EchoProcess/jobs/e48ac36d";

/**
 * Weaver, captured 2026-10-23 as `weaver/jobs/status-every-output.http`, with
 * its links cut to two. Both versions' members side by side, under a
 * `$schema` naming 1.0's `statusInfo.yaml`.
 */
const WEAVER = {
  $schema: "https://schemas.opengis.net/ogcapi/processes/part1/1.0/openapi/schemas/statusInfo.yaml",
  id: "e48ac36d-90e1-4cf9-ab4e-b56cadc081d9",
  jobID: "e48ac36d-90e1-4cf9-ab4e-b56cadc081d9",
  processID: "EchoProcess",
  providerID: null,
  processingEntityType: "ogc-api-processes",
  type: "process",
  status: "successful",
  message: "Job successful.",
  created: "2026-10-23T10:43:18.016000+00:00",
  started: "2026-10-23T10:43:18.877000+00:00",
  finished: "2026-10-23T10:43:21.621000+00:00",
  updated: "2026-10-23T10:43:21.621000+00:00",
  duration: "00:00:02",
  runningDuration: "PT03S",
  runningSeconds: 2.744,
  percentCompleted: 100,
  progress: 100,
  links: [
    {
      title: "Job monitoring location.",
      href: "http://localhost:5100/processes/EchoProcess/jobs/e48ac36d-90e1-4cf9-ab4e-b56cadc081d9",
      type: "application/json",
      rel: "monitor",
    },
  ],
};

/** The draft's own minimum: `id`, `status`, `processingEntityType`, and nothing of 1.0's. */
const DRAFT_MINIMUM = {
  id: "j-1",
  status: "running",
  processingEntityType: "ogc-api-processes",
};

describe("a 2.0 draft status document", () => {
  it("reads Weaver's, with both entity-type members as sent", () => {
    const status = parseJobStatus(WEAVER, { documentUrl: URL_OF });
    expect(status.status).toBe("successful");
    expect(status.jobId).toBe("e48ac36d-90e1-4cf9-ab4e-b56cadc081d9");
    expect(status.type).toBe("process");
    expect(status.processingEntityType).toBe("ogc-api-processes");
    expect(status.terminal).toBe(true);
  });

  it("records only the members neither version defines", () => {
    const status = parseJobStatus(WEAVER, { documentUrl: URL_OF });
    expect([...status.unrecognisedKeys].sort()).toEqual(
      ["$schema", "duration", "providerID", "runningDuration", "runningSeconds"].sort(),
    );
  });

  it("reads the draft's minimum, with `id` as the job id and no 1.0 member at all", () => {
    const status = parseJobStatus(DRAFT_MINIMUM, { documentUrl: URL_OF });
    expect(status.jobId).toBe("j-1");
    expect(status.processingEntityType).toBe("ogc-api-processes");
    expect(status.type).toBeUndefined();
    expect(status.unrecognisedKeys).toEqual([]);
  });

  it("does not record the draft's optional members as unrecognised", () => {
    const status = parseJobStatus(
      {
        ...DRAFT_MINIMUM,
        profileEntityType: "x",
        request: { inputs: {} },
        title: "t",
        description: "d",
        keywords: ["k"],
        metadata: [],
      },
      { documentUrl: URL_OF },
    );
    expect(status.unrecognisedKeys).toEqual([]);
  });

  it("is a job document to the execution classifier, as 1.0's is", () => {
    expect(isJobDocument(DRAFT_MINIMUM)).toBe(true);
    expect(isJobDocument(WEAVER)).toBe(true);
  });
});
