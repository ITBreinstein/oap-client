/**
 * The poll loop: pacing, cancellation, deadlines and progress.
 *
 * Fake timers throughout, because every one of these properties is about *when*
 * something happens and a real-time test of a 10-second backoff is a 10-second
 * test. `vi.advanceTimersByTimeAsync` drives the clock and lets the awaited
 * promises settle in between.
 *
 * Reduction tests this file backs:
 *  1. `retryAfterMs ?? default` → `retryAfterMs || default` → the
 *     `Retry-After: 0` test goes red. *(T2.3)*
 *  2. moving the abort check to before the loop only → the mid-loop abort test
 *     goes red. *(T2.1)*
 *  3. dropping the `finally` in `sleep()` → the pending-timer tests go red.
 *     *(T2.2)*
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pollJob, waitForJob } from "../../src/jobs/poll-job.js";
import { JobPollTimeoutError } from "../../src/errors.js";
import { AbortError } from "../../src/http/errors.js";
import type { JobStatus } from "../../src/jobs/types.js";
import type { Observation } from "../../src/observations.js";

const JOB_URL = "https://service.test/oapi/jobs/abc";

function jobBody(status: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ type: "process", jobID: "abc", status, ...extra });
}

/**
 * A `fetch` that answers with each scripted response in turn, repeating the
 * last one forever. Records every call so "made no further request" is
 * provable rather than assumed.
 */
function scripted(responses: readonly (() => Response)[]): {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  calls: string[];
} {
  const calls: string[] = [];
  let index = 0;
  return {
    calls,
    fetch: (url: string) => {
      calls.push(url);
      const make = responses[Math.min(index, responses.length - 1)];
      index += 1;
      if (make === undefined) throw new Error("no scripted response");
      return Promise.resolve(make());
    },
  };
}

function json(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function collect(): { sink: (o: Observation) => void; seen: Observation[] } {
  const seen: Observation[] = [];
  return { sink: (o) => seen.push(o), seen };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  // The timer assertions below depend on this: a test that leaves the clock
  // faked poisons the next one.
  vi.useRealTimers();
});

describe("pacing", () => {
  it("honours Retry-After: 2 as a 2000 ms wait", async () => {
    const fake = scripted([
      () => json(jobBody("running"), 200, { "Retry-After": "2" }),
      () => json(jobBody("successful")),
    ]);
    const promise = pollJob(JOB_URL, { fetch: fake.fetch });

    // Let the first poll resolve.
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.calls).toHaveLength(1);

    // Just short of the instruction: still one call.
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fake.calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    await promise;
    expect(fake.calls).toHaveLength(2);
  });

  it("honours Retry-After: 0 as *now*, not as the default interval — T2.3", async () => {
    // The reduction test. `retryAfterMs || default` would read 0 as falsy and
    // substitute the 1000 ms initial interval, so the second poll would not
    // have happened yet at this point on the clock.
    const fake = scripted([
      () => json(jobBody("running"), 200, { "Retry-After": "0" }),
      () => json(jobBody("successful")),
    ]);
    const promise = pollJob(JOB_URL, { fetch: fake.fetch });

    await vi.advanceTimersByTimeAsync(0);
    const report = await promise;

    expect(fake.calls).toHaveLength(2);
    expect(report.outcome).toBe("terminal");
    expect(report.retryAfterSeen).toBe(true);
    expect(report.retryAfterHonoured).toBe(true);
  });

  it("clamps an absurd Retry-After into the bounded range and records it", async () => {
    const fake = scripted([
      () => json(jobBody("running"), 200, { "Retry-After": "3600" }),
      () => json(jobBody("successful")),
    ]);
    const promise = pollJob(JOB_URL, { fetch: fake.fetch });

    await vi.advanceTimersByTimeAsync(0);
    // Clamped to the 10 s ceiling rather than waiting the full hour.
    await vi.advanceTimersByTimeAsync(10_000);
    const report = await promise;

    expect(report.clamped).toBe(true);
    expect(fake.calls).toHaveLength(2);
  });

  it("backs off when the server gives no instruction, and never below the floor", async () => {
    const fake = scripted([
      () => json(jobBody("running")),
      () => json(jobBody("running")),
      () => json(jobBody("successful")),
    ]);
    const promise = pollJob(JOB_URL, { fetch: fake.fetch, intervalMs: 1 });

    await vi.advanceTimersByTimeAsync(0);
    expect(fake.calls).toHaveLength(1);

    // `intervalMs: 1` is below MIN_POLL_INTERVAL_MS and is raised to 500.
    await vi.advanceTimersByTimeAsync(499);
    expect(fake.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fake.calls).toHaveLength(2);

    // Then it grows: 500 * 1.5 = 750.
    await vi.advanceTimersByTimeAsync(749);
    expect(fake.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    await promise;
    expect(fake.calls).toHaveLength(3);
  });
});

describe("cancellation", () => {
  it("makes no further request once aborted between polls — T2.1", async () => {
    const controller = new AbortController();
    const fake = scripted([() => json(jobBody("running"))]);
    const promise = pollJob(JOB_URL, { fetch: fake.fetch, signal: controller.signal });
    const settled = promise.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(0);
    expect(fake.calls).toHaveLength(1);

    // Aborted while the loop is asleep between polls. The reduction test moves
    // the check to before the loop only, and then this second call happens.
    controller.abort();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(await settled).toBeInstanceOf(AbortError);
    expect(fake.calls).toHaveLength(1);
  });

  it("rejects with AbortError, which is NOT a JobPollTimeoutError", async () => {
    const controller = new AbortController();
    const fake = scripted([() => json(jobBody("running"))]);
    const promise = pollJob(JOB_URL, { fetch: fake.fetch, signal: controller.signal });
    const settled = promise.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(60_000);

    const error = await settled;
    expect(error).toBeInstanceOf(AbortError);
    expect(error).not.toBeInstanceOf(JobPollTimeoutError);
  });

  it("records the aborted outcome on the observation", async () => {
    const controller = new AbortController();
    const { sink, seen } = collect();
    const fake = scripted([() => json(jobBody("running"))]);
    const settled = pollJob(JOB_URL, {
      fetch: fake.fetch,
      signal: controller.signal,
      onObservation: sink,
    }).catch(() => undefined);

    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(60_000);
    await settled;

    const polled = seen.find((entry) => entry.kind === "job-polled");
    expect(polled).toMatchObject({ outcome: "aborted", pollCount: 1 });
  });
});

describe("the total deadline", () => {
  it("raises JobPollTimeoutError carrying the last status — T2.5", async () => {
    const fake = scripted([() => json(jobBody("running", { message: "Step 40" }))]);
    const settled = pollJob(JOB_URL, {
      fetch: fake.fetch,
      timeoutMs: 5_000,
    }).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(20_000);
    const error = await settled;

    expect(error).toBeInstanceOf(JobPollTimeoutError);
    if (!(error instanceof JobPollTimeoutError)) throw error;
    expect(error.timeoutMs).toBe(5_000);
    expect(error.pollCount).toBeGreaterThan(0);
    // "Still running after N" and "never answered at all" are different
    // failures, and only the carried status can tell them apart.
    const last = error.lastStatus as JobStatus;
    expect(last.rawStatus).toBe("running");
    expect(last.message).toBe("Step 40");
  });

  it("is a different error from an abort, so the matrix can tell them apart", async () => {
    const fake = scripted([() => json(jobBody("running"))]);
    const settled = pollJob(JOB_URL, { fetch: fake.fetch, timeoutMs: 2_000 }).catch(
      (error: unknown) => error,
    );

    await vi.advanceTimersByTimeAsync(10_000);
    const error = await settled;

    expect(error).toBeInstanceOf(JobPollTimeoutError);
    expect(error).not.toBeInstanceOf(AbortError);
  });
});

describe("progress reporting", () => {
  it("calls onStatus once per poll, in order — T2.6", async () => {
    const fake = scripted([
      () => json(jobBody("accepted", { progress: 5 })),
      () => json(jobBody("running", { progress: 50 })),
      () => json(jobBody("successful", { progress: 100 })),
    ]);
    const seen: string[] = [];
    const promise = pollJob(JOB_URL, {
      fetch: fake.fetch,
      onStatus: (status) => seen.push(status.rawStatus),
    });

    await vi.advanceTimersByTimeAsync(60_000);
    await promise;

    expect(seen).toEqual(["accepted", "running", "successful"]);
  });

  it("survives a throwing onStatus — a broken progress bar is not a broken job", async () => {
    const fake = scripted([() => json(jobBody("running")), () => json(jobBody("successful"))]);
    const promise = pollJob(JOB_URL, {
      fetch: fake.fetch,
      onStatus: () => {
        throw new Error("the UI blew up");
      },
    });

    await vi.advanceTimersByTimeAsync(60_000);
    const report = await promise;

    expect(report.outcome).toBe("terminal");
    expect(report.status?.status).toBe("successful");
  });
});

describe("timer hygiene — T2.2", () => {
  it("leaves no pending timer after a resolved poll", async () => {
    const fake = scripted([() => json(jobBody("running")), () => json(jobBody("successful"))]);
    const promise = pollJob(JOB_URL, { fetch: fake.fetch });

    await vi.advanceTimersByTimeAsync(60_000);
    await promise;

    // A pending timer here is what keeps a Node process alive past the end of
    // the run that started it.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves no pending timer after a rejected poll", async () => {
    const controller = new AbortController();
    const fake = scripted([() => json(jobBody("running"))]);
    const settled = pollJob(JOB_URL, {
      fetch: fake.fetch,
      signal: controller.signal,
    }).catch(() => undefined);

    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    await settled;

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("terminal outcomes", () => {
  it("resolves — does not throw — for a failed job, and waitForJob agrees", async () => {
    const fake = scripted([() => json(jobBody("failed", { message: "it broke" }))]);
    const status = await waitForJob(JOB_URL, { fetch: fake.fetch });

    expect(status.status).toBe("failed");
    expect(status.message).toBe("it broke");
  });

  it("treats a 404 mid-poll as an ordinary ending, not an error", async () => {
    // Both reference servers delete a dismissed job rather than parking it at
    // `status: "dismissed"` (finding 0035), so this is what a cancellation
    // actually looks like from the poller's side.
    const fake = scripted([
      () => json(jobBody("running")),
      () => json(JSON.stringify({ code: "NoSuchJob" }), 404),
    ]);
    const promise = pollJob(JOB_URL, { fetch: fake.fetch });

    await vi.advanceTimersByTimeAsync(60_000);
    const report = await promise;

    expect(report.outcome).toBe("dismissed-remotely");
    expect(report.statusSequence).toEqual(["running", "404"]);
  });

  it("stops at maxPolls when a server invents a status that is never terminal", async () => {
    const fake = scripted([() => json(jobBody("paused"))]);
    const promise = pollJob(JOB_URL, { fetch: fake.fetch, maxPolls: 3, timeoutMs: 600_000 });

    await vi.advanceTimersByTimeAsync(600_000);
    const report = await promise;

    expect(report.outcome).toBe("timeout");
    expect(report.pollCount).toBe(3);
    expect(report.statusSequence).toEqual(["paused", "paused", "paused"]);
  });

  it("records the full status sequence — the async-usability matrix column", async () => {
    const { sink, seen } = collect();
    const fake = scripted([
      () => json(jobBody("accepted")),
      () => json(jobBody("accepted")),
      () => json(jobBody("successful")),
    ]);
    const promise = pollJob(JOB_URL, { fetch: fake.fetch, onObservation: sink });

    await vi.advanceTimersByTimeAsync(60_000);
    await promise;

    const polled = seen.find((entry) => entry.kind === "job-polled");
    expect(polled).toMatchObject({
      outcome: "terminal",
      pollCount: 3,
      // pygeoapi's real sequence: `accepted` throughout, then straight to
      // `successful`. Never `running` — finding 0032.
      statusSequence: ["accepted", "accepted", "successful"],
      retryAfterSeen: false,
    });
  });
});
