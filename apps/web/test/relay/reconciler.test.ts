// @vitest-environment node
/**
 * Reconciliation: state comes from polls, and only from polls. Every delivery
 * pathology a callback channel has — duplicates, reordering, loss, a relay
 * restart — has to leave the job showing what the server says.
 */

import { JobNotFoundError, type JobState, type JobStatus } from "@breinstein/oap-client";
import { describe, expect, it } from "vitest";
import { JobReconciler, type TrackedJob } from "../../src/relay/reconciler.js";
import { manualSchedule, settle, status } from "./harness.js";

const JOB = "http://ogc.test/jobs/1";

/** A server whose job goes through `states`, one per read, then stays on the last. */
function server(states: readonly JobState[]) {
  const reads: string[] = [];
  let index = 0;
  const readJob = (url: string): Promise<JobStatus> => {
    reads.push(url);
    const state = states[Math.min(index, states.length - 1)] ?? "accepted";
    index += 1;
    return Promise.resolve(status(state, url));
  };
  return { readJob, reads };
}

function reconciler(readJob: (url: string) => Promise<JobStatus>) {
  const timers = manualSchedule();
  const seen: TrackedJob[] = [];
  const instance = new JobReconciler({
    readJob,
    onChange: (job) => seen.push(job),
    schedule: timers.schedule,
    baselineMs: 2_000,
    maxIntervalMs: 8_000,
    coalesceMs: 250,
  });
  const current = (url = JOB) => instance.jobs().find((job) => job.statusUrl === url);
  return { instance, timers, seen, current };
}

describe("JobReconciler", () => {
  it("polls as soon as a job is tracked, and takes its state from the server", async () => {
    const { readJob, reads } = server(["accepted"]);
    const { instance, current } = reconciler(readJob);

    instance.track(JOB, "ref-1");
    await settle();

    expect(reads).toEqual([JOB]);
    expect(current()?.status?.status).toBe("accepted");
    expect(current()?.ref).toBe("ref-1");
    instance.dispose();
  });

  it("never sets state from a doorbell — it only moves the next poll earlier", async () => {
    const { readJob, reads } = server(["accepted", "accepted", "successful"]);
    const { instance, timers, current } = reconciler(readJob);
    instance.track(JOB, "ref-1");
    await settle();

    instance.doorbell("ref-1");
    // Rung, but not yet polled: the status is still the server's last answer.
    expect(current()?.status?.status).toBe("accepted");
    expect(current()?.doorbells).toBe(1);

    await timers.advance(250);
    expect(reads).toHaveLength(2);
    expect(current()?.status?.status).toBe("accepted");
    instance.dispose();
  });

  it("coalesces a burst of doorbells into one poll — duplicated callbacks", async () => {
    const { readJob, reads } = server(["accepted"]);
    const { instance, timers } = reconciler(readJob);
    instance.track(JOB, "ref-1");
    await settle();

    for (let i = 0; i < 5; i += 1) instance.doorbell("ref-1");
    await timers.advance(250);

    expect(reads).toHaveLength(2);
    instance.dispose();
  });

  it("folds doorbells that arrive during a poll into exactly one more poll", async () => {
    let release: (() => void) | undefined;
    const reads: string[] = [];
    const readJob = (url: string): Promise<JobStatus> => {
      reads.push(url);
      if (reads.length === 1) {
        return new Promise((resolve) => {
          release = () => {
            resolve(status("accepted", url));
          };
        });
      }
      return Promise.resolve(status("accepted", url));
    };
    const { instance, timers } = reconciler(readJob);
    instance.track(JOB, "ref-1");

    instance.doorbell("ref-1");
    instance.doorbell("ref-1");
    instance.doorbell("ref-1");
    release?.();
    await settle();
    await timers.advance(250);

    expect(reads).toHaveLength(2);
    instance.dispose();
  });

  it("finds a finished job with no doorbell at all — a missed callback", async () => {
    const { readJob, reads } = server(["accepted", "accepted", "successful"]);
    const { instance, timers, current } = reconciler(readJob);
    instance.track(JOB);
    await settle();

    await timers.advance(2_000);
    await timers.advance(3_000);

    expect(reads).toHaveLength(3);
    expect(current()?.status?.status).toBe("successful");
    expect(current()?.settled).toBe(true);
    expect(timers.pending()).toEqual([]);
    instance.dispose();
  });

  it("ignores a doorbell that arrives after the job settled — a reordered callback", async () => {
    const { readJob, reads } = server(["successful"]);
    const { instance, timers, current } = reconciler(readJob);
    instance.track(JOB, "ref-1");
    await settle();

    // An in-progress callback delivered late, after the terminal read.
    instance.doorbell("ref-1");
    await timers.advance(10_000);

    expect(reads).toHaveLength(1);
    expect(current()?.status?.status).toBe("successful");
    instance.dispose();
  });

  it("ignores a doorbell for a ref it does not know", async () => {
    const { readJob, reads } = server(["accepted"]);
    const { instance, timers } = reconciler(readJob);
    instance.track(JOB, "ref-1");
    await settle();

    instance.doorbell("someone-else");
    await timers.advance(250);

    expect(reads).toHaveLength(1);
    instance.dispose();
  });

  it("on reconnect, reads every unsettled job once — a relay restart mid-job", async () => {
    const reads: string[] = [];
    const states = new Map<string, JobState>([
      ["http://ogc.test/jobs/running", "accepted"],
      ["http://ogc.test/jobs/done", "successful"],
    ]);
    const readJob = (url: string): Promise<JobStatus> => {
      reads.push(url);
      return Promise.resolve(status(states.get(url) ?? "accepted", url));
    };
    const { instance, timers, current } = reconciler(readJob);
    instance.track("http://ogc.test/jobs/running", "ref-a");
    instance.track("http://ogc.test/jobs/done", "ref-b");
    await settle();
    reads.length = 0;

    // The relay restarted while the job ran: its success callback went to a
    // relay that no longer knew the token, so no doorbell ever comes.
    states.set("http://ogc.test/jobs/running", "successful");
    instance.reconnected();
    await timers.advance(250);

    expect(reads).toEqual(["http://ogc.test/jobs/running"]);
    expect(current("http://ogc.test/jobs/running")?.status?.status).toBe("successful");
    instance.dispose();
  });

  it("marks a job gone on 404, and stops polling it (finding 0035)", async () => {
    const readJob = (url: string): Promise<JobStatus> => Promise.reject(new JobNotFoundError(url));
    const { instance, timers, current } = reconciler(readJob);
    instance.track(JOB);
    await settle();

    expect(current()?.gone).toBe(true);
    expect(current()?.settled).toBe(true);
    expect(timers.pending()).toEqual([]);
    instance.dispose();
  });

  it("keeps the last known state through a failed read, and tries again", async () => {
    let fail = false;
    const readJob = (url: string): Promise<JobStatus> =>
      fail
        ? Promise.reject(new TypeError("network down"))
        : Promise.resolve(status("accepted", url));
    const { instance, timers, current } = reconciler(readJob);
    instance.track(JOB);
    await settle();

    fail = true;
    await timers.advance(2_000);
    expect(current()?.status?.status).toBe("accepted");
    expect(current()?.lastError).toBe("network down");
    expect(timers.pending()).toHaveLength(1);
    instance.dispose();
  });

  it("backs off the baseline poll, up to the cap", async () => {
    const { readJob } = server(["accepted"]);
    const { instance, timers } = reconciler(readJob);
    instance.track(JOB);
    await settle();

    const waits: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const [next] = timers.pending();
      if (next === undefined) throw new Error("expected a pending poll");
      waits.push(next);
      await timers.advance(next);
    }
    expect(waits).toEqual([2_000, 3_000, 4_500, 6_750, 8_000]);
    instance.dispose();
  });
});
