/**
 * Review: a wait that can end before the job does.
 */

import { describe, expect, it } from "vitest";
import { waitForJob } from "../../src/jobs/poll-job.js";

const HUNG = Symbol("hung");

async function settleWithin<T>(promise: Promise<T>, ms: number): Promise<T | typeof HUNG | Error> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hung = new Promise<typeof HUNG>((resolve) => {
    timer = setTimeout(() => {
      resolve(HUNG);
    }, ms);
  });
  try {
    return await Promise.race([promise.catch((error: unknown) => error as Error), hung]);
  } finally {
    clearTimeout(timer);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("waitForJob promises a final status", () => {
  it.fails(
    "C5: does not resolve with a non-terminal status when the job 404s mid-poll",
    async () => {
      let calls = 0;
      const fetch = (): Promise<Response> => {
        calls += 1;
        return Promise.resolve(
          calls === 1 ? json({ jobID: "j1", status: "running" }) : json({ title: "gone" }, 404),
        );
      };

      const outcome = await settleWithin(
        waitForJob("https://service.test/jobs/j1", { fetch, intervalMs: 500 }),
        3_000,
      );

      // Its own doc: "this function promises a final status, and a `running` one is not."
      if (outcome instanceof Error || outcome === HUNG) return;
      expect(outcome.terminal).toBe(true);
    },
  );
});
