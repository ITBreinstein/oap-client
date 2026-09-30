/**
 * Review: the deadline and the caller's signal while a *body* is being read.
 *
 * The fake `fetch` follows WHATWG semantics for an abort that arrives after
 * the response headers: the response body stream errors with the signal's
 * reason (Fetch spec, "abort fetch": "If response's body is non-null and is
 * readable, then error response's body with error"). Node's undici does the
 * same. The body here sends headers at once and then never sends a byte, as a
 * stalled server or proxy would.
 */

import { describe, expect, it } from "vitest";
import { execute } from "../../src/execution/execute.js";
import { pollJob } from "../../src/jobs/poll-job.js";
import { inspect } from "../../src/discovery/inspect.js";
import { AbortError } from "../../src/http/errors.js";
import { ExecutionTimeoutError, JobPollTimeoutError } from "../../src/errors.js";
import type { Observation } from "../../src/observations.js";

const HUNG = Symbol("hung");

/** Resolves with the promise's outcome, or HUNG if it has not settled within `ms`. */
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

/** Headers now; a body that stalls until the request's signal aborts, then errors like fetch does. */
function stalledBody(
  signal: AbortSignal | null | undefined,
  contentType = "application/json",
): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      signal?.addEventListener(
        "abort",
        () => {
          controller.error(signal.reason ?? new DOMException("aborted", "AbortError"));
        },
        { once: true },
      );
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": contentType } });
}

describe("execute(): body read after headers", () => {
  it.fails("C1: timeoutMs still ends an execute whose body stalls after the headers", async () => {
    const fetch = (_url: string, init: RequestInit = {}): Promise<Response> =>
      Promise.resolve(stalledBody(init.signal));

    const outcome = await settleWithin(
      execute("https://service.test/processes", "slow", { inputs: {}, timeoutMs: 100, fetch }),
      1_500,
    );

    expect(outcome).not.toBe(HUNG);
    expect(outcome).toBeInstanceOf(ExecutionTimeoutError);
  });

  it.fails(
    "C1: the caller's signal still ends an execute whose body stalls after the headers",
    async () => {
      const fetch = (_url: string, init: RequestInit = {}): Promise<Response> =>
        Promise.resolve(stalledBody(init.signal));
      const controller = new AbortController();
      setTimeout(() => {
        controller.abort();
      }, 100);

      const outcome = await settleWithin(
        execute("https://service.test/processes", "slow", {
          inputs: {},
          signal: controller.signal,
          fetch,
        }),
        1_500,
      );

      expect(outcome).not.toBe(HUNG);
      expect(outcome).toBeInstanceOf(AbortError);
    },
  );
});

describe("pollJob(): body read after headers", () => {
  it.fails(
    "C2: a deadline that fires mid-body is reported as a timeout, not a malformed document",
    async () => {
      const fetch = (_url: string, init: RequestInit = {}): Promise<Response> =>
        Promise.resolve(stalledBody(init.signal));
      const seen: Observation[] = [];

      const outcome = await settleWithin(
        pollJob("https://service.test/jobs/j1", {
          timeoutMs: 150,
          fetch,
          onObservation: (o) => seen.push(o),
        }),
        1_500,
      );

      expect(outcome).toBeInstanceOf(JobPollTimeoutError);
      const polled = seen.find((o) => o.kind === "job-polled");
      expect(polled?.kind === "job-polled" ? polled.outcome : undefined).toBe("timeout");
    },
  );

  it.fails(
    "C2: a caller abort mid-body is reported as an abort, not a malformed document",
    async () => {
      const fetch = (_url: string, init: RequestInit = {}): Promise<Response> =>
        Promise.resolve(stalledBody(init.signal));
      const controller = new AbortController();
      setTimeout(() => {
        controller.abort();
      }, 100);
      const seen: Observation[] = [];

      const outcome = await settleWithin(
        pollJob("https://service.test/jobs/j1", {
          signal: controller.signal,
          fetch,
          onObservation: (o) => seen.push(o),
        }),
        1_500,
      );

      expect(outcome).toBeInstanceOf(AbortError);
      const polled = seen.find((o) => o.kind === "job-polled");
      expect(polled?.kind === "job-polled" ? polled.outcome : undefined).toBe("aborted");
    },
  );
});

describe("inspect(): body read after headers", () => {
  const landing = {
    title: "t",
    links: [
      { rel: "conformance", href: "https://service.test/conformance", type: "application/json" },
    ],
  };

  it.fails(
    "C2: an abort during the conformance body rejects, rather than degrading to unknown capabilities",
    async () => {
      const controller = new AbortController();
      const fetch = (url: string, init: RequestInit = {}): Promise<Response> => {
        if (url.endsWith("/conformance")) {
          setTimeout(() => {
            controller.abort();
          }, 50);
          return Promise.resolve(stalledBody(init.signal));
        }
        return Promise.resolve(
          new Response(JSON.stringify(landing), {
            headers: { "Content-Type": "application/json" },
          }),
        );
      };

      const outcome = await settleWithin(
        inspect("https://service.test/", { signal: controller.signal, fetch }),
        1_500,
      );

      // Documented: "Pass a `signal` to cancel it; it is threaded into both requests".
      expect(outcome).toBeInstanceOf(AbortError);
    },
  );

  it.fails("C2: an abort during the landing-page body rejects with AbortError", async () => {
    const controller = new AbortController();
    const fetch = (_url: string, init: RequestInit = {}): Promise<Response> => {
      setTimeout(() => {
        controller.abort();
      }, 50);
      return Promise.resolve(stalledBody(init.signal));
    };

    const outcome = await settleWithin(
      inspect("https://service.test/", { signal: controller.signal, fetch }),
      1_500,
    );

    expect(outcome).toBeInstanceOf(AbortError);
  });
});
