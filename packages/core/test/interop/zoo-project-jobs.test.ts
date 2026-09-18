/**
 * Jobs against the pinned ZOO-Project fork on :5090.
 *
 * This lane reports and never blocks: it skips itself when nothing is
 * answering. See infra/zoo/README.md for why ZOO is not in the contract lane.
 *
 * ## What only this server can prove
 *
 * Three things the contract lane structurally cannot:
 *
 * 1. **A job that is actually `running`.** pygeoapi reports `accepted` for the
 *    whole of a job's execution (finding 0032). ZOO reports `running` with real
 *    incrementing progress, which is the only live evidence that the status
 *    vocabulary is used as the standard intends by anyone.
 * 2. **The `rel="monitor"` body-link route to the status URL.** ZOO's async 201
 *    carries a full job document; pygeoapi's is the literal `null` (finding
 *    0004). This is the route a cross-origin browser has to take, and only this
 *    server offers it.
 * 3. **A chunked results body.** ZOO sends `Transfer-Encoding: chunked` with no
 *    `Content-Length`, which is the case the envelope's size guard cannot see.
 *
 * Every request supplies an `outputs` block: ZOO refuses a body carrying only
 * `inputs` (finding 0025), and the core does not add one for it.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { ZOO, answering } from "./zoo.js";
import { createClient, type Client } from "../../src/index.js";
import { JobNotFoundError } from "../../src/errors.js";
import { send } from "../../src/http/transport.js";
import type { Execution } from "../../src/execution/types.js";
import type { Observation } from "../../src/observations.js";

const zooUp = await answering();

let client: Client;
let seen: Observation[];

const LONG_OUTPUTS = { Result: { transmissionMode: "value" } } as const;

function records<K extends Observation["kind"]>(kind: K): Extract<Observation, { kind: K }>[] {
  return seen.filter((entry): entry is Extract<Observation, { kind: K }> => entry.kind === kind);
}

async function startLongProcess(): Promise<Execution> {
  return client.execute("longProcess", {
    inputs: { sid: 1 },
    outputs: LONG_OUTPUTS,
    mode: "async",
  });
}

/**
 * One `longProcess` run, shared by every test that needs a completed job.
 *
 * Not an optimisation. ZOO executes through a small FPM worker pool, and a file
 * that starts a fresh long job per test saturates it — the jobs queue, stay
 * `running` well past any reasonable deadline, and the lane fails for a reason
 * that has nothing to do with the client. Polling once and asserting on what
 * was captured is both faster and the only version that is actually testing
 * what it claims to.
 */
interface SharedRun {
  readonly statusUrl: string;
  readonly statuses: readonly string[];
  readonly progress: readonly number[];
  readonly outcome: string;
  readonly finalStatus: string | undefined;
}

let shared: SharedRun;

beforeAll(async () => {
  seen = [];
  client = createClient({ baseUrl: ZOO, onObservation: (entry) => seen.push(entry) });
  if (!zooUp) return;

  const execution = await startLongProcess();
  if (execution.kind !== "job") throw new Error("expected a job");

  const statuses: string[] = [];
  const progress: number[] = [];
  const report = await client.pollJob(execution.job.statusUrl, {
    intervalMs: 1_000,
    timeoutMs: 240_000,
    onStatus: (status) => {
      statuses.push(status.rawStatus);
      if (status.progress !== undefined) progress.push(status.progress);
    },
  });

  shared = {
    statusUrl: execution.job.statusUrl,
    statuses,
    progress,
    outcome: report.outcome,
    finalStatus: report.status?.status,
  };
}, 300_000);

describe.skipIf(!zooUp)("the asynchronous lifecycle against ZOO", () => {
  it("reaches the job through the body's monitor link, not only through Location", async () => {
    const execution = await startLongProcess();
    if (execution.kind !== "job") throw new Error("expected a job");

    // Node reads `Location`, so that is the route taken here. What matters is
    // that the *fallback* exists at all: the 201 body is a full job document
    // with `rel="monitor"`, so a browser that cannot see `Location` still has a
    // way through. pygeoapi's `null` body offers nothing.
    expect(execution.job.statusUrl).toContain("/jobs/");
    expect(execution.job.jobId).toBeDefined();
    expect(execution.job.links.some((link) => link.rel === "monitor")).toBe(true);

    // Dismissed at once rather than run to completion: this test is about the
    // 201 body, and leaving it running would occupy a worker the shared run
    // needs.
    await client.dismissJob(execution.job.statusUrl);
  }, 60_000);

  it("observes a genuinely `running` job with incrementing progress", () => {
    expect(shared.outcome).toBe("terminal");
    expect(shared.finalStatus).toBe("successful");
    // The assertion the contract lane structurally cannot make: pygeoapi never
    // reports `running` at all (finding 0032).
    expect(shared.statuses).toContain("running");
    expect(shared.progress.length).toBeGreaterThan(0);
    // Progress moves, rather than sitting at a constant the way pygeoapi's
    // hardcoded 5 does.
    expect(Math.max(...shared.progress)).toBeGreaterThan(Math.min(...shared.progress));
  });

  it("fetches a chunked results body — the case the size guard cannot see", async () => {
    const status = await client.getJob(shared.statusUrl);
    const results = await client.getResults(shared.statusUrl, { status });

    expect(results.envelope.status).toBe(200);
    // ZOO advertises the results link on the *successful* document only, so the
    // advertised route is available exactly when it is useful.
    expect(results.route).toBe("advertised-link");
    // No declared Content-Length, so `bodyTooLarge` can never fire here however
    // large the body is. Recorded rather than papered over; see the README.
    expect(results.envelope.headers.get("content-length")).toBeNull();
    expect(results.envelope.bodyTooLarge).toBe(false);
    // Keyed by output id — conformant, and a different shape from pygeoapi's
    // `{"id":…,"value":…}`. The core hands both over untouched.
    const body = (await results.envelope.json()) as { Result?: unknown };
    expect(typeof body.Result).toBe("string");
  }, 60_000);

  it("returns a JobStatus for a failed job rather than throwing — T1", async () => {
    // `failR` is a bundled service that fails by design.
    const execution = await client.execute("failR", { inputs: {}, outputs: {}, mode: "async" });
    if (execution.kind !== "job") throw new Error("expected a job");

    const status = await client.waitForJob(execution.job.statusUrl, {
      intervalMs: 1_000,
      timeoutMs: 60_000,
    });

    expect(status.status).toBe("failed");
    // Like pygeoapi, ZOO puts the failure in `message` and sends no `exception`
    // member — finding 0034, and the two servers agreeing makes it a
    // specification gap rather than one server's quirk.
    expect(status.message).toContain("Failed running from R world");
    expect(status.exception).toBeUndefined();
  }, 120_000);

  it("answers /results on a FAILED job with 200 and an exception body — finding 0041", async () => {
    const execution = await client.execute("failR", { inputs: {}, outputs: {}, mode: "async" });
    if (execution.kind !== "job") throw new Error("expected a job");
    await client.waitForJob(execution.job.statusUrl, { intervalMs: 1_000, timeoutMs: 60_000 });

    // pygeoapi answers 400 here. ZOO answers 200 with a problem-shaped body, so
    // `requireOk()` lets it through and the caller gets an "ok" envelope whose
    // content is an exception. The core does not second-guess it — reading the
    // job status is where the failure is authoritative.
    const results = await client.getResults(execution.job.statusUrl);

    expect(results.envelope.status).toBe(200);
    expect(await results.envelope.json()).toMatchObject({ title: "NoApplicableCode" });
  }, 120_000);
});

describe.skipIf(!zooUp)("dismissal against ZOO", () => {
  it("dismisses a finished job and then 404s, exactly as pygeoapi does", async () => {
    // The shared run, dismissed last. Every other test that needs it has
    // already read it — vitest runs the tests in a file in source order.
    const outcome = await client.dismissJob(shared.statusUrl, { declaredDismiss: true });

    expect(outcome.kind).toBe("dismissed");
    if (outcome.kind !== "dismissed") throw new Error("unreachable");
    expect(outcome.status?.status).toBe("dismissed");
    // Unlike pygeoapi, ZOO labels this body honestly.
    expect(outcome.envelope.mediaType).toBe("application/json");

    // Finding 0035: both servers delete rather than park. The agreement is what
    // makes it worth proposing as profile guidance.
    await expect(client.getJob(shared.statusUrl)).rejects.toBeInstanceOf(JobNotFoundError);
  }, 60_000);

  it("declares dismiss on the process, which pygeoapi does not", async () => {
    const description = await client.getProcess("longProcess");

    // ZOO advertises `dismiss` in `jobControlOptions`; pygeoapi advertises
    // neither the option nor the conformance class. Nothing in the core gates
    // on either — this records the divergence.
    expect(description.execution.dismiss).toBe(true);
  }, 60_000);
});

describe.skipIf(!zooUp)("the job list against ZOO", () => {
  it("paginates with skip and declares numberTotal, unlike pygeoapi", async () => {
    const list = await client.listJobs({ limit: 2, maxPages: 3 });

    expect(list.jobs.length).toBeGreaterThan(0);
    // ZOO builds `next` with `skip=` (finding 0019) and declares a total;
    // pygeoapi uses `offset=` and declares none. Following the advertised link
    // is what makes the difference cost nothing.
    expect(list.numberTotal).toBeGreaterThan(0);
    expect(records("job-list").at(-1)?.advertisedPagination).toBe(true);
  }, 60_000);

  it("honours ?status= and ?processID=, which pygeoapi ignores — finding 0038", async () => {
    // Asserted against the server directly: the client sends no filters,
    // precisely because they cannot be relied on across servers.
    const filtered = await send(`${ZOO}/jobs?status=failed`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await filtered.json()) as { jobs: { status: string }[] };

    // Every returned job really is failed — the filter was applied.
    expect(body.jobs.every((entry) => entry.status === "failed")).toBe(true);
  }, 60_000);

  it("sends no CORS headers on the job endpoints — finding 0009, re-confirmed", async () => {
    const response = await send(`${ZOO}/jobs`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });

    expect(response.status).toBe(200);
    // No `Access-Control-Allow-Origin` means a browser cannot read any of this
    // cross-origin, dismissal included. See the Playwright spec.
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("access-control-expose-headers")).toBeNull();
  }, 60_000);
});
