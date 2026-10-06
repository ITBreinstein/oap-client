/**
 * Review: deadlines that cannot be expressed as a timer, and client-level
 * discovery that ignores the caller's signal.
 */

import { describe, expect, it } from "vitest";
import { createClient } from "../../src/client.js";
import { execute } from "../../src/execution/execute.js";
import { pollJob, waitForJob } from "../../src/jobs/poll-job.js";
import { AbortError } from "../../src/http/errors.js";

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

/** Answers after `ms`, and rejects like fetch does if the signal fires first. */
function slowFetch(ms: number, answer: () => Response) {
  return (_url: string, init: RequestInit = {}): Promise<Response> =>
    new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => {
        resolve(answer());
      }, ms);
      init.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("This operation was aborted", "AbortError"));
      });
    });
}

describe("timeoutMs larger than a timer can hold", () => {
  // setTimeout clamps anything above 2^31-1 ms (~24.8 days) to 1 ms (Node warns
  // with TimeoutOverflowWarning; browsers fire immediately). 2^32, not 2^31:
  // pollJob subtracts the milliseconds already spent, and 2^31 minus one is
  // exactly the largest delay a timer holds, so 2^31 only failed sometimes.
  it.fails("C3: pollJob with a very long deadline still polls the job to its end", async () => {
    const fetch = slowFetch(30, () => json({ jobID: "j1", status: "successful" }));
    const outcome = await settleWithin(
      pollJob("https://service.test/jobs/j1", { timeoutMs: 2 ** 32, fetch }),
      1_500,
    );
    expect(outcome).toMatchObject({ outcome: "terminal" });
  });

  it.fails(
    'C3: pollJob with timeoutMs: Infinity ("no deadline") still polls the job to its end',
    async () => {
      const fetch = slowFetch(30, () => json({ jobID: "j1", status: "successful" }));
      const outcome = await settleWithin(
        pollJob("https://service.test/jobs/j1", { timeoutMs: Number.POSITIVE_INFINITY, fetch }),
        1_500,
      );
      expect(outcome).toMatchObject({ outcome: "terminal" });
    },
  );

  it.fails("C3: execute with a very long deadline still returns the result", async () => {
    const fetch = slowFetch(30, () => json({ id: "echo", value: "hi" }));
    const outcome = await settleWithin(
      execute("https://service.test/processes", "echo", { inputs: {}, timeoutMs: 2 ** 32, fetch }),
      1_500,
    );
    expect(outcome).toMatchObject({ kind: "immediate" });
  });
});

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

describe("client discovery honours the caller's signal", () => {
  /** A landing page that never answers unless its own request is aborted. */
  function hangingLanding() {
    return (_url: string, init: RequestInit = {}): Promise<Response> =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(new DOMException("This operation was aborted", "AbortError"));
        });
      });
  }

  it("control: listProcesses rejects with AbortError while discovery hangs", async () => {
    const client = createClient({ baseUrl: "https://service.test/", fetch: hangingLanding() });
    const controller = new AbortController();
    setTimeout(() => {
      controller.abort();
    }, 50);
    const outcome = await settleWithin(client.listProcesses({ signal: controller.signal }), 1_000);
    expect(outcome).toBeInstanceOf(AbortError);
  });

  it.fails("C4: listJobs rejects with AbortError while discovery hangs", async () => {
    const client = createClient({ baseUrl: "https://service.test/", fetch: hangingLanding() });
    const controller = new AbortController();
    setTimeout(() => {
      controller.abort();
    }, 50);
    const outcome = await settleWithin(client.listJobs({ signal: controller.signal }), 1_000);
    expect(outcome).toBeInstanceOf(AbortError);
  });

  it.fails("C4: getJob(bare id) rejects with AbortError while discovery hangs", async () => {
    const client = createClient({ baseUrl: "https://service.test/", fetch: hangingLanding() });
    const controller = new AbortController();
    setTimeout(() => {
      controller.abort();
    }, 50);
    const outcome = await settleWithin(client.getJob("j1", { signal: controller.signal }), 1_000);
    expect(outcome).toBeInstanceOf(AbortError);
  });

  it.fails("C4: execute with timeoutMs ends while discovery hangs", async () => {
    const client = createClient({ baseUrl: "https://service.test/", fetch: hangingLanding() });
    const outcome = await settleWithin(client.execute("p", { inputs: {}, timeoutMs: 100 }), 1_000);
    expect(outcome).not.toBe(HUNG);
  });

  it.fails("C4: pollJob(bare id) with a deadline ends while discovery hangs", async () => {
    const client = createClient({ baseUrl: "https://service.test/", fetch: hangingLanding() });
    const outcome = await settleWithin(client.pollJob("j1", { timeoutMs: 100 }), 1_000);
    expect(outcome).not.toBe(HUNG);
  });
});
