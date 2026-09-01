/**
 * `execute()` end to end against a fake `fetch`.
 *
 * The fake is a plain function rather than msw so that the *request* can be
 * inspected directly — headers and body are half of what this task has to get
 * right, and the T1 assertion in particular has no live counterpart.
 */

import { describe, expect, it, vi } from "vitest";
import { execute } from "../../src/execution/execute.js";
import { AmbiguousExecutionResponseError, ExecutionTimeoutError } from "../../src/errors.js";
import { AbortError, ProcessesError } from "../../src/http/errors.js";
import { parseDescription } from "../../src/processes/parse-description.js";
import type { ProcessDescription } from "../../src/processes/types.js";
import type { Observation } from "../../src/observations.js";
import helloWorld from "../fixtures/pygeoapi/processes/hello-world.json" with { type: "json" };

const LIST = "https://service.test/oapi/processes";

interface Captured {
  readonly url: string;
  readonly init: RequestInit;
}

/** A `fetch` that records what it was asked and answers with a fixed response. */
function fakeFetch(response: Response): {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  calls: Captured[];
} {
  const calls: Captured[] = [];
  return {
    calls,
    fetch: (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      return Promise.resolve(response.clone());
    },
  };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function headerOf(init: RequestInit, name: string): string | undefined {
  return new Headers(init.headers).get(name) ?? undefined;
}

function collect(): { sink: (observation: Observation) => void; seen: Observation[] } {
  const seen: Observation[] = [];
  return { sink: (observation) => seen.push(observation), seen };
}

/** The one execution observation, narrowed. */
function executionRecord(seen: Observation[]): Extract<Observation, { kind: "execution" }> {
  const found = seen.find((entry) => entry.kind === "execution");
  if (found === undefined) throw new Error("no execution observation was recorded");
  return found;
}

describe("the request execute() sends", () => {
  it("POSTs with Content-Type: application/json — the T1 assertion", async () => {
    // Deliberately NOT a live reduction test. Sending a bad content type at
    // ZOO crashes its kernel with SIGSEGV (finding 0015); this proves the same
    // property without taking down someone else's process.
    const fake = fakeFetch(json({ id: "echo", value: "Hello!" }));
    await execute(LIST, "hello-world", { inputs: { name: "p" }, fetch: fake.fetch });

    const [call] = fake.calls;
    expect(call?.init.method).toBe("POST");
    expect(headerOf(call?.init ?? {}, "Content-Type")).toBe("application/json");
  });

  it("sends an explicit wildcard Accept, never the browser default", async () => {
    const fake = fakeFetch(json({ value: 1 }));
    await execute(LIST, "hello-world", { inputs: {}, fetch: fake.fetch });

    expect(headerOf(fake.calls[0]?.init ?? {}, "Accept")).toBe("*/*");
  });

  it("sends no Prefer header for sync and Prefer: respond-async for async", async () => {
    const sync = fakeFetch(json({ value: 1 }));
    await execute(LIST, "hello-world", { inputs: {}, fetch: sync.fetch });
    expect(headerOf(sync.calls[0]?.init ?? {}, "Prefer")).toBeUndefined();

    const async = fakeFetch(json({ status: "accepted" }, 201, { Location: "/oapi/jobs/1" }));
    await execute(LIST, "hello-world", { inputs: {}, mode: "async", fetch: async.fetch });
    expect(headerOf(async.calls[0]?.init ?? {}, "Prefer")).toBe("respond-async");
  });

  it("serialises inputs unchanged and omits outputs and response when not supplied", async () => {
    const fake = fakeFetch(json({ value: 1 }));
    await execute(LIST, "hello-world", {
      inputs: { name: "plugfest", bbox: { bbox: [4.3, 52, 4.4, 52.1], crs: "EPSG:4326" } },
      fetch: fake.fetch,
    });

    expect(fake.calls[0]?.init.body).toBe(
      '{"inputs":{"name":"plugfest","bbox":{"bbox":[4.3,52,4.4,52.1],"crs":"EPSG:4326"}}}',
    );
  });

  it("includes outputs and response only when the caller supplies them", async () => {
    const fake = fakeFetch(json({ value: 1 }));
    await execute(LIST, "hello-world", {
      inputs: { name: "p" },
      outputs: { echo: { transmissionMode: "value" } },
      response: "document",
      fetch: fake.fetch,
    });

    expect(fake.calls[0]?.init.body).toBe(
      '{"inputs":{"name":"p"},"outputs":{"echo":{"transmissionMode":"value"}},' +
        '"response":"document"}',
    );
  });

  it("POSTs to the execute link the description advertises", async () => {
    const description: ProcessDescription = parseDescription(helloWorld, {
      documentUrl: `${LIST}/hello-world`,
    }).process;
    const fake = fakeFetch(json({ value: 1 }));

    await execute(LIST, "hello-world", { inputs: {}, description, fetch: fake.fetch });

    expect(fake.calls[0]?.url).toBe("http://localhost:5080/processes/hello-world/execution?f=json");
  });

  it("falls back to the constructed path with no description", async () => {
    const fake = fakeFetch(json({ value: 1 }));
    await execute(LIST, "hello-world", { inputs: {}, fetch: fake.fetch });

    expect(fake.calls[0]?.url).toBe(`${LIST}/hello-world/execution`);
  });
});

describe("arity warnings never block the request", () => {
  const description: ProcessDescription = {
    id: "arity",
    execution: { sync: true, async: false, dismiss: false, declared: [], defaulted: true },
    outputTransmission: ["value"],
    links: [],
    outputs: [],
    inputs: [
      { id: "one", minOccurs: 1, maxOccurs: 1, required: true, multiple: false, schema: {} },
      {
        id: "many",
        minOccurs: 0,
        maxOccurs: "unbounded",
        required: false,
        multiple: true,
        schema: {},
      },
    ],
  };

  it.each([
    ["an array for a single-valued input", { one: ["a"] }, "accepts one value"],
    ["a bare value for a multi-valued input", { one: "a", many: "b" }, "accepts multiple values"],
    ["a missing required input", {}, "missing required input"],
  ])("still sends when given %s", async (_label, inputs, expected) => {
    const fake = fakeFetch(json({ value: 1 }));
    const { sink, seen } = collect();

    const execution = await execute(LIST, "arity", {
      inputs,
      description,
      fetch: fake.fetch,
      onObservation: sink,
    });

    expect(fake.calls).toHaveLength(1);
    expect(execution.kind).toBe("immediate");
    expect(executionRecord(seen).warnings.join(" ")).toContain(expected);
  });
});

describe("what execute() returns", () => {
  it("hands back the envelope unparsed, for the result adapters to interpret", async () => {
    // T4. The classifier read the body to decide; that must not consume it,
    // and nothing here decides what a media type means.
    const fake = fakeFetch(
      new Response("PNG-BYTES", {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Content-Disposition": 'attachment; filename="result.png"',
          "Content-Crs": "<http://www.opengis.net/def/crs/OGC/1.3/CRS84>",
        },
      }),
    );

    const execution = await execute(LIST, "render", { inputs: {}, fetch: fake.fetch });

    expect(execution.kind).toBe("immediate");
    if (execution.kind !== "immediate") throw new Error("unreachable");
    expect(execution.response.mediaType).toBe("image/png");
    expect(execution.response.filename).toBe("result.png");
    expect(execution.response.contentCrs).toBe("<http://www.opengis.net/def/crs/OGC/1.3/CRS84>");
    expect(await execution.response.text()).toBe("PNG-BYTES");
  });

  it("returns the job arm with requestedMode intact when a sync request makes a job", async () => {
    const fake = fakeFetch(
      json({ jobID: "8f2c", status: "accepted" }, 201, { Location: "/oapi/jobs/8f2c" }),
    );
    const { sink, seen } = collect();

    const execution = await execute(LIST, "hello-world", {
      inputs: {},
      mode: "sync",
      fetch: fake.fetch,
      onObservation: sink,
    });

    expect(execution.kind).toBe("job");
    if (execution.kind !== "job") throw new Error("unreachable");
    expect(execution.requestedMode).toBe("sync");
    expect(execution.job.statusUrl).toBe("https://service.test/oapi/jobs/8f2c");
    // The divergence the matrix exists to hold: asked sync, got a job.
    expect(executionRecord(seen).disagreedWithRequestedMode).toBe(true);
  });

  it("throws AmbiguousExecutionResponseError rather than guessing a job URL", async () => {
    const fake = fakeFetch(json(null, 201));

    await expect(
      execute(LIST, "hello-world", { inputs: {}, mode: "async", fetch: fake.fetch }),
    ).rejects.toThrow(AmbiguousExecutionResponseError);
  });
});

describe("errors are outcomes, not something to paper over", () => {
  it("throws ProcessesError carrying the problem document on a ZOO-style 500", async () => {
    // Finding 0016: ZOO answers a rejected input with 500, so the status alone
    // cannot say whether the server broke or the user typed something wrong.
    // The core does not invent an input-validation error — it hands over
    // whatever explanation the server gave. See T5.
    const fake = fakeFetch(
      json(
        {
          title: "NoApplicableCode",
          type: "NoApplicableCode",
          detail: "at least one input (a, b or c) should be provided",
        },
        500,
      ),
    );
    const { sink, seen } = collect();

    await expect(
      execute(LIST, "echo", { inputs: {}, fetch: fake.fetch, onObservation: sink }),
    ).rejects.toThrow(ProcessesError);

    const record = executionRecord(seen);
    expect(record.outcome).toBe("error");
    expect(record.status).toBe(500);
    expect(record.problemPresent).toBe(true);
  });

  it("does not hard-code 404 handling — ZOO answers an unknown path with 400", async () => {
    // Finding 0014.
    const fake = fakeFetch(json({ title: "InvalidParameterValue", type: "x" }, 400));

    await expect(execute(LIST, "mistyped", { inputs: {}, fetch: fake.fetch })).rejects.toThrow(
      ProcessesError,
    );
  });

  it("never retries: a failed execution is a finding, and a POST is not idempotent", async () => {
    const fake = fakeFetch(json({ title: "Boom", type: "about:blank" }, 500));

    await expect(execute(LIST, "echo", { inputs: {}, fetch: fake.fetch })).rejects.toThrow();
    expect(fake.calls).toHaveLength(1);
  });
});

describe("the deadline and the caller's signal stay separable", () => {
  it("reports a timeout as ExecutionTimeoutError, not as an abort", async () => {
    const never = (_url: string, init: RequestInit = {}): Promise<Response> =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });

    await expect(
      execute(LIST, "slow", { inputs: {}, timeoutMs: 20, fetch: never }),
    ).rejects.toThrow(ExecutionTimeoutError);
  });

  it("reports the caller's cancellation as AbortError, not as a timeout", async () => {
    const never = (_url: string, init: RequestInit = {}): Promise<Response> =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });

    const controller = new AbortController();
    const pending = execute(LIST, "slow", {
      inputs: {},
      timeoutMs: 60_000,
      signal: controller.signal,
      fetch: never,
    });
    controller.abort();

    await expect(pending).rejects.toThrow(AbortError);
  });

  it("clears its timer, so a fast call does not keep the process alive", async () => {
    const clear = vi.spyOn(globalThis, "clearTimeout");
    const fake = fakeFetch(json({ value: 1 }));

    await execute(LIST, "hello-world", { inputs: {}, fetch: fake.fetch });

    expect(clear).toHaveBeenCalled();
    clear.mockRestore();
  });
});

describe("the observation", () => {
  it("records ids and kinds but never the input values", async () => {
    const fake = fakeFetch(json({ value: 1 }));
    const { sink, seen } = collect();

    await execute(LIST, "hello-world", {
      inputs: { name: "a secret the user typed", bbox: [4.3, 52, 4.4, 52.1] },
      response: "document",
      fetch: fake.fetch,
      onObservation: sink,
    });

    const record = executionRecord(seen);
    expect(record.inputIds).toEqual(["name", "bbox"]);
    expect(record.inputKinds).toEqual(["string", "array of 4 number"]);
    expect(JSON.stringify(record)).not.toContain("secret");
    expect(record.requestedResponse).toBe("document");
    expect(record.outputsSupplied).toBe(false);
    expect(record.route).toBe("constructed-path");
    expect(record.resultKind).toBe("immediate");
    expect(record.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("records how a job was discovered and whether Location was readable", async () => {
    const fake = fakeFetch(
      json(
        { jobID: "8f2c", status: "accepted", links: [{ rel: "monitor", href: "/oapi/jobs/8f2c" }] },
        201,
      ),
    );
    const { sink, seen } = collect();

    await execute(LIST, "hello-world", {
      inputs: {},
      mode: "async",
      fetch: fake.fetch,
      onObservation: sink,
    });

    const record = executionRecord(seen);
    expect(record.discoveredVia).toBe("body-link");
    // The pair (locationPresent: false, discoveredVia: "body-link") is exactly
    // the CORS evidence T7 exists to produce.
    expect(record.locationPresent).toBe(false);
    expect(record.jobIdKnown).toBe(true);
  });

  it("records a transport failure with no status, and still reports elapsed time", async () => {
    const dead = (): Promise<Response> => Promise.reject(new TypeError("Failed to fetch"));
    const { sink, seen } = collect();

    await expect(
      execute(LIST, "hello-world", { inputs: {}, fetch: dead, onObservation: sink }),
    ).rejects.toThrow();

    const record = executionRecord(seen);
    expect(record.outcome).toBe("transport-failure");
    expect(record.status).toBeUndefined();
    expect(record.elapsedMs).toBeGreaterThanOrEqual(0);
  });
});
