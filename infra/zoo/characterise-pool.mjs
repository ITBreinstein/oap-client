#!/usr/bin/env node
/**
 * Characterise ZOO-Project's asynchronous worker pool. Evidence for finding
 * 0044; not part of any test lane, and deliberately not a vitest file.
 *
 *   node infra/zoo/characterise-pool.mjs            # default sweep
 *   node infra/zoo/characterise-pool.mjs 4 4 4 4 4  # your own waves
 *
 * ## What it measures
 *
 * Each argument is one *wave*: that many `longProcess` jobs submitted at once,
 * then polled until every one of them reaches a terminal status or the cap
 * expires. Around each wave it counts the `zoo_loader_fpm` children inside the
 * worker container. That count is the whole point — the hypothesis this script
 * exists to test is that the count only ever goes down.
 *
 * Read the result as: a wave whose jobs all finish in about 21 seconds ran
 * fully in parallel; a wave that takes a multiple of that queued; and a wave
 * that reports `ORPHANED` found a deployment with no workers left, which
 * accepts jobs, answers `201`, and then leaves them in `running` for ever.
 *
 * ## Two ways to get a wrong answer
 *
 * 1. **Instrumenting during a wave.** An earlier version polled RabbitMQ every
 *    three seconds through `docker exec rabbitmqctl`, which boots an Erlang VM
 *    each time, on the same small Docker VM as the server. It measured its own
 *    load: single jobs took twice as long as they should. `docker exec` here
 *    runs only at wave boundaries, never while jobs are in flight.
 * 2. **Not starting from a known pool.** The pool never recovers, so every
 *    wave changes the conditions for the next one and results from a long
 *    session are not comparable. Restart the workers first:
 *
 *        ./infra/zoo/zoo.sh refresh
 *
 * ## What a clean run looked like on 2026-09-22
 *
 * Fresh pool of 20, then six identical waves of four:
 *
 *     N=4: pool 20 -> 18, wall 21.8s, 4/4 successful
 *     N=4: pool 18 -> 14, wall 21.0s, 4/4 successful
 *     N=4: pool 14 -> 10, wall 21.5s, 4/4 successful
 *     N=4: pool 10 ->  5, wall 41.5s, 4/4 successful
 *     N=4: pool  5 ->  1, wall 90.6s, 2/4 successful
 *     N=4: pool  1 ->  1, wall 90.4s, 0/4 successful
 */

import { execFileSync } from "node:child_process";

const ZOO = process.env["ZOO_URL"] ?? "http://localhost:5090/ogc-api";
const CONTAINER = process.env["ZOO_FPM_CONTAINER"] ?? "oap-zoo-zoofpm-1";

/** `longProcess` sleeps 1 s twenty times, so a wave that ran in parallel lands near 21 s. */
const CAP_MS = 90_000;
const POLL_MS = 1_000;

const DEFAULT_PLAN = [1, 2, 3, 4, 6];
const USAGE = `Usage: node infra/zoo/characterise-pool.mjs [waveSize ...]

Runs one wave of concurrent longProcess jobs per argument and reports how many
completed, to characterise the async worker pool (finding 0044).

  waveSize   positive integer; default plan is ${DEFAULT_PLAN.join(" ")}

This CONSUMES async workers and leaves the deployment degraded. Run
./infra/zoo/zoo.sh refresh afterwards.`;

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(USAGE);
  process.exit(0);
}

// Reject anything that is not a wave size rather than falling back to the
// default plan. The old code ran `.map(Number)` and, on any unparseable
// argument, silently ran the full sixteen-job default — so `--help` depleted
// the pool it exists to measure. An unrecognised argument is a mistake, and
// the destructive reading of a mistake is the wrong one.
const waves = argv.map((arg) => [arg, Number(arg)]);
const bad = waves.filter(([, n]) => !Number.isInteger(n) || n <= 0).map(([arg]) => arg);
if (bad.length > 0) {
  console.error(`Not a wave size: ${bad.join(", ")}\n\n${USAGE}`);
  process.exit(2);
}
const plan = waves.length > 0 ? waves.map(([, n]) => n) : DEFAULT_PLAN;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Children of the async master process — the pool `async_worker` sizes once at
 * start-up. Counted as the largest sibling group, because the master is not
 * identifiable by name: every process in the tree is the same binary.
 */
function poolSize() {
  try {
    const out = execFileSync(
      "docker",
      ["exec", CONTAINER, "sh", "-c", "ps ax -o pid,ppid,args | grep '[z]oo_loader_fpm'"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    const siblings = new Map();
    for (const line of out.trim().split("\n")) {
      const ppid = line.trim().split(/\s+/)[1];
      siblings.set(ppid, (siblings.get(ppid) ?? 0) + 1);
    }
    return Math.max(0, ...siblings.values());
  } catch {
    return null;
  }
}

async function submit() {
  const at = Date.now();
  const response = await fetch(`${ZOO}/processes/longProcess/execution`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Prefer: "respond-async",
    },
    // ZOO refuses a body carrying only `inputs` — finding 0025.
    body: JSON.stringify({
      inputs: { sid: 1 },
      outputs: { Result: { transmissionMode: "value" } },
    }),
  });
  const body = await response.json();
  return {
    at,
    jobId: body.jobID,
    statusUrl: response.headers.get("location") ?? `${ZOO}/jobs/${body.jobID}`,
  };
}

async function track(job, t0) {
  const record = {
    jobId: String(job.jobId).slice(0, 8),
    firstProgressMs: null,
    doneMs: null,
    finalStatus: null,
  };
  for (;;) {
    await sleep(POLL_MS);
    const now = Date.now() - t0;
    if (now > CAP_MS) {
      record.finalStatus = `ORPHANED@${CAP_MS / 1000}s`;
      return record;
    }
    let body;
    try {
      body = await (await fetch(job.statusUrl, { headers: { Accept: "application/json" } })).json();
    } catch {
      continue; // a dropped connection mid-poll is finding 0043, not a result
    }
    if (record.firstProgressMs === null && Number(body.progress) > 0) record.firstProgressMs = now;
    if (["successful", "failed", "dismissed"].includes(body.status)) {
      record.doneMs = now;
      record.finalStatus = body.status;
      return record;
    }
  }
}

const results = [];
for (const n of plan) {
  const before = poolSize();
  const t0 = Date.now();
  const submitted = await Promise.all(Array.from({ length: n }, () => submit()));
  const records = await Promise.all(submitted.map((job) => track(job, t0)));
  const wallMs = Date.now() - t0;

  // Leave nothing running: an orphan the next wave inherits is a contaminated
  // measurement, and an orphan left behind is a puzzle for the next person.
  for (const job of submitted) {
    try {
      await fetch(job.statusUrl, { method: "DELETE" });
    } catch {
      /* already gone */
    }
  }
  await sleep(8_000);

  const after = poolSize();
  const ok = records.filter((r) => r.finalStatus === "successful").length;
  results.push({ n, wallMs, poolBefore: before, poolAfter: after, records });
  console.error(
    `N=${n}: pool ${before ?? "?"} -> ${after ?? "?"}, ` +
      `wall ${(wallMs / 1000).toFixed(1)}s, ${ok}/${n} successful`,
  );
}

console.log(JSON.stringify(results, null, 2));
