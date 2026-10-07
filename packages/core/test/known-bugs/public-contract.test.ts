/**
 * Review: exported types and documented behaviour that the code does not keep.
 */

import { describe, expect, it } from "vitest";
import { execute, getJob, isJobState, type Execution, type JobState } from "../../src/index.js";

/** An execute's outcome, or what it threw, as one value to assert on. */
function settle(promise: Promise<Execution>): Promise<Execution | Error> {
  return promise.catch((error: unknown) =>
    error instanceof Error ? error : new Error(String(error)),
  );
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("isJobState() narrows to a lowercase literal it did not check", () => {
  it.fails("C12: a value it accepts is one of the JobState literals", () => {
    const raw = "Successful";
    const vocabulary: readonly JobState[] = [
      "accepted",
      "running",
      "successful",
      "failed",
      "dismissed",
    ];
    if (isJobState(raw)) {
      // TypeScript now believes `raw` is JobState.
      expect(vocabulary).toContain(raw);
    }
  });
});

describe("JobHandle.statusUrl is documented as absolute", () => {
  it.fails("C13: is absolute even when Location cannot be resolved", async () => {
    const fetch = (): Promise<Response> =>
      Promise.resolve(json(null, 201, { Location: "http://bad host/jobs/1" }));
    const execution = await execute("https://service.test/processes", "p", {
      inputs: {},
      mode: "async",
      fetch,
    });
    expect(execution.kind).toBe("job");
    if (execution.kind !== "job") return;
    expect(() => new URL(execution.job.statusUrl)).not.toThrow();
  });

  it.fails(
    "C13: an empty Location does not become a handle pointing at the execute endpoint",
    async () => {
      const fetch = (): Promise<Response> => Promise.resolve(json(null, 201, { Location: "" }));
      const outcome = await settle(
        execute("https://service.test/processes", "p", { inputs: {}, mode: "async", fetch }),
      );
      // Either an AmbiguousExecutionResponseError or a real job URL; not the POST target.
      if (outcome instanceof Error) return;
      expect(outcome.kind === "job" ? outcome.job.statusUrl : "").not.toBe(
        "https://service.test/processes/p/execution",
      );
    },
  );
});

describe("JobStatus.exception", () => {
  it.fails(
    "C14: is populated when the job body itself is problem-shaped, as its doc comment says",
    async () => {
      // jobs/types.ts: "Populated when a server sends an `exception` member that
      // reads as a problem document, or when the job body itself is problem-shaped."
      const body = {
        jobID: "j1",
        status: "failed",
        type: "https://example.org/errors/boom",
        title: "Boom",
        detail: "it broke",
      };
      const status = await getJob("https://service.test/jobs/j1", {
        fetch: () => Promise.resolve(json(body)),
      });
      expect(status.exception?.detail).toBe("it broke");
    },
  );
});
