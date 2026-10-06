/**
 * `withDeadline`, and the two calls built on it, with deadlines a timer cannot
 * hold (review C3). Real timers on purpose: the bug was in what a real timer
 * does with a delay above 2^31 − 1 ms, which is to fire at once.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { execute } from "../../src/execution/execute.js";
import { withDeadline } from "../../src/http/deadline.js";
import { pollJob } from "../../src/jobs/poll-job.js";
import { settleWithin } from "./stalled-body.js";

/** Answers after 30 ms, and rejects like fetch does if its signal fires first. */
function slowFetch(answer: () => Response) {
  return (_url: string, init: RequestInit = {}): Promise<Response> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        resolve(answer());
      }, 30);
      init.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("This operation was aborted", "AbortError"));
      });
    });
}

const json = (body: unknown): Response => Response.json(body);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("withDeadline", () => {
  it("arms no timer for timeoutMs: Infinity, which means no deadline", () => {
    const armed = vi.spyOn(globalThis, "setTimeout");
    const deadline = withDeadline(undefined, Number.POSITIVE_INFINITY);
    expect(armed).not.toHaveBeenCalled();
    expect(deadline.signal.aborted).toBe(false);
    deadline.dispose();
  });

  it("holds a deadline longer than a timer can to the longest one it can", () => {
    const armed = vi.spyOn(globalThis, "setTimeout");
    withDeadline(undefined, 2 ** 32).dispose();
    expect(armed).toHaveBeenCalledWith(expect.any(Function), 2_147_483_647);
  });

  it("still ends on the caller's signal when it arms no timer", () => {
    const controller = new AbortController();
    const deadline = withDeadline(controller.signal, Number.POSITIVE_INFINITY);
    controller.abort();
    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.timedOut()).toBe(false);
  });
});

describe("calls with a deadline a timer cannot hold", () => {
  // 2^32, not 2^31: pollJob subtracts the milliseconds already spent, and
  // 2^31 − 1 is exactly the longest delay a timer holds.
  for (const timeoutMs of [2 ** 32, Number.POSITIVE_INFINITY]) {
    it(`pollJob with timeoutMs ${String(timeoutMs)} polls the job to its end`, async () => {
      const fetch = slowFetch(() => json({ jobID: "j1", status: "successful" }));
      const outcome = await settleWithin(
        pollJob("https://service.test/jobs/j1", { timeoutMs, fetch }),
        1_500,
      );
      expect(outcome).toMatchObject({ outcome: "terminal" });
    });

    it(`execute with timeoutMs ${String(timeoutMs)} returns the result`, async () => {
      const fetch = slowFetch(() => json({ id: "echo", value: "hi" }));
      const outcome = await settleWithin(
        execute("https://service.test/processes", "echo", { inputs: {}, timeoutMs, fetch }),
        1_500,
      );
      expect(outcome).toMatchObject({ kind: "immediate" });
    });
  }
});
