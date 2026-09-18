/**
 * `dismissJob()` — a capability probe, not a command that must succeed.
 *
 * Reduction test this file backs:
 *  - making `dismissJob()` throw on any non-2xx → the 405 and 501 tests go red.
 *    *(T4)*
 */

import { describe, expect, it } from "vitest";
import { dismissJob } from "../../src/jobs/dismiss-job.js";
import { ProcessesError } from "../../src/http/errors.js";
import type { Observation } from "../../src/observations.js";

const JOB_URL = "https://service.test/oapi/jobs/abc";

function collect(): { sink: (o: Observation) => void; seen: Observation[] } {
  const seen: Observation[] = [];
  return { sink: (o) => seen.push(o), seen };
}

function fetchRecording(response: Response): {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  methods: (string | undefined)[];
} {
  const methods: (string | undefined)[] = [];
  return {
    methods,
    fetch: (_url: string, init: RequestInit = {}) => {
      methods.push(init.method);
      return Promise.resolve(response.clone());
    },
  };
}

function dismissRecord(seen: Observation[]): Extract<Observation, { kind: "job-dismissed" }> {
  const found = seen.find((entry) => entry.kind === "job-dismissed");
  if (found === undefined) throw new Error("no job-dismissed observation was recorded");
  return found;
}

/**
 * pygeoapi 0.21.0's real dismiss response, captured 2026-09-16 from
 * `slow-delete-200.http`.
 *
 * Note the media type: the body is JSON and the header says `text/html`
 * (finding 0037). That is why the parse is not gated on `envelope.isJson`.
 */
const PYGEOAPI_DISMISS_BODY = JSON.stringify({
  jobID: "abc",
  status: "dismissed",
  message: "Job dismissed",
  progress: 100,
  links: [
    {
      href: "https://service.test/oapi/jobs",
      rel: "up",
      type: "application/json",
      title: "The job list for the current process",
    },
  ],
});

describe("a server that dismisses", () => {
  it("sends DELETE and reports the dismissal", async () => {
    const fake = fetchRecording(
      new Response(PYGEOAPI_DISMISS_BODY, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
    );

    const outcome = await dismissJob(JOB_URL, { fetch: fake.fetch });

    expect(fake.methods[0]).toBe("DELETE");
    expect(outcome.kind).toBe("dismissed");
  });

  it("parses the returned job document even though pygeoapi labels it text/html", async () => {
    // Finding 0037. Gating the parse on `envelope.isJson` would silently drop
    // the confirmation on one of the two reference servers.
    const fake = fetchRecording(
      new Response(PYGEOAPI_DISMISS_BODY, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
    );

    const outcome = await dismissJob(JOB_URL, { fetch: fake.fetch });

    expect(outcome.kind).toBe("dismissed");
    if (outcome.kind !== "dismissed") throw new Error("unreachable");
    expect(outcome.status?.status).toBe("dismissed");
    expect(outcome.status?.terminal).toBe(true);
  });

  it("still reports a dismissal when the body is unreadable", async () => {
    // A dismissal the server accepted is a dismissal, whatever it sent back.
    const fake = fetchRecording(new Response(null, { status: 204 }));

    const outcome = await dismissJob(JOB_URL, { fetch: fake.fetch });

    expect(outcome.kind).toBe("dismissed");
    if (outcome.kind !== "dismissed") throw new Error("unreachable");
    expect(outcome.status).toBeUndefined();
  });
});

describe("a server that cannot dismiss — T4", () => {
  it("reports 405 as unsupported rather than throwing", async () => {
    // The reduction test: make this throw on any non-2xx and this goes red.
    // A 405 is the answer the probe asked for.
    const fake = fetchRecording(new Response("", { status: 405 }));

    const outcome = await dismissJob(JOB_URL, { fetch: fake.fetch });

    expect(outcome.kind).toBe("unsupported");
    if (outcome.kind !== "unsupported") throw new Error("unreachable");
    expect(outcome.status).toBe(405);
  });

  it("reports 501 as unsupported too", async () => {
    const fake = fetchRecording(new Response("", { status: 501 }));

    expect((await dismissJob(JOB_URL, { fetch: fake.fetch })).kind).toBe("unsupported");
  });

  it("throws for 500 — a broken server is not a missing capability", async () => {
    const fake = fetchRecording(new Response("", { status: 500 }));

    await expect(dismissJob(JOB_URL, { fetch: fake.fetch })).rejects.toBeInstanceOf(ProcessesError);
  });

  it("throws for 403 — a refusal is not the same as an absent capability", async () => {
    // "This server will not let you dismiss *this* job" and "this server cannot
    // dismiss jobs at all" are different statements, and the matrix needs both.
    const fake = fetchRecording(new Response("", { status: 403 }));

    await expect(dismissJob(JOB_URL, { fetch: fake.fetch })).rejects.toBeInstanceOf(ProcessesError);
  });
});

describe("the declared-versus-observed cell", () => {
  it("records what the conformance document claimed beside what happened", async () => {
    // pygeoapi's actual combination, finding 0006: it honours the DELETE while
    // declaring no dismiss class. The gap is only visible because both halves
    // land on one observation.
    const { sink, seen } = collect();
    const fake = fetchRecording(
      new Response(PYGEOAPI_DISMISS_BODY, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
    );

    await dismissJob(JOB_URL, {
      fetch: fake.fetch,
      declaredDismiss: false,
      onObservation: sink,
    });

    expect(dismissRecord(seen)).toMatchObject({
      status: 200,
      outcome: "dismissed",
      declaredDismiss: false,
    });
  });

  it("sends the request even when the class was not declared — never gates", async () => {
    // The whole finding-0006 lesson: a conformance class is evidence, not
    // authorisation. A client that checked first would never have discovered
    // that pygeoapi supports dismiss.
    const fake = fetchRecording(
      new Response(PYGEOAPI_DISMISS_BODY, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
    );

    const outcome = await dismissJob(JOB_URL, { fetch: fake.fetch, declaredDismiss: false });

    expect(fake.methods).toEqual(["DELETE"]);
    expect(outcome.kind).toBe("dismissed");
  });

  it("records an error outcome before rethrowing", async () => {
    const { sink, seen } = collect();
    const fake = fetchRecording(new Response("", { status: 500 }));

    await expect(
      dismissJob(JOB_URL, { fetch: fake.fetch, onObservation: sink }),
    ).rejects.toBeInstanceOf(ProcessesError);

    expect(dismissRecord(seen).outcome).toBe("error");
  });
});
