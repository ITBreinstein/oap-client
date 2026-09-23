/**
 * Watchdog: does ZOO's job list agree with the job's own document?
 *
 * Finding 0044 records the two disagreeing on an **orphaned** job —
 * `progress: 100` and a success message in the list, `progress: 0` and "No
 * message provided" in the document, for the same job in the same second.
 *
 * This file is the measurement that decided where that belongs. It runs on a
 * **freshly restarted** ZOO with a full pool and compares the two
 * representations of one job twice: while it is genuinely running, and after
 * it has genuinely completed. They agreed, which is why the split was folded
 * into 0044 as a consequence of the capacity decay rather than carried as its
 * own finding — the number it briefly had, 0046, is retired.
 *
 * One job, read twice, rather than two jobs read once each. The first version
 * of this file started two jobs and polled the second to completion before
 * comparing — by which time the "running" job had finished too, so the
 * comparison it claimed to make was not the comparison it made. Timing is the
 * whole point here, so it has to be arranged rather than assumed.
 *
 * These are ordinary assertions, not `it.fails`: the expected outcome is that
 * a healthy server agrees with itself, and it now stays here as a regression
 * guard on that conclusion. If it ever goes red on a healthy deployment, the
 * split is **not** a consequence of 0044, it has to come back out as its own
 * finding, and the `listJobs()` recovery that finding 0039 depends on needs
 * revisiting — because that recovery assumes the list tells the truth.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZOO, answering } from "../interop/zoo.js";
import { createClient, type Client, type JobStatus } from "../../src/index.js";

const zooUp = await answering();

/** `longProcess` sleeps 1 s twenty times, so this lands well inside its run. */
const READ_RUNNING_AFTER_MS = 4_000;

let client: Client;
let statusUrl: string;

/** The same job read two ways. `listed` is undefined when no page walked held it. */
interface BothViews {
  readonly document: JobStatus;
  readonly listed: JobStatus | undefined;
}

async function bothViews(): Promise<BothViews> {
  // The document first and the list immediately after, so the two reads are as
  // close together as the network allows. A gap here would make an ordinary
  // status change look like a disagreement.
  const document = await client.getJob(statusUrl);
  const list = await client.listJobs({ limit: 50, maxPages: 20 });
  return { document, listed: list.jobs.find((entry) => entry.jobId === document.jobId) };
}

function report(label: string, views: BothViews): void {
  // Printed unconditionally: this lane exists to produce evidence for a
  // finding, and the numbers are wanted whether the assertion passes or not.
  const { document: d, listed: l } = views;
  console.log(
    `[0044] ${label}: document status=${d.status} progress=${String(d.progress)} ` +
      `message=${JSON.stringify(d.message)} | list status=${String(l?.status)} ` +
      `progress=${String(l?.progress)} message=${JSON.stringify(l?.message)}`,
  );
}

let running: BothViews;
let completed: BothViews;

beforeAll(async () => {
  if (!zooUp) return;
  client = createClient({ baseUrl: ZOO });

  const execution = await client.execute("longProcess", {
    inputs: { sid: 1 },
    // ZOO refuses a body carrying only `inputs` — finding 0025.
    outputs: { Result: { transmissionMode: "value" } },
    mode: "async",
  });
  if (execution.kind !== "job") throw new Error("expected a job");
  statusUrl = execution.job.statusUrl;

  await new Promise((resolve) => setTimeout(resolve, READ_RUNNING_AFTER_MS));
  running = await bothViews();
  report("running", running);

  await client.pollJob(statusUrl, { intervalMs: 2_000, timeoutMs: 180_000 });
  completed = await bothViews();
  report("completed", completed);
}, 300_000);

afterAll(async () => {
  // `zooUp` is the only guard needed: it is the one condition under which
  // `beforeAll` returns before assigning `statusUrl`.
  if (!zooUp) return;
  // The job holds a worker until it is dismissed, and workers do not come back
  // (finding 0044). Leaving one behind would cost the next run.
  await client.dismissJob(statusUrl).catch(() => undefined);
});

describe.skipIf(!zooUp)("job list versus job document on a healthy ZOO — finding 0044", () => {
  it("was actually read mid-run, or this file proves nothing", () => {
    // Guard on the fixture, not on the server. If `longProcess` ever gets
    // faster, or the read lands late, the comparison below is between two
    // finished jobs and would pass for the wrong reason.
    expect(running.document.terminal).toBe(false);
  });

  it("puts the job in its own job list at all", () => {
    // Separate from the agreement assertions because a missing job is a
    // different defect from a contradictory one — and it is the one that would
    // break finding 0039's `listJobs()` recovery outright.
    expect(running.listed, "running job absent from the job list").toBeDefined();
    expect(completed.listed, "completed job absent from the job list").toBeDefined();
  });

  it("agrees about a job that is still running", () => {
    expect(running.listed?.status).toBe(running.document.status);
    // `progress` moves on its own, so an exact match would be an assertion
    // about timing rather than about consistency. What 0044 saw on an orphan
    // was 100 against 0 — a contradiction about whether the work finished.
    const gap = Math.abs((running.listed?.progress ?? 0) - (running.document.progress ?? 0));
    expect(gap).toBeLessThan(50);
  });

  it("agrees about a job that has completed", () => {
    expect(completed.listed?.status).toBe(completed.document.status);
    expect(completed.listed?.terminal).toBe(completed.document.terminal);
    // A finished job is not moving, so here the two must agree exactly.
    expect(completed.listed?.progress).toBe(completed.document.progress);
    expect(completed.listed?.message).toBe(completed.document.message);
  });
});
