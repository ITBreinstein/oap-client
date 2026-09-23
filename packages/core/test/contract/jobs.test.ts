/**
 * Jobs against pygeoapi 0.21.0, pinned in infra/compose/pygeoapi.yml.
 *
 * Every expectation here was derived from what the running server actually
 * sends on 2026-09-16, not from what the specification says it should. Where
 * the two disagree the test asserts the server's behaviour and names the
 * finding, so an upstream fix shows up as a failure to re-read rather than as
 * drift nobody notices until a plugfest.
 *
 * ## Why this file needs the `slow` process
 *
 * `hello-world` completes before the first poll returns, which makes every
 * asynchronous code path unobservable: a non-terminal job is never seen,
 * dismissal of a *live* job cannot be told apart from dismissal of a finished
 * one, and the progress path has no data. `infra/pygeoapi/plugins/
 * breinstein_slow.py` exists for this file. See infra/README.md.
 *
 * ## The one thing this lane cannot assert
 *
 * That a job is ever `running`. pygeoapi reports `accepted` for the whole of a
 * job's execution and jumps straight to `successful` — finding 0032. The tests
 * below assert *non-terminal*, which is the property the poll loop actually
 * depends on, and the interop lane asserts `running` against ZOO, which does
 * report it.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type Client } from "../../src/index.js";
import { JobNotFoundError } from "../../src/errors.js";
import { ProcessesError } from "../../src/http/errors.js";
import { send } from "../../src/http/transport.js";
import type { Execution } from "../../src/execution/types.js";
import type { Observation } from "../../src/observations.js";

const CORS = "http://localhost:5080";
const NOCORS = "http://localhost:5081";

let client: Client;
let seen: Observation[];

function records<K extends Observation["kind"]>(kind: K): Extract<Observation, { kind: K }>[] {
  return seen.filter((entry): entry is Extract<Observation, { kind: K }> => entry.kind === kind);
}

/** Start a `slow` job asynchronously and hand back its status URL. */
async function startSlowJob(seconds: number, base: Client = client): Promise<string> {
  const execution: Execution = await base.execute("slow", {
    inputs: { seconds },
    outputs: {},
    mode: "async",
  });
  if (execution.kind !== "job") {
    throw new Error(`expected a job, got ${execution.kind}`);
  }
  return execution.job.statusUrl;
}

beforeAll(async () => {
  seen = [];
  client = createClient({ baseUrl: CORS, onObservation: (entry) => seen.push(entry) });
  try {
    await send(CORS, { signal: AbortSignal.timeout(5000) });
  } catch (cause) {
    throw new Error(
      `pygeoapi is not answering on ${CORS}. Start it with:\n` +
        `  docker compose -f infra/compose/pygeoapi.yml up -d --wait`,
      { cause },
    );
  }

  // The contract lane is only meaningful with the slow process registered. Fail
  // loudly rather than silently testing nothing.
  const processes = await client.listProcesses();
  if (!processes.processes.some((entry) => entry.id === "slow")) {
    throw new Error(
      "The `slow` process is not registered on this pygeoapi. It is mounted from " +
        "infra/pygeoapi/plugins and declared in infra/pygeoapi/config-cors.yml; " +
        "recreate the stack with `docker compose -f infra/compose/pygeoapi.yml up -d --force-recreate`.",
    );
  }
});

describe("the asynchronous lifecycle", () => {
  it("starts a job, observes it non-terminal, and polls it to successful", async () => {
    const statusUrl = await startSlowJob(6);

    // The first read happens while the job is still working. pygeoapi calls
    // this `accepted`, not `running` — finding 0032.
    const first = await client.getJob(statusUrl);
    expect(first.terminal).toBe(false);
    expect(["accepted", "running"]).toContain(first.rawStatus);
    expect(first.jobId).not.toBe("");
    expect(first.processId).toBe("slow");

    const progress: (number | undefined)[] = [];
    const report = await client.pollJob(statusUrl, {
      onStatus: (status) => progress.push(status.progress),
      intervalMs: 500,
      timeoutMs: 60_000,
    });

    expect(report.outcome).toBe("terminal");
    expect(report.status?.status).toBe("successful");
    expect(report.pollCount).toBeGreaterThanOrEqual(1);
    // Progress is reported as it happens, which is the whole point of onStatus.
    expect(progress.length).toBe(report.pollCount);
    expect(progress.at(-1)).toBe(100);
  }, 90_000);

  it("reports that this server never sends Retry-After — finding 0033", async () => {
    const statusUrl = await startSlowJob(3);
    await client.waitForJob(statusUrl, { intervalMs: 500, timeoutMs: 60_000 });

    const polls = records("job-status");
    expect(polls.length).toBeGreaterThan(0);
    // If this ever goes red, pygeoapi started pacing clients and finding 0033
    // needs re-reading — which is exactly what the assertion is for.
    expect(polls.some((entry) => entry.retryAfterPresent)).toBe(false);
  }, 90_000);

  it("fetches the results of a finished job, unparsed", async () => {
    const statusUrl = await startSlowJob(2);
    const status = await client.waitForJob(statusUrl, { intervalMs: 500, timeoutMs: 60_000 });

    const results = await client.getResults(statusUrl, { status });

    expect(results.envelope.status).toBe(200);
    // The advertised `results` link is used, not a constructed path — pygeoapi
    // advertises it as the long OGC URI only.
    expect(results.route).toBe("advertised-link");
    // JSON came back because the client stated a preference. With a bare `*/*`
    // this endpoint answers `text/html` — finding 0036.
    expect(results.envelope.mediaType).toBe("application/json");

    // Unparsed and re-readable: the core hands the body over and stops.
    const body = await results.envelope.json();
    expect(body).toMatchObject({ id: "slept" });
  }, 90_000);

  it("refuses the results of a job that has not finished", async () => {
    const statusUrl = await startSlowJob(20);

    // pygeoapi answers 404 `ResultNotReady` here. A genuine refusal, so it
    // throws rather than degrading.
    await expect(client.getResults(statusUrl)).rejects.toBeInstanceOf(ProcessesError);

    await client.dismissJob(statusUrl);
  }, 90_000);

  it("returns a JobStatus for a failed job rather than throwing — T1", async () => {
    // The slow process rejects a negative duration, which fails the job rather
    // than the request.
    const execution = await client.execute("slow", {
      inputs: { seconds: -1 },
      outputs: {},
      mode: "async",
    });
    if (execution.kind !== "job") throw new Error("expected a job");

    const status = await client.waitForJob(execution.job.statusUrl, {
      intervalMs: 500,
      timeoutMs: 30_000,
    });

    expect(status.status).toBe("failed");
    expect(status.terminal).toBe(true);
    // The failure is prose in `message`; there is no `exception` member —
    // finding 0034.
    expect(status.message).toContain("must not be negative");
    expect(status.exception).toBeUndefined();
  }, 60_000);
});

describe("dismissal — the declared-versus-observed cell", () => {
  it("dismisses a running job, and the job then stops existing", async () => {
    const statusUrl = await startSlowJob(60);
    const before = await client.getJob(statusUrl);
    expect(before.terminal).toBe(false);

    const outcome = await client.dismissJob(statusUrl, { declaredDismiss: false });

    expect(outcome.kind).toBe("dismissed");
    if (outcome.kind !== "dismissed") throw new Error("unreachable");
    // pygeoapi returns the job document reporting `dismissed` — under
    // `Content-Type: text/html`, which is finding 0037 and why the parse is not
    // gated on the media type.
    expect(outcome.status?.status).toBe("dismissed");
    expect(outcome.envelope.mediaType).toBe("text/html");

    // Finding 0035: the job is deleted, not parked. A 404 is the normal end
    // state, which is why `JobNotFoundError` exists and why the poll loop
    // treats it as an ordinary ending.
    await expect(client.getJob(statusUrl)).rejects.toBeInstanceOf(JobNotFoundError);
  }, 90_000);

  it("dismisses an already-finished job just as readily", async () => {
    const statusUrl = await startSlowJob(2);
    await client.waitForJob(statusUrl, { intervalMs: 500, timeoutMs: 60_000 });

    const outcome = await client.dismissJob(statusUrl);

    expect(outcome.kind).toBe("dismissed");
    await expect(client.getJob(statusUrl)).rejects.toBeInstanceOf(JobNotFoundError);
  }, 90_000);

  it("answers a second dismissal with a 404, not an unsupported", async () => {
    const statusUrl = await startSlowJob(2);
    await client.waitForJob(statusUrl, { intervalMs: 500, timeoutMs: 60_000 });
    await client.dismissJob(statusUrl);

    // A 404 is a genuine refusal — the job is gone — and is distinct from the
    // 405 that would mean "this server cannot dismiss".
    await expect(client.dismissJob(statusUrl)).rejects.toBeInstanceOf(ProcessesError);
  }, 90_000);

  it("records dismiss as observed-but-undeclared, which is the finding", async () => {
    const statusUrl = await startSlowJob(30);
    const service = await client.inspect();

    // Finding 0006, asserted rather than remembered: the conformance document
    // declares no dismiss class…
    expect(service.capabilities.dismiss).toBe(false);
    // …and the server honours the request anyway. A client that gated on the
    // capability would have shipped "pygeoapi does not support dismiss".
    const outcome = await client.dismissJob(statusUrl, {
      declaredDismiss: service.capabilities.dismiss,
    });
    expect(outcome.kind).toBe("dismissed");

    const dismissals = records("job-dismissed");
    expect(dismissals.at(-1)).toMatchObject({
      status: 200,
      outcome: "dismissed",
      declaredDismiss: false,
    });
  }, 90_000);
});

describe("polling a dismissed job", () => {
  it("ends the loop cleanly rather than crashing", async () => {
    const statusUrl = await startSlowJob(60);

    const polling = client.pollJob(statusUrl, { intervalMs: 500, timeoutMs: 60_000 });
    // Dismiss out from under the loop, which is what a cancel button does.
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await client.dismissJob(statusUrl);

    const report = await polling;
    expect(report.outcome).toBe("dismissed-remotely");
    expect(report.statusSequence.at(-1)).toBe("404");
  }, 90_000);
});

describe("the job list", () => {
  it("lists jobs and reports job-list as advertised but undeclared", async () => {
    const statusUrl = await startSlowJob(2);
    await client.waitForJob(statusUrl, { intervalMs: 500, timeoutMs: 60_000 });

    const list = await client.listJobs();

    expect(list.jobs.length).toBeGreaterThan(0);
    expect(list.jobs.some((entry) => entry.jobId === statusUrl.split("/").pop())).toBe(true);
    // The link is advertised on the landing page…
    expect(records("job-list-link").at(-1)?.source).toBe("advertised");
    // …while the conformance document declares no job-list class. Finding 0006.
    expect((await client.inspect()).capabilities.jobList).toBe(false);
  }, 90_000);

  it("follows next when a limit is supplied", async () => {
    const list = await client.listJobs({ limit: 1, maxPages: 3 });

    // pygeoapi builds `next` with `offset=`; the walk follows the advertised
    // link rather than constructing one, so the parameter name costs nothing.
    expect(list.pageCount).toBeGreaterThan(1);
    expect(records("job-list").at(-1)?.advertisedPagination).toBe(true);
  }, 90_000);

  it("ignores ?processID= and ?status= — finding 0038, which is why we do not send them", async () => {
    // Asserted directly against the server rather than through the client,
    // because the client deliberately offers no filter arguments. A filter that
    // is silently ignored is worse than no filter.
    //
    // The proof is that the filtered response is *byte-for-byte the same page*
    // as the unfiltered one — same jobs, same order — including for a
    // `processID` that matches nothing on the server and a `status` no job in
    // the page has. A filter that worked at all would have to return fewer
    // jobs for at least one of those.
    //
    // Deliberately no dependence on the server's job history. An earlier
    // version asserted that the response carried more than one distinct status,
    // which is only true of a server that happens to have a failed job on this
    // page — and the page cannot be steered. pygeoapi caps `limit` at ten,
    // which the standard permits, but a job created seconds ago does not
    // reliably appear on the first page at all: starting one and re-reading
    // leaves the page unchanged. Recorded in finding 0038, which is also why
    // this test creates no jobs to set up its own assertion.
    const pageOf = async (query: string): Promise<string[]> => {
      const response = await send(`${CORS}/jobs?f=json${query}`, {
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await response.json()) as { jobs: { jobID: string }[] };
      return body.jobs.map((entry) => entry.jobID);
    };

    // The only precondition is that *some* job exists, which every earlier test
    // in this file has already guaranteed. That is a far weaker thing to depend
    // on than "a failed job is among the oldest ten", which is what the earlier
    // version needed and could not arrange.
    const unfiltered = await pageOf("");
    expect(unfiltered.length).toBeGreaterThan(0);

    for (const query of [
      "&status=failed",
      "&status=dismissed",
      "&processID=no-such-process-at-all",
      "&processID=slow",
    ]) {
      expect(await pageOf(query)).toEqual(unfiltered);
    }
  }, 60_000);
});

describe("the CORS-disabled port", () => {
  it("runs the same asynchronous path on :5081, which a browser could not", async () => {
    // Node ignores CORS entirely, so this proves the *protocol* works on 5081
    // and says nothing about a browser. What a browser would see is in the
    // Playwright spec — and on this port it is nothing at all, because 5081
    // sends no CORS headers and therefore fails the DELETE preflight outright.
    const nocors = createClient({ baseUrl: NOCORS });
    const statusUrl = await startSlowJob(2, nocors);
    const status = await nocors.waitForJob(statusUrl, { intervalMs: 500, timeoutMs: 60_000 });

    expect(status.status).toBe("successful");
    const outcome = await nocors.dismissJob(statusUrl);
    expect(outcome.kind).toBe("dismissed");
  }, 90_000);

  it("exposes no Location header to a browser on either port — findings 0002 and 0009", async () => {
    // Re-confirmed on the *job* endpoints rather than assumed to carry over
    // from the execution ones, which is what step zero question 8 asked for.
    for (const base of [CORS, NOCORS]) {
      const response = await send(`${base}/processes/slow/execution`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "respond-async" },
        body: JSON.stringify({ inputs: { seconds: 1 }, outputs: {} }),
        signal: AbortSignal.timeout(10_000),
      });

      expect(response.status).toBe(201);
      // The header is there for Node…
      expect(response.locationRaw).toBeDefined();
      // …and there is no `Access-Control-Expose-Headers`, so a browser cannot
      // read it. That is the whole of the T8 problem.
      expect(response.headers.get("access-control-expose-headers")).toBeNull();
    }
  }, 60_000);
});
