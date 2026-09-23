/**
 * Job reconciliation: the only place a job's state is set, and it is set from
 * one source — a status read from the OGC server.
 *
 * Doorbells and stream reconnects do not carry state and do not set it. They
 * move the next poll earlier, and that is all. Which is why every awkward
 * delivery case is survivable without special handling:
 *
 * | What happened                     | What the reconciler does                     |
 * | --------------------------------- | -------------------------------------------- |
 * | duplicated callback               | a second early poll, coalesced into the first |
 * | reordered callback                | polls; the server's current answer wins      |
 * | missed callback                   | nothing; the baseline poll finds the change  |
 * | callback for a settled job        | ignored                                      |
 * | relay restart, stream reconnect   | polls every unsettled job once, then carries on |
 * | relay switched off entirely       | baseline polling only — slower, still right  |
 *
 * **Coalescing**: per job, at most one poll is in
 * flight, and any number of doorbells that arrive while one is pending or in
 * flight become exactly one more poll. ZOO rings once a second for a running
 * job (finding 0048); this keeps that from becoming a poll a second.
 */

import { JobNotFoundError, type JobStatus } from "@breinstein/oap-client";
import { systemSchedule, type Schedule } from "./doorbells.js";

export interface TrackedJob {
  readonly statusUrl: string;
  /** The relay registration, when the job has a doorbell. */
  readonly ref: string | undefined;
  /** The server's word, from the most recent successful read. Never a callback's. */
  readonly status: JobStatus | undefined;
  readonly polls: number;
  readonly doorbells: number;
  readonly lastError: string | undefined;
  /** No more polls: terminal, or gone from the server. */
  readonly settled: boolean;
  /** The server answered 404: dismissed or expired (finding 0035). */
  readonly gone: boolean;
}

export interface ReconcilerOptions {
  readonly readJob: (statusUrl: string, signal: AbortSignal) => Promise<JobStatus>;
  readonly onChange: (job: TrackedJob) => void;
  readonly schedule?: Schedule | undefined;
  /** First baseline interval; it grows by half each poll up to `maxIntervalMs`. */
  readonly baselineMs?: number | undefined;
  readonly maxIntervalMs?: number | undefined;
  /** How long an early poll waits for more doorbells to fold into it. */
  readonly coalesceMs?: number | undefined;
}

export const BASELINE_MS = 2_000;
export const MAX_INTERVAL_MS = 15_000;
export const COALESCE_MS = 250;

interface Entry {
  job: TrackedJob;
  interval: number;
  cancelTimer: (() => void) | undefined;
  /** What the pending timer is for. An early poll is never pushed back by a baseline one. */
  timerKind: "baseline" | "early" | undefined;
  inFlight: boolean;
  /** A doorbell arrived while a poll was in flight: poll once more after it. */
  again: boolean;
}

export class JobReconciler {
  readonly #options: ReconcilerOptions;
  readonly #schedule: Schedule;
  readonly #baselineMs: number;
  readonly #maxIntervalMs: number;
  readonly #coalesceMs: number;
  readonly #entries = new Map<string, Entry>();
  readonly #byRef = new Map<string, string>();
  readonly #abort = new AbortController();

  constructor(options: ReconcilerOptions) {
    this.#options = options;
    this.#schedule = options.schedule ?? systemSchedule;
    this.#baselineMs = options.baselineMs ?? BASELINE_MS;
    this.#maxIntervalMs = options.maxIntervalMs ?? MAX_INTERVAL_MS;
    this.#coalesceMs = options.coalesceMs ?? COALESCE_MS;
  }

  /** Start reconciling a job. Polls straight away. */
  track(statusUrl: string, ref?: string): void {
    const existing = this.#entries.get(statusUrl);
    if (existing !== undefined) {
      if (ref !== undefined) this.#attach(existing, ref);
      return;
    }
    const entry: Entry = {
      job: {
        statusUrl,
        ref: undefined,
        status: undefined,
        polls: 0,
        doorbells: 0,
        lastError: undefined,
        settled: false,
        gone: false,
      },
      interval: this.#baselineMs,
      cancelTimer: undefined,
      timerKind: undefined,
      inFlight: false,
      again: false,
    };
    this.#entries.set(statusUrl, entry);
    if (ref !== undefined) this.#attach(entry, ref);
    void this.#poll(entry);
  }

  /** The relay rang for `ref`. Unknown refs are ignored: nothing to reconcile. */
  doorbell(ref: string): void {
    const statusUrl = this.#byRef.get(ref);
    const entry = statusUrl === undefined ? undefined : this.#entries.get(statusUrl);
    if (entry === undefined || entry.job.settled) return;
    this.#update(entry, { doorbells: entry.job.doorbells + 1 });
    this.#pollEarly(entry);
  }

  /**
   * The doorbell stream (re)opened. Anything rung while it was down is lost,
   * so every unsettled job is read once, now.
   */
  reconnected(): void {
    for (const entry of this.#entries.values()) {
      if (!entry.job.settled) this.#pollEarly(entry);
    }
  }

  jobs(): TrackedJob[] {
    return [...this.#entries.values()].map((entry) => entry.job);
  }

  dispose(): void {
    this.#abort.abort();
    for (const entry of this.#entries.values()) entry.cancelTimer?.();
    this.#entries.clear();
    this.#byRef.clear();
  }

  #attach(entry: Entry, ref: string): void {
    this.#byRef.set(ref, entry.job.statusUrl);
    this.#update(entry, { ref });
  }

  #update(entry: Entry, change: Partial<TrackedJob>): void {
    entry.job = { ...entry.job, ...change };
    this.#options.onChange(entry.job);
  }

  #pollEarly(entry: Entry): void {
    if (entry.inFlight) {
      entry.again = true;
      return;
    }
    if (entry.timerKind === "early") return;
    this.#arm(entry, "early", this.#coalesceMs);
  }

  #arm(entry: Entry, kind: "baseline" | "early", ms: number): void {
    entry.cancelTimer?.();
    entry.timerKind = kind;
    entry.cancelTimer = this.#schedule(() => {
      entry.cancelTimer = undefined;
      entry.timerKind = undefined;
      void this.#poll(entry);
    }, ms);
  }

  // Read through methods, not inline: the checker narrows `aborted` and
  // `settled` from the guard at the top of #poll across the await, and cannot
  // see that a callback changes them in between.
  #aborted(): boolean {
    return this.#abort.signal.aborted;
  }

  #settled(entry: Entry): boolean {
    return entry.job.settled;
  }

  async #poll(entry: Entry): Promise<void> {
    if (this.#settled(entry) || entry.inFlight || this.#aborted()) return;
    entry.cancelTimer?.();
    entry.cancelTimer = undefined;
    entry.timerKind = undefined;
    entry.inFlight = true;
    try {
      const status = await this.#options.readJob(entry.job.statusUrl, this.#abort.signal);
      if (this.#aborted()) return;
      this.#update(entry, {
        status,
        polls: entry.job.polls + 1,
        lastError: undefined,
        settled: status.terminal,
      });
    } catch (error) {
      if (this.#aborted()) return;
      if (error instanceof JobNotFoundError) {
        this.#update(entry, { polls: entry.job.polls + 1, gone: true, settled: true });
      } else {
        // A failed read changes nothing about the job; it only means we do not
        // know more than we did. Keep the last status and try again later.
        this.#update(entry, {
          polls: entry.job.polls + 1,
          lastError: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      entry.inFlight = false;
    }
    // No timer can be armed while a poll is in flight — an early request
    // then only sets `again` — so a settled job has nothing left to cancel.
    if (this.#settled(entry)) return;
    if (entry.again) {
      entry.again = false;
      this.#arm(entry, "early", this.#coalesceMs);
      return;
    }
    this.#arm(entry, "baseline", entry.interval);
    entry.interval = Math.min(Math.round(entry.interval * 1.5), this.#maxIntervalMs);
  }
}
