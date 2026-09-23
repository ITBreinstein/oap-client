/**
 * Shared test doubles for the relay integration: a hand-stepped scheduler, a
 * job status factory, and a way to let pending promises settle. No real time
 * is waited on — `advance()` runs due callbacks in order, and `settle()`
 * yields one zero-delay macrotask so awaited promises resolve.
 */

import type { JobState, JobStatus } from "@breinstein/oap-client";
import type { Schedule } from "../../src/relay/doorbells.js";

export interface ManualSchedule {
  readonly schedule: Schedule;
  /** Run every callback due within `ms`, in time order, settling between each. */
  advance(ms: number): Promise<void>;
  /** Callbacks still waiting, and when. */
  pending(): number[];
}

/**
 * Yield one macrotask, so promises already resolved get to run their
 * continuations. Zero delay: nothing waits on the clock.
 */
export function settle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export function manualSchedule(): ManualSchedule {
  let now = 0;
  let timers: { at: number; run: () => void; cancelled: boolean }[] = [];
  return {
    schedule: (run, ms) => {
      const timer = { at: now + ms, run, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    async advance(ms) {
      const target = now + ms;
      for (;;) {
        timers = timers.filter((timer) => !timer.cancelled);
        const due = timers.filter((timer) => timer.at <= target).sort((a, b) => a.at - b.at)[0];
        if (due === undefined) break;
        timers = timers.filter((timer) => timer !== due);
        now = due.at;
        due.run();
        await settle();
      }
      now = target;
      await settle();
    },
    pending: () => timers.filter((timer) => !timer.cancelled).map((timer) => timer.at - now),
  };
}

const TERMINAL: ReadonlySet<JobState> = new Set(["successful", "failed", "dismissed"]);

export function status(state: JobState, url = "http://ogc.test/jobs/1"): JobStatus {
  return {
    jobId: url.split("/").pop() ?? "1",
    status: state,
    rawStatus: state,
    statusRecognised: true,
    links: [],
    url,
    terminal: TERMINAL.has(state),
    warnings: [],
    unrecognisedKeys: [],
  };
}
