/**
 * The client's discovery — landing page to process-list or job-list URL —
 * under a caller's signal and a call's deadline (review C4).
 *
 * The discovery is shared and memoised, so it takes no caller's signal: one
 * caller cancelling must not fail another. Each call honours its own signal
 * while it waits, `timeoutMs` counts the wait, and the shared discovery has a
 * limit of its own, so a landing page that never answers cannot hold every
 * later call on the client.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../../src/client.js";
import { ExecutionTimeoutError, JobPollTimeoutError } from "../../src/errors.js";
import { AbortError } from "../../src/http/errors.js";
import type { Observation } from "../../src/observations.js";
import { abortAfter, HUNG, settleWithin } from "../http/stalled-body.js";

const BASE = "https://service.test/";

/** A landing page that never answers, unless its own request is aborted. */
function hangingLanding(): (url: string, init?: RequestInit) => Promise<Response> {
  return (_url, init = {}) =>
    new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => {
        reject(new DOMException("This operation was aborted", "AbortError"));
      });
    });
}

describe("each call honours its own signal while discovery hangs", () => {
  type Client = ReturnType<typeof createClient>;
  const calls: Record<string, (client: Client, signal: AbortSignal) => Promise<unknown>> = {
    listProcesses: (client, signal) => client.listProcesses({ signal }),
    getProcess: (client, signal) => client.getProcess("p", { signal }),
    listJobs: (client, signal) => client.listJobs({ signal }),
    "getJob(bare id)": (client, signal) => client.getJob("j1", { signal }),
    "getResults(bare id)": (client, signal) => client.getResults("j1", { signal }),
    "dismissJob(bare id)": (client, signal) => client.dismissJob("j1", { signal }),
    "pollJob(bare id)": (client, signal) => client.pollJob("j1", { signal }),
  };

  for (const [name, call] of Object.entries(calls)) {
    it(`${name} rejects with AbortError`, async () => {
      const client = createClient({ baseUrl: BASE, fetch: hangingLanding() });
      const outcome = await settleWithin(call(client, abortAfter(50).signal), 1_000);
      expect(outcome).toBeInstanceOf(AbortError);
    });
  }
});

describe("timeoutMs counts the wait for discovery", () => {
  it("ends execute with ExecutionTimeoutError", async () => {
    const client = createClient({ baseUrl: BASE, fetch: hangingLanding() });
    const outcome = await settleWithin(client.execute("p", { inputs: {}, timeoutMs: 100 }), 1_000);
    expect(outcome).not.toBe(HUNG);
    expect(outcome).toBeInstanceOf(ExecutionTimeoutError);
  });

  it("ends pollJob(bare id) with JobPollTimeoutError", async () => {
    const client = createClient({ baseUrl: BASE, fetch: hangingLanding() });
    const outcome = await settleWithin(client.pollJob("j1", { timeoutMs: 100 }), 1_000);
    expect(outcome).not.toBe(HUNG);
    expect(outcome).toBeInstanceOf(JobPollTimeoutError);
  });

  it("ends waitForJob(bare id) with JobPollTimeoutError", async () => {
    const client = createClient({ baseUrl: BASE, fetch: hangingLanding() });
    const outcome = await settleWithin(client.waitForJob("j1", { timeoutMs: 100 }), 1_000);
    expect(outcome).toBeInstanceOf(JobPollTimeoutError);
  });

  it("is still the caller's abort, not a timeout, when the caller cancels first", async () => {
    const client = createClient({ baseUrl: BASE, fetch: hangingLanding() });
    const outcome = await settleWithin(
      client.execute("p", { inputs: {}, timeoutMs: 60_000, signal: abortAfter(50).signal }),
      1_000,
    );
    expect(outcome).toBeInstanceOf(AbortError);
  });
});

describe("the shared discovery's own limit", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("gives up on a landing page that never answers, guesses, and asks again next time", async () => {
    vi.useFakeTimers();
    let landingRequests = 0;
    const seen: Observation[] = [];
    const client = createClient({
      baseUrl: BASE,
      onObservation: (observation) => seen.push(observation),
      fetch: (url: string, init: RequestInit = {}) => {
        if (url === BASE) {
          landingRequests += 1;
          return hangingLanding()(url, init);
        }
        return Promise.resolve(Response.json({ processes: [], links: [] }));
      },
    });

    // No signal and no timeout of the caller's: only the discovery's own limit ends the wait.
    const listed = client.listProcesses();
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(listed).resolves.toMatchObject({ processes: [] });
    expect(seen.filter((entry) => entry.kind === "processes-link")).toMatchObject([
      { source: "path-fallback", url: "https://service.test/processes" },
    ]);

    // Not remembered: the next call reads the landing page again.
    const again = client.listProcesses();
    await vi.advanceTimersByTimeAsync(30_000);
    await again;
    expect(landingRequests).toBe(2);
  });
});
