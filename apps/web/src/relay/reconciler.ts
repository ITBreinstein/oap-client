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
import type { CallbackKind } from "./contract.js";
import { systemSchedule, type Schedule } from "./doorbells.js";

/**
 * The reads after a job's first `successful`, when callbacks were registered
 * for it (finding 0047).
 *
 * A server may write `successful`, then fail to deliver the success callback
 * and rewrite the job as `failed`. pygeoapi does: within a fraction of a
 * second when the connection is refused, and only once the connection attempt
 * times out, minutes later, when the receiver does not answer. One read two
 * seconds later missed the second case (review W14). So the job is read again,
 * less often each time, until the success callback is known to have arrived —
 * delivered, the server has no reason to rewrite anything — or until
 * {@link CONFIRM_WINDOW_MS} has passed. Only a job with callbacks is exposed to
 * this, so only such a job is read again; the choice rests on what was asked
 * of the server, never on which server it is.
 *
 * - `pending`: the first `successful` was read; the reads go on.
 * - `delivered`: the success callback reached the relay, so nothing will
 *   rewrite the status; settled on the read that says `successful`.
 * - `unchanged`: the window ended with every read saying the same.
 * - `changed`: a read did not. `first` is what the server said before.
 */
export type Confirmation =
  | { readonly state: "pending" }
  | { readonly state: "delivered" }
  | { readonly state: "unchanged" }
  | { readonly state: "changed"; readonly first: JobStatus };

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
  /**
   * When the server's status was first read as `accepted`, in this client's
   * clock, while it still is; undefined once it is anything else.
   */
  readonly acceptedSince: number | undefined;
  /**
   * The job has been `accepted` for at least the notice threshold. Not a
   * fault: some servers report `accepted` until the job finishes (finding
   * 0032), and a server that never started the job looks the same from here
   * (finding 0047). Polling carries on either way.
   */
  readonly acceptedLong: boolean;
  /** The re-read after a first `successful`; undefined when there is none. */
  readonly confirmation: Confirmation | undefined;
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
  /** How long a job may stay `accepted` before `acceptedLong` is set. */
  readonly acceptedNoticeMs?: number | undefined;
  /** How long after a first `successful` the first confirming read is made. */
  readonly confirmAfterMs?: number | undefined;
  /** How long after a first `successful` the confirming reads go on, at most. */
  readonly confirmWindowMs?: number | undefined;
  /** This client's clock, for `acceptedSince`. */
  readonly now?: (() => number) | undefined;
}

export const BASELINE_MS = 2_000;
export const MAX_INTERVAL_MS = 15_000;
export const COALESCE_MS = 250;
export const ACCEPTED_NOTICE_MS = 60_000;
export const CONFIRM_AFTER_MS = 2_000;
/**
 * Three minutes: a callback to a receiver that does not answer fails when the
 * connection attempt times out, about two minutes with Linux's defaults.
 */
export const CONFIRM_WINDOW_MS = 180_000;

interface Entry {
  job: TrackedJob;
  interval: number;
  cancelTimer: (() => void) | undefined;
  /**
   * What the pending timer is for. An early poll is never pushed back by a
   * baseline one, and a confirming read is moved by nothing.
   */
  timerKind: "baseline" | "early" | "confirm" | undefined;
  inFlight: boolean;
  /** A doorbell arrived while a poll was in flight: poll once more after it. */
  again: boolean;
  /**
   * `refresh()` was called while a poll was in flight: read once more after
   * it, even when that poll settles the job (review W23).
   */
  refreshAgain: boolean;
  /** The success callback rang this job's doorbell. */
  successDelivered: boolean;
  /** When the first `successful` was read, in this client's clock. */
  confirmingSince: number | undefined;
  /** The wait before the next confirming read. */
  confirmDelay: number;
}

export class JobReconciler {
  readonly #options: ReconcilerOptions;
  readonly #schedule: Schedule;
  readonly #baselineMs: number;
  readonly #maxIntervalMs: number;
  readonly #coalesceMs: number;
  readonly #acceptedNoticeMs: number;
  readonly #confirmAfterMs: number;
  readonly #confirmWindowMs: number;
  readonly #now: () => number;
  readonly #entries = new Map<string, Entry>();
  readonly #byRef = new Map<string, string>();
  readonly #abort = new AbortController();

  constructor(options: ReconcilerOptions) {
    this.#options = options;
    this.#schedule = options.schedule ?? systemSchedule;
    this.#baselineMs = options.baselineMs ?? BASELINE_MS;
    this.#maxIntervalMs = options.maxIntervalMs ?? MAX_INTERVAL_MS;
    this.#coalesceMs = options.coalesceMs ?? COALESCE_MS;
    this.#acceptedNoticeMs = options.acceptedNoticeMs ?? ACCEPTED_NOTICE_MS;
    this.#confirmAfterMs = options.confirmAfterMs ?? CONFIRM_AFTER_MS;
    this.#confirmWindowMs = options.confirmWindowMs ?? CONFIRM_WINDOW_MS;
    this.#now = options.now ?? (() => Date.now());
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
        acceptedSince: undefined,
        acceptedLong: false,
        confirmation: undefined,
      },
      interval: this.#baselineMs,
      cancelTimer: undefined,
      timerKind: undefined,
      inFlight: false,
      again: false,
      refreshAgain: false,
      successDelivered: false,
      confirmingSince: undefined,
      confirmDelay: this.#confirmAfterMs,
    };
    this.#entries.set(statusUrl, entry);
    if (ref !== undefined) this.#attach(entry, ref);
    void this.#poll(entry);
  }

  /**
   * The relay rang for `ref`, naming the callbacks that rang, when it does.
   * Unknown refs are ignored: nothing to reconcile. A `success` callback is
   * evidence of delivery, never of state: it ends the confirming reads early,
   * and a read still decides what the job is.
   */
  doorbell(ref: string, callbacks: readonly CallbackKind[] = []): void {
    const statusUrl = this.#byRef.get(ref);
    const entry = statusUrl === undefined ? undefined : this.#entries.get(statusUrl);
    if (entry === undefined || entry.job.settled) return;
    if (callbacks.includes("success")) entry.successDelivered = true;
    this.#update(entry, { doorbells: entry.job.doorbells + 1 });
    // Any other doorbell leaves the confirming reads to their own time.
    if (entry.job.confirmation?.state === "pending" && !entry.successDelivered) return;
    this.#pollEarly(entry);
  }

  /**
   * The doorbell stream (re)opened. Anything rung while it was down is lost,
   * so every unsettled job is read once, now.
   */
  reconnected(): void {
    for (const entry of this.#entries.values()) {
      if (!entry.job.settled && entry.job.confirmation?.state !== "pending") this.#pollEarly(entry);
    }
  }

  /** Stop reconciling a job and forget it: removed from the page, not from the server. */
  untrack(statusUrl: string): void {
    const entry = this.#entries.get(statusUrl);
    if (entry === undefined) return;
    entry.cancelTimer?.();
    this.#entries.delete(statusUrl);
    if (entry.job.ref !== undefined) this.#byRef.delete(entry.job.ref);
  }

  /**
   * Read a job again soon, settled or not: the page has just asked the server
   * to change it (dismissal). What the read finds decides, as always.
   */
  refresh(statusUrl: string): void {
    const entry = this.#entries.get(statusUrl);
    if (entry === undefined) return;
    if (entry.inFlight) {
      // The read in flight may have left before the change; another follows.
      entry.refreshAgain = true;
      return;
    }
    if (entry.job.settled) this.#update(entry, { settled: false });
    this.#pollEarly(entry);
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

  #arm(entry: Entry, kind: "baseline" | "early" | "confirm", ms: number): void {
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

  /**
   * Whether `entry` is still the one tracked for its job. A job removed while
   * its read was in flight, or removed and tracked again, has a new entry or
   * none, and the old read must stop where it is: it must not change what is
   * shown, and above all must not arm the next poll (review W8).
   */
  #current(entry: Entry): boolean {
    return this.#entries.get(entry.job.statusUrl) === entry;
  }

  #acceptedChange(
    job: TrackedJob,
    status: JobStatus,
  ): Pick<TrackedJob, "acceptedSince" | "acceptedLong"> {
    if (status.status !== "accepted") return { acceptedSince: undefined, acceptedLong: false };
    const since = job.acceptedSince ?? this.#now();
    return { acceptedSince: since, acceptedLong: this.#now() - since >= this.#acceptedNoticeMs };
  }

  /**
   * What a read does to the confirmation, and whether the job settles. A first
   * `successful` for a job with callbacks holds it open; the reads after it
   * settle it once the success callback has arrived or the window is over,
   * and at once on anything else that is terminal.
   */
  #confirmationChange(
    entry: Entry,
    status: JobStatus,
  ): Pick<TrackedJob, "confirmation"> & { settled?: boolean } {
    const { job } = entry;
    const confirmation = job.confirmation;
    if (confirmation?.state === "pending") {
      const first = job.status;
      if (first !== undefined && first.status !== status.status) {
        return { confirmation: { state: "changed", first } };
      }
      if (entry.successDelivered) return { confirmation: { state: "delivered" } };
      const since = entry.confirmingSince ?? this.#now();
      if (this.#now() - since >= this.#confirmWindowMs) {
        return { confirmation: { state: "unchanged" } };
      }
      return { confirmation, settled: false };
    }
    if (
      confirmation === undefined &&
      job.ref !== undefined &&
      status.terminal &&
      status.status === "successful"
    ) {
      if (entry.successDelivered) return { confirmation: { state: "delivered" } };
      entry.confirmingSince = this.#now();
      entry.confirmDelay = this.#confirmAfterMs;
      return { confirmation: { state: "pending" }, settled: false };
    }
    return { confirmation };
  }

  async #poll(entry: Entry): Promise<void> {
    if (!this.#current(entry) || this.#settled(entry) || entry.inFlight || this.#aborted()) {
      return;
    }
    entry.cancelTimer?.();
    entry.cancelTimer = undefined;
    entry.timerKind = undefined;
    entry.inFlight = true;
    try {
      const status = await this.#options.readJob(entry.job.statusUrl, this.#abort.signal);
      if (this.#aborted() || !this.#current(entry)) return;
      this.#update(entry, {
        status,
        polls: entry.job.polls + 1,
        lastError: undefined,
        settled: status.terminal,
        ...this.#acceptedChange(entry.job, status),
        ...this.#confirmationChange(entry, status),
      });
    } catch (error) {
      if (this.#aborted() || !this.#current(entry)) return;
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
    if (!this.#current(entry)) return;
    if (entry.refreshAgain) {
      // Dismissal was asked for while this read was out: read again, even if
      // it settled the job, or a job dismissed as it finished keeps showing
      // `successful` (review W23).
      entry.refreshAgain = false;
      entry.again = false;
      if (this.#settled(entry)) this.#update(entry, { settled: false });
      this.#arm(entry, "early", this.#coalesceMs);
      return;
    }
    if (this.#settled(entry)) return;
    if (entry.job.confirmation?.state === "pending") {
      // A success doorbell that rang while this read was out ends the wait.
      if (entry.again && entry.successDelivered) {
        entry.again = false;
        this.#arm(entry, "early", this.#coalesceMs);
        return;
      }
      entry.again = false;
      this.#arm(entry, "confirm", entry.confirmDelay);
      entry.confirmDelay = Math.min(Math.round(entry.confirmDelay * 1.5), this.#maxIntervalMs);
      return;
    }
    if (entry.again) {
      entry.again = false;
      this.#arm(entry, "early", this.#coalesceMs);
      return;
    }
    this.#arm(entry, "baseline", entry.interval);
    entry.interval = Math.min(Math.round(entry.interval * 1.5), this.#maxIntervalMs);
  }
}
