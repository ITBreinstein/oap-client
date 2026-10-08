/**
 * The client's job methods on a fresh client: a bare job id becomes a URL
 * under the job list the landing page advertises, or under `./jobs` when it
 * advertises none, and the discovery behind that is done once (review T12).
 *
 * `client-discovery.test.ts` holds the same methods to a caller's signal and
 * deadline while discovery hangs; this file is the path where it answers.
 * Every job document here is hand-built: what is under test is which URL the
 * client reads, not what a server puts in it.
 */

import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../msw.setup.js";
import conformanceFixture from "../fixtures/pygeoapi/conformance.json" with { type: "json" };
import { createClient } from "../../src/client.js";
import type { Observation } from "../../src/observations.js";

const ORIGIN = "https://service.test";
const BASE = `${ORIGIN}/oapi/`;
const JOB_LIST = "http://www.opengis.net/def/rel/ogc/1.0/job-list";

function collect(): { sink: (observation: Observation) => void; seen: Observation[] } {
  const seen: Observation[] = [];
  return { sink: (observation) => seen.push(observation), seen };
}

/** A landing page; `jobs` is the job-list link's href, or none when undefined. */
function landing(jobs: string | undefined) {
  return {
    title: "service",
    links: [
      { rel: "self", type: "application/json", href: BASE },
      { rel: "conformance", type: "application/json", href: "conformance" },
      ...(jobs === undefined ? [] : [{ rel: JOB_LIST, type: "application/json", href: jobs }]),
    ],
  };
}

/** The landing page and conformance; counts the landing page's requests. */
function serveDiscovery(jobs: string | undefined): { readonly landings: () => number } {
  let landings = 0;
  server.use(
    http.get(BASE, () => {
      landings += 1;
      return HttpResponse.json(landing(jobs));
    }),
    http.get(`${BASE}conformance`, () => HttpResponse.json(conformanceFixture)),
  );
  return { landings: () => landings };
}

function job(id: string, status: string) {
  return { jobID: id, status, type: "process" };
}

function jobListLink(seen: readonly Observation[]) {
  return seen.find((entry) => entry.kind === "job-list-link");
}

describe("a bare job id, on a fresh client", () => {
  it("is read under the job list the landing page advertises", async () => {
    serveDiscovery("https://jobs.service.test/queue");
    server.use(
      http.get("https://jobs.service.test/queue/j1", () => HttpResponse.json(job("j1", "running"))),
    );
    const { sink, seen } = collect();

    const status = await createClient({ baseUrl: BASE, onObservation: sink }).getJob("j1");

    expect(status).toMatchObject({ jobId: "j1", status: "running" });
    expect(jobListLink(seen)).toMatchObject({
      source: "advertised",
      url: "https://jobs.service.test/queue",
    });
  });

  it("is read under ./jobs when the landing page advertises no job list, and says so", async () => {
    serveDiscovery(undefined);
    server.use(http.get(`${BASE}jobs/j1`, () => HttpResponse.json(job("j1", "accepted"))));
    const { sink, seen } = collect();

    const status = await createClient({ baseUrl: BASE, onObservation: sink }).getJob("j1");

    expect(status.status).toBe("accepted");
    expect(jobListLink(seen)).toMatchObject({ source: "path-fallback", url: `${BASE}jobs` });
  });

  it("is encoded as one path segment", async () => {
    serveDiscovery(`${BASE}jobs`);
    server.use(http.get(`${BASE}jobs/a%2Fb%3Fc`, () => HttpResponse.json(job("a/b?c", "running"))));

    const status = await createClient({ baseUrl: BASE }).getJob("a/b?c");

    expect(status.jobId).toBe("a/b?c");
  });

  it("discovers once for every job method on the client", async () => {
    const discovery = serveDiscovery(`${BASE}jobs`);
    server.use(
      http.get(`${BASE}jobs`, () => HttpResponse.json({ jobs: [job("j1", "successful")] })),
      http.get(`${BASE}jobs/j1`, () => HttpResponse.json(job("j1", "successful"))),
      http.get(`${BASE}jobs/j1/results`, () => HttpResponse.json({ echo: "hi" })),
      http.delete(`${BASE}jobs/j1`, () => HttpResponse.json(job("j1", "dismissed"))),
    );
    const client = createClient({ baseUrl: BASE });

    await client.getJob("j1");
    await client.listJobs();
    await client.getResults("j1");
    await client.dismissJob("j1");

    expect(discovery.landings()).toBe(1);
  });

  it("discovers again after a discovery the server failed, rather than keeping its guess", async () => {
    let landings = 0;
    server.use(
      http.get(BASE, () => {
        landings += 1;
        return landings === 1
          ? HttpResponse.json({ title: "busy" }, { status: 503 })
          : HttpResponse.json(landing("https://jobs.service.test/queue"));
      }),
      http.get(`${BASE}conformance`, () => HttpResponse.json(conformanceFixture)),
      // The guess the failed discovery fell back to.
      http.get(`${BASE}jobs/j1`, () => HttpResponse.json(job("j1", "running"))),
      http.get("https://jobs.service.test/queue/j1", () => HttpResponse.json(job("j1", "failed"))),
    );
    const client = createClient({ baseUrl: BASE });

    expect((await client.getJob("j1")).status).toBe("running");
    expect((await client.getJob("j1")).status).toBe("failed");
    expect(landings).toBe(2);
  });
});

describe("an absolute job URL", () => {
  it("is used as it is, with no discovery at all", async () => {
    // No landing-page handler: MSW fails the test on any request it does not know.
    server.use(
      http.get("https://elsewhere.test/jobs/x", () => HttpResponse.json(job("x", "running"))),
    );

    const status = await createClient({ baseUrl: BASE }).getJob("https://elsewhere.test/jobs/x");

    expect(status.status).toBe("running");
  });
});

describe("each job method, by bare id", () => {
  it("getResults reads <job>/results", async () => {
    serveDiscovery(`${BASE}jobs`);
    server.use(http.get(`${BASE}jobs/j1/results`, () => HttpResponse.json({ echo: "hi" })));

    const results = await createClient({ baseUrl: BASE }).getResults("j1");

    expect(results.url).toBe(`${BASE}jobs/j1/results`);
    await expect(results.envelope.json()).resolves.toEqual({ echo: "hi" });
  });

  it("dismissJob sends DELETE to the job", async () => {
    serveDiscovery(`${BASE}jobs`);
    const deleted: string[] = [];
    server.use(
      http.delete(`${BASE}jobs/j1`, ({ request }) => {
        deleted.push(request.url);
        return HttpResponse.json(job("j1", "dismissed"));
      }),
    );

    await createClient({ baseUrl: BASE }).dismissJob("j1");

    expect(deleted).toEqual([`${BASE}jobs/j1`]);
  });

  it("listJobs reads the job list", async () => {
    serveDiscovery("https://jobs.service.test/queue");
    server.use(
      http.get("https://jobs.service.test/queue", () =>
        HttpResponse.json({ jobs: [job("j1", "running"), job("j2", "successful")] }),
      ),
    );

    const list = await createClient({ baseUrl: BASE }).listJobs();

    expect(list.jobs.map((entry) => entry.jobId)).toEqual(["j1", "j2"]);
  });

  it("pollJob and waitForJob read the job until it is final", async () => {
    serveDiscovery(`${BASE}jobs`);
    let reads = 0;
    server.use(
      http.get(`${BASE}jobs/j1`, () => {
        reads += 1;
        return HttpResponse.json(job("j1", reads < 2 ? "running" : "successful"));
      }),
    );
    const client = createClient({ baseUrl: BASE });

    // The shortest interval the poll loop allows, 500 ms, once per call.
    const report = await client.pollJob("j1", { intervalMs: 500 });
    expect(report.status?.status).toBe("successful");
    expect(reads).toBe(2);

    reads = 0;
    await expect(client.waitForJob("j1", { intervalMs: 500 })).resolves.toMatchObject({
      status: "successful",
    });
    expect(reads).toBe(2);
  });
});

describe("observations", () => {
  it("go to the call's own sink when it has one, else to the client's", async () => {
    serveDiscovery(`${BASE}jobs`);
    server.use(http.get(`${BASE}jobs/j1`, () => HttpResponse.json(job("j1", "running"))));
    const clientSink = collect();
    const callSink = collect();
    const client = createClient({ baseUrl: BASE, onObservation: clientSink.sink });

    await client.getJob("j1", { onObservation: callSink.sink });
    await client.getJob(`${BASE}jobs/j1`);

    expect(callSink.seen.some((entry) => entry.kind === "job-status")).toBe(true);
    expect(clientSink.seen.filter((entry) => entry.kind === "job-status")).toHaveLength(1);
  });
});
