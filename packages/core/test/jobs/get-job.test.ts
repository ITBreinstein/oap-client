/**
 * `getJob()` and the job-document parser.
 *
 * Reduction tests this file backs:
 *  1. `getJob()` calling `requireOk()` instead of `classify()` → the two
 *     failed-job tests go red. *(T1)*
 *  2. treating an unrecognised status as fatal → the degradation test goes red.
 *
 * Every shape here is either captured from a live server on 2026-09-16 or
 * hand-built to pin a case neither server produces. The difference is stated
 * per test, because a hand-built shape is a claim about what *could* arrive and
 * a captured one is a claim about what *does*.
 */

import { describe, expect, it } from "vitest";
import { getJob } from "../../src/jobs/get-job.js";
import { parseJobStatus } from "../../src/jobs/parse-status.js";
import { JobNotFoundError, MalformedJobDocumentError } from "../../src/errors.js";
import { ProcessesError } from "../../src/http/errors.js";
import type { Observation } from "../../src/observations.js";

const JOB_URL = "https://service.test/oapi/jobs/7e2fca0a-b1ab-11f1-9c9d-5af372e9265a";

function fakeFetch(response: Response): (url: string, init?: RequestInit) => Promise<Response> {
  return () => Promise.resolve(response.clone());
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function collect(): { sink: (o: Observation) => void; seen: Observation[] } {
  const seen: Observation[] = [];
  return { sink: (o) => seen.push(o), seen };
}

function statusRecord(seen: Observation[]): Extract<Observation, { kind: "job-status" }> {
  const found = seen.find((entry) => entry.kind === "job-status");
  if (found === undefined) throw new Error("no job-status observation was recorded");
  return found;
}

/**
 * pygeoapi 0.21.0, captured 2026-09-16 from `slow-accepted.http`.
 *
 * Note the status: pygeoapi reports `accepted` for the *whole* of a job's
 * execution and never `running` (finding 0032). The fixture is the evidence,
 * and this test is why nothing downstream may treat `running` as the signal
 * that work has begun.
 */
const PYGEOAPI_RUNNING = {
  type: "process",
  processID: "slow",
  jobID: "7e2fca0a-b1ab-11f1-9c9d-5af372e9265a",
  status: "accepted",
  message: "Job accepted and ready for execution",
  progress: 5,
  parameters: null,
  created: "2026-09-16T08:49:13.978534Z",
  started: "2026-09-16T08:49:13.978641Z",
  finished: null,
  updated: "2026-09-16T08:49:13.978657Z",
  links: [
    {
      href: "https://service.test/oapi/jobs/7e2fca0a-b1ab-11f1-9c9d-5af372e9265a/results?f=json",
      rel: "http://www.opengis.net/def/rel/ogc/1.0/results",
      type: "application/json",
      title: "Results of job as JSON",
    },
  ],
};

/** ZOO fork 46289f6, captured 2026-09-16 from `longprocess-running.http`. */
const ZOO_RUNNING = {
  progress: 40,
  id: "e11ee0be-b1ac-11f1-9647-862eff345597",
  jobID: "e11ee0be-b1ac-11f1-9647-862eff345597",
  type: "process",
  processID: "longProcess",
  created: "2026-09-16T08:59:09.521Z",
  started: "2026-09-16T08:59:09.521Z",
  updated: "2026-09-16T08:59:17.900Z",
  status: "running",
  message: "Step 40",
  links: [
    {
      title: "Status location",
      rel: "monitor",
      type: "application/json",
      href: "https://service.test/oapi/jobs/e11ee0be-b1ac-11f1-9647-862eff345597",
    },
  ],
};

/** pygeoapi 0.21.0, captured 2026-09-16 from `slow-failed.http`. */
const PYGEOAPI_FAILED = {
  type: "process",
  processID: "slow",
  jobID: "b6434016-b1ab-11f1-bcb1-5af372e9265a",
  status: "failed",
  message:
    'InvalidParameterValue: Error executing process: The "seconds" input must not be negative',
  progress: 5,
  parameters: null,
  created: "2026-09-16T08:50:48.067966Z",
  started: "2026-09-16T08:50:48.068275Z",
  finished: "2026-09-16T08:50:48.075730Z",
  updated: "2026-09-16T08:50:48.075806Z",
};

describe("parsing a job document", () => {
  it("parses a non-terminal job and does not call it terminal", () => {
    const status = parseJobStatus(PYGEOAPI_RUNNING, { documentUrl: JOB_URL });

    expect(status.status).toBe("accepted");
    expect(status.rawStatus).toBe("accepted");
    expect(status.statusRecognised).toBe(true);
    expect(status.terminal).toBe(false);
    expect(status.jobId).toBe("7e2fca0a-b1ab-11f1-9c9d-5af372e9265a");
    expect(status.processId).toBe("slow");
    expect(status.progress).toBe(5);
    // `finished: null` is not a timestamp, and must not become the string "null".
    expect(status.finished).toBeUndefined();
    // pygeoapi's vendor member survives by name, never by value.
    expect(status.unrecognisedKeys).toContain("parameters");
  });

  it("parses ZOO's running document, which carries both `id` and `jobID`", () => {
    const status = parseJobStatus(ZOO_RUNNING, { documentUrl: JOB_URL });

    expect(status.status).toBe("running");
    expect(status.terminal).toBe(false);
    expect(status.progress).toBe(40);
    // `jobID` wins over `id`; both are present and equal here, so the test is
    // about the precedence rather than the value.
    expect(status.jobId).toBe("e11ee0be-b1ac-11f1-9647-862eff345597");
  });

  it("parses a successful job and calls it terminal", () => {
    const status = parseJobStatus(
      {
        ...PYGEOAPI_RUNNING,
        status: "successful",
        progress: 100,
        finished: "2026-09-16T08:49:34Z",
      },
      { documentUrl: JOB_URL },
    );

    expect(status.status).toBe("successful");
    expect(status.terminal).toBe(true);
    expect(status.finished).toBe("2026-09-16T08:49:34Z");
  });

  it("degrades an unrecognised status instead of throwing", () => {
    // Neither reference server produces this. It is the shape that decides
    // whether a server inventing a status word costs us the whole job or just
    // a warning — see T6 of the report.
    const status = parseJobStatus(
      { ...PYGEOAPI_RUNNING, status: "paused" },
      {
        documentUrl: JOB_URL,
      },
    );

    expect(status.rawStatus).toBe("paused");
    expect(status.statusRecognised).toBe(false);
    expect(status.warnings).toContain("unrecognised-status");
    // The load-bearing half: unknown reads as non-terminal, so a poll loop
    // keeps going under its own cap rather than declaring the job finished.
    expect(status.terminal).toBe(false);
  });

  it("is fatal when `status` is missing, and the error names the job", () => {
    const withoutStatus: Record<string, unknown> = { ...PYGEOAPI_RUNNING };
    delete withoutStatus["status"];

    expect(() => parseJobStatus(withoutStatus, { documentUrl: JOB_URL })).toThrow(
      MalformedJobDocumentError,
    );
    try {
      parseJobStatus(withoutStatus, { documentUrl: JOB_URL });
      expect.unreachable();
    } catch (error) {
      if (!(error instanceof MalformedJobDocumentError)) throw error;
      expect(error.reason).toContain("no `status` member");
      expect(error.where).toContain("7e2fca0a-b1ab-11f1-9c9d-5af372e9265a");
    }
  });

  it("is fatal when the body is not an object", () => {
    expect(() => parseJobStatus([1, 2], { documentUrl: JOB_URL })).toThrow(
      MalformedJobDocumentError,
    );
  });

  it("clamps an out-of-range progress rather than dropping it", () => {
    const status = parseJobStatus(
      { ...PYGEOAPI_RUNNING, progress: 120 },
      {
        documentUrl: JOB_URL,
      },
    );

    expect(status.progress).toBe(100);
    expect(status.warnings).toContain("progress-out-of-range");
  });

  it("reads `percentCompleted` when that is what the server sent", () => {
    const noProgress: Record<string, unknown> = { ...PYGEOAPI_RUNNING, percentCompleted: 42 };
    delete noProgress["progress"];
    const status = parseJobStatus(noProgress, { documentUrl: JOB_URL });

    expect(status.progress).toBe(42);
  });
});

describe("getJob()", () => {
  it("returns a JobStatus for a failed job and does NOT throw — T1", async () => {
    // The reduction test: swap `classify()` for `requireOk()` in get-job.ts and
    // this goes red. A failed job is a successful operation.
    const status = await getJob(JOB_URL, { fetch: fakeFetch(json(PYGEOAPI_FAILED)) });

    expect(status.status).toBe("failed");
    expect(status.terminal).toBe(true);
    // The server's own words survive. On both reference servers the failure is
    // prose in `message` and there is no `exception` member at all (0034).
    expect(status.message).toContain("must not be negative");
    expect(status.exception).toBeUndefined();
  });

  it("returns a JobStatus for a failed job served as application/problem+json — T1", async () => {
    // The second half of the T1 guarantee, and the one with teeth.
    //
    // A plain pygeoapi failed job is a 200 whose body does *not* read as a
    // problem document, so `classify()` and `requireOk()` agree on it and no
    // test can tell them apart from that input alone. The distinction only
    // bites when the body *does* read as a problem document — which is exactly
    // what a server serialising a failed job through its error path produces.
    //
    // A declared `application/problem+json` is accepted by `looksLikeProblem()`
    // unconditionally, so `requireOk()` would throw here and the job document
    // would be lost. Neither reference server does this today; the point is
    // that the guarantee does not depend on their not doing it.
    const body = {
      type: "about:blank",
      title: "Job failed",
      status: "failed",
      jobID: "problem-typed",
      message: "the process raised",
    };
    const status = await getJob(JOB_URL, {
      fetch: fakeFetch(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/problem+json" },
        }),
      ),
    });

    expect(status.status).toBe("failed");
    expect(status.jobId).toBe("problem-typed");
    expect(status.message).toBe("the process raised");
  });

  it("returns a JobStatus even when the failed body trips the problem heuristic — T1", async () => {
    // Neither reference server produces this today: pygeoapi's failed body
    // carries `type: "process"` and ZOO's carries no `type`, so neither trips
    // `problem.ts`'s test. That is luck, not design, and this pins the
    // behaviour if a third server is less lucky.
    //
    // `type` is URI-shaped, which `looksLikeProblem()` accepts at any status,
    // so `classify()` calls this an `exception` at 200 — and `getJob()` must
    // still hand back a JobStatus rather than throwing the job away.
    const body = {
      type: "https://example.test/errors/process-failed",
      title: "The process failed",
      status: "failed",
      jobID: "problem-shaped",
      message: "it went wrong",
    };
    const { sink, seen } = collect();

    const status = await getJob(JOB_URL, { fetch: fakeFetch(json(body)), onObservation: sink });

    expect(status.status).toBe("failed");
    expect(status.jobId).toBe("problem-shaped");
    // Recorded rather than smoothed over: if this ever fires against a real
    // server, the shared heuristic in `problem.ts` is the thing to revisit.
    expect(statusRecord(seen).classifiedAsException).toBe(true);
  });

  it("raises JobNotFoundError on a 404 — the normal state of a dismissed job", async () => {
    // pygeoapi's own 404 body, captured 2026-09-16 from
    // `slow-after-dismiss-404.http`. Note it says `InvalidParameterValue` on a
    // GET while a second DELETE says `NoSuchJob` — the server disagreeing with
    // itself about the same condition, recorded in finding 0035.
    const body = {
      code: "InvalidParameterValue",
      type: "InvalidParameterValue",
      description: "7e2fca0a-b1ab-11f1-9c9d-5af372e9265a",
    };

    await expect(getJob(JOB_URL, { fetch: fakeFetch(json(body, 404)) })).rejects.toBeInstanceOf(
      JobNotFoundError,
    );
  });

  it("raises ProcessesError on a 500 — a broken service is not a job outcome", async () => {
    await expect(
      getJob(JOB_URL, { fetch: fakeFetch(json({ error: "boom" }, 500)) }),
    ).rejects.toBeInstanceOf(ProcessesError);
  });

  it("asks for JSON explicitly, because pygeoapi negotiates this endpoint to HTML", async () => {
    let seenAccept: string | undefined;
    const status = await getJob(JOB_URL, {
      fetch: (_url: string, init: RequestInit = {}) => {
        seenAccept = new Headers(init.headers).get("Accept") ?? undefined;
        return Promise.resolve(json(PYGEOAPI_RUNNING));
      },
    });

    expect(status.status).toBe("accepted");
    expect(seenAccept).toBe("application/json");
  });

  it("records the status observation without leaking the body", async () => {
    const { sink, seen } = collect();
    await getJob(JOB_URL, { fetch: fakeFetch(json(PYGEOAPI_FAILED)), onObservation: sink });

    const record = statusRecord(seen);
    expect(record.httpStatus).toBe(200);
    expect(record.status).toBe("failed");
    expect(record.terminal).toBe(true);
    expect(record.retryAfterPresent).toBe(false);
    expect(record.exceptionPresent).toBe(false);
    // Names only, never values.
    expect(record.unrecognisedKeys).toContain("parameters");
    expect(JSON.stringify(record)).not.toContain("must not be negative");
  });
});
