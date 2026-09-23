/**
 * `pollJob()` — the loop that makes polling authoritative.
 *
 * ## Why this is the important function in the layer
 *
 * The architecture principle is **callbacks as doorbells, polling as truth**. A
 * callback only ever means "go and look"; this is the looking. It has to be
 * correct and proven *before* the relay exists, or the relay becomes a source
 * of truth by accident and every missed, duplicated or reordered notification
 * turns into a job-state bug that is impossible to reproduce.
 *
 * ## The requirements, in the order they matter
 *
 * 1. **Abort is checked between polls, not only at the start.** A user who
 *    closes the job panel must provably make no further request. Same
 *    `throwIfAborted()` pattern as `list-processes.ts`, and the same reason.
 * 2. **Every timer is cleared in a `finally`.** A pending two-minute timer that
 *    keeps a Node process alive is the standard way this goes wrong, and it
 *    goes wrong in the test run rather than in production.
 * 3. **`Retry-After` is honoured when the server sends one**, down to a hard
 *    {@link MIN_RETRY_AFTER_MS}. Written `??`, not `||`: `Retry-After: 0` is a
 *    real instruction and `||` would silently replace it with the default,
 *    which is a different bug from clamping it deliberately. Neither reference
 *    server sends the header at all (finding 0033), which is exactly why the
 *    handling has unit tests rather than contract tests.
 * 4. **Otherwise a bounded backoff** between {@link MIN_POLL_INTERVAL_MS} and
 *    {@link MAX_POLL_INTERVAL_MS}, so we neither hammer a server at 50 ms nor
 *    make a five-second job take thirty. A server-supplied value is held
 *    between {@link MIN_RETRY_AFTER_MS} and the same ceiling, and every clamp
 *    is recorded rather than hidden.
 * 5. **A total deadline separate from the caller's signal**, with its own error
 *    type. "The user closed the panel" and "the job never finished" are
 *    different facts about a service.
 * 6. **Progress is reported as it happens**, through `onStatus`. A job panel
 *    that only updates when the job ends is not a job panel.
 *
 * ## Why `onStatus` and not an async iterator
 *
 * Decided after writing the loop both ways, which is the order the brief asked
 * for. A callback composes with React state without ceremony —
 * `onStatus: setStatus` is the whole integration — whereas an iterator makes
 * the consumer own a `for await` whose early `break` has to be wired back into
 * cancellation, which is the `signal` we already take. It is also one fewer
 * public-API shape to support. The iterator's real advantage is backpressure,
 * and a loop that sleeps between polls has none to apply.
 */

import { AbortError } from "../http/errors.js";
import { JobNotFoundError, JobPollTimeoutError } from "../errors.js";
import { observe, redactUrl } from "../observations.js";
import { readJobStatus } from "./get-job.js";
import type { JobRequestOptions, JobStatus } from "./types.js";

/** Do not hammer a server, however eager the caller. */
export const MIN_POLL_INTERVAL_MS = 500;
/**
 * The floor under a server-supplied `Retry-After`, and the *only* thing that
 * overrules one.
 *
 * Numeric `Retry-After` is in whole seconds, so the smallest non-zero value a
 * server can express is one second. A 1000 ms minimum therefore overrides
 * exactly two inputs — `Retry-After: 0` and an HTTP-date already in the past —
 * and honours every legitimate non-zero instruction to the millisecond. It is
 * a guard against "immediately", not a second opinion about pacing.
 *
 * Note how it sits against {@link MIN_POLL_INTERVAL_MS}, which is 500 ms: this
 * minimum is *above* our own backoff floor, so a `Retry-After` can only ever
 * lengthen a wait, never shorten one. If the backoff floor is ever raised above
 * 1000 ms that stops being true and a server value between the two would be
 * honoured below the floor — which is intended, but is no longer the case
 * today and should not be assumed.
 */
export const MIN_RETRY_AFTER_MS = 1_000;
/** Do not make a five-second job take thirty. */
export const MAX_POLL_INTERVAL_MS = 10_000;
/** Where the backoff starts, before it grows towards the ceiling. */
export const INITIAL_POLL_INTERVAL_MS = 1_000;
/** Growth factor per poll, applied only when the server gave no instruction. */
const BACKOFF_FACTOR = 1.5;

/**
 * Generous, and a ceiling all the same. A long calculation is a legitimate use
 * of this client; an unbounded wait is not.
 */
export const DEFAULT_POLL_TIMEOUT_MS = 600_000;

/**
 * How a poll loop ended. `terminal` is the only one that is not a finding.
 *
 * `dismissed-remotely` is its own outcome because on both reference servers a
 * dismissed job stops existing rather than reporting `status: "dismissed"`
 * (finding 0035) — so a 404 mid-poll is an ordinary end, not a failure, and
 * collapsing it into `error` would make every cancellation look like a defect.
 */
export type PollOutcome = "terminal" | "timeout" | "aborted" | "error" | "dismissed-remotely";

export interface PollJobOptions extends JobRequestOptions {
  /** Called once per completed poll, in order. A throwing callback cannot break the loop. */
  readonly onStatus?: ((status: JobStatus) => void) | undefined;
  /** Total deadline in milliseconds. Defaults to {@link DEFAULT_POLL_TIMEOUT_MS}. */
  readonly timeoutMs?: number | undefined;
  /** First interval, before backoff. Defaults to {@link INITIAL_POLL_INTERVAL_MS}. */
  readonly intervalMs?: number | undefined;
  /**
   * Stop after this many polls even if nothing is terminal.
   *
   * The safety net for an unrecognised status, which `parse-status.ts`
   * deliberately treats as non-terminal: without a cap, a server that invents a
   * status word would be polled until the deadline.
   */
  readonly maxPolls?: number | undefined;
}

/** What the loop saw, beyond the final status. Returned so callers need not re-derive it. */
export interface PollReport {
  readonly status: JobStatus | undefined;
  readonly outcome: PollOutcome;
  readonly pollCount: number;
  readonly elapsedMs: number;
  /** Every status seen, in order, as raw strings. The matrix column for async usability. */
  readonly statusSequence: readonly string[];
  readonly retryAfterSeen: boolean;
  readonly retryAfterHonoured: boolean;
  readonly clamped: boolean;
}

/**
 * A backstop, not a budget.
 *
 * The total deadline is what normally ends a loop that will not terminate. This
 * exists for the one case the deadline handles badly: an unrecognised status,
 * which `parse-status.ts` deliberately treats as non-terminal, against a server
 * answering instantly. At the 500 ms floor that is still a bounded number of
 * requests, and a thousand of them is far more than any real job needs while
 * remaining a ceiling.
 */
export const DEFAULT_MAX_POLLS = 1_000;

/**
 * Sleep, cancellably, cleaning up both the timer and the abort listener.
 *
 * The `finally` is the point: a rejected sleep that leaves its timer pending
 * keeps a Node process alive past the end of the test that started it.
 */
function sleep(ms: number, signal: AbortSignal | undefined, url: string): Promise<void> {
  if (signal?.aborted === true) return Promise.reject(new AbortError(url));
  if (ms <= 0) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new AbortError(url));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** An abort must reject, never degrade. Checked before each request. */
function throwIfAborted(signal: AbortSignal | undefined, url: string): void {
  if (signal?.aborted === true) throw new AbortError(url);
}

function isAbort(error: unknown): boolean {
  return error instanceof AbortError || (error instanceof Error && error.name === "AbortError");
}

/** The sink must never break the loop, exactly as `observe()` guards the observation sink. */
function report(onStatus: ((status: JobStatus) => void) | undefined, status: JobStatus): void {
  if (onStatus === undefined) return;
  try {
    onStatus(status);
  } catch {
    // A broken progress callback is not a broken job.
  }
}

/**
 * Poll a job until it reaches a terminal status, the deadline expires, or the
 * caller aborts.
 *
 * Resolves with a {@link PollReport} for every ending that is not an error —
 * including a job that **failed**, which is a return value and not an
 * exception (T1), and including a job dismissed out from under us.
 *
 * Throws {@link JobPollTimeoutError} on the deadline, {@link AbortError} on the
 * caller's signal, and whatever `getJob()` threw for anything else.
 */
export async function pollJob(
  statusUrl: string,
  options: PollJobOptions = {},
): Promise<PollReport> {
  const sink = options.onObservation;
  const timeoutMs = options.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  const maxPolls = Math.max(1, options.maxPolls ?? DEFAULT_MAX_POLLS);
  const startedAt = Date.now();

  const statusSequence: string[] = [];
  let status: JobStatus | undefined;
  let pollCount = 0;
  let interval = clampOurs(options.intervalMs ?? INITIAL_POLL_INTERVAL_MS);
  let retryAfterSeen = false;
  let retryAfterHonoured = false;
  let clamped = false;

  const finish = (outcome: PollOutcome): PollReport => {
    const elapsedMs = Date.now() - startedAt;
    observe(sink, {
      kind: "job-polled",
      url: redactUrl(statusUrl),
      jobIdKnown: status !== undefined && status.jobId !== "",
      pollCount,
      elapsedMs,
      statusSequence: Object.freeze([...statusSequence]),
      outcome,
      retryAfterSeen,
      retryAfterHonoured,
      backoffClamped: clamped,
    });
    return {
      status,
      outcome,
      pollCount,
      elapsedMs,
      statusSequence: Object.freeze([...statusSequence]),
      retryAfterSeen,
      retryAfterHonoured,
      clamped,
    };
  };

  // The whole loop is wrapped, not just the request. An abort can arrive at
  // three different points — the pre-request check, the request itself, and the
  // sleep between polls — and all three have to produce the same recorded
  // outcome. Catching only around the request is how the sleep path silently
  // escaped without an observation.
  try {
    for (;;) {
      throwIfAborted(options.signal, statusUrl);

      let retryAfterMs: number | undefined;
      let retryAfterRaw: string | undefined;
      try {
        // `readJobStatus` rather than `getJob`: the loop needs the response's
        // `Retry-After`, which is a fact about one HTTP response rather than
        // about the job, and so has no place on `JobStatus`.
        const polled = await readJobStatus(statusUrl, options);
        status = polled.status;
        retryAfterMs = polled.envelope.retryAfterMs;
        // The raw header as well as the parsed value: when the two disagree —
        // the header was present but unparseable — that difference *is* the
        // observation, and the parsed value alone cannot express it.
        retryAfterRaw = polled.envelope.headers.get("retry-after") ?? undefined;
      } catch (error) {
        // An abort belongs to the outer handler, which is the one place that
        // records it.
        if (isAbort(error)) throw error;
        // A job that stopped existing mid-poll was dismissed by someone — us,
        // on another tab, or an operator. Both reference servers delete rather
        // than park (finding 0035), so this is an ordinary ending.
        if (error instanceof JobNotFoundError) {
          statusSequence.push("404");
          return finish("dismissed-remotely");
        }
        finish("error");
        throw error;
      }

      pollCount += 1;
      statusSequence.push(status.rawStatus);
      report(options.onStatus, status);

      if (status.terminal) return finish("terminal");
      if (pollCount >= maxPolls) return finish("timeout");

      const elapsed = Date.now() - startedAt;
      if (elapsed >= timeoutMs) {
        finish("timeout");
        throw new JobPollTimeoutError(statusUrl, timeoutMs, pollCount, elapsed, status);
      }

      // `??`, not `||`. A `Retry-After: 0` is a real instruction and `||` would
      // discard it as falsy — a different thing from clamping it to
      // `MIN_RETRY_AFTER_MS`, which is a decision taken in the open below.
      if (retryAfterMs !== undefined) {
        retryAfterSeen = true;
        retryAfterHonoured = true;
      }
      const requested = retryAfterMs ?? interval;
      const wait = retryAfterMs === undefined ? clampOurs(requested) : clampServer(requested);
      if (wait !== requested) clamped = true;

      // A header the server sent is recorded whatever we did with it, including
      // the case where we did nothing because it did not parse. Silently
      // falling back to the backoff would hide a malformed header behind
      // perfectly reasonable-looking polling.
      if (retryAfterRaw !== undefined) {
        const ignored = retryAfterMs === undefined;
        observe(sink, {
          kind: "retry-after",
          url: redactUrl(statusUrl),
          raw: retryAfterRaw,
          disposition: ignored ? "ignored" : wait === retryAfterMs ? "honoured" : "clamped",
          parsedMs: retryAfterMs,
          effectiveDelayMs: ignored ? undefined : wait,
        });
        if (ignored) retryAfterSeen = true;
      }

      // Never sleep past the deadline: waiting ten seconds to discover we ran
      // out of time nine seconds ago is a worse report and a slower one.
      const remaining = timeoutMs - (Date.now() - startedAt);
      if (wait >= remaining) {
        await sleep(Math.max(0, remaining), options.signal, statusUrl);
        finish("timeout");
        throw new JobPollTimeoutError(
          statusUrl,
          timeoutMs,
          pollCount,
          Date.now() - startedAt,
          status,
        );
      }

      await sleep(wait, options.signal, statusUrl);

      // Grow only the loop's own backoff. A server that keeps sending
      // `Retry-After` keeps deciding, and its instruction is not compounded.
      if (retryAfterMs === undefined) interval = clampOurs(interval * BACKOFF_FACTOR);
    }
  } catch (error) {
    if (isAbort(error)) finish("aborted");
    throw error;
  }
}

/**
 * Our own backoff, held between the floor and the ceiling.
 *
 * The floor exists to stop *us* hammering a server that has told us nothing.
 */
function clampOurs(ms: number): number {
  if (!Number.isFinite(ms)) return MAX_POLL_INTERVAL_MS;
  return Math.min(MAX_POLL_INTERVAL_MS, Math.max(MIN_POLL_INTERVAL_MS, ms));
}

/**
 * A server-supplied `Retry-After`, held between {@link MIN_RETRY_AFTER_MS} and
 * the ceiling.
 *
 * Task 5 let a server value through at 0 ms on the argument that a server
 * sending `Retry-After: 0` has explicitly asked to be polled immediately. That
 * argument is wrong about what the header can express: delta-seconds is in
 * whole seconds, so `0` does not mean "in a moment", it means "now", and a loop
 * that obeys it literally against a server answering instantly is a spin. Every
 * value a server can actually use to request a short wait — one second and up —
 * is still honoured exactly, so the minimum costs nothing a real server wanted.
 *
 * The ceiling is unchanged: an hour-long `Retry-After` on a job a user is
 * watching is a hung panel, and a clamped wait that is recorded is better than
 * a correct wait nobody sees. Every clamp sets `clamped` on the report and
 * emits a `retry-after` observation carrying the raw header.
 */
function clampServer(ms: number): number {
  if (!Number.isFinite(ms)) return MAX_POLL_INTERVAL_MS;
  return Math.min(MAX_POLL_INTERVAL_MS, Math.max(MIN_RETRY_AFTER_MS, ms));
}

/**
 * {@link pollJob}, resolving with the final {@link JobStatus}.
 *
 * Resolves for `failed` and `dismissed` too — it does **not** throw, for the T1
 * reason. Whether a failed job is an error is the caller's decision, and the
 * server's own explanation is on the status it hands back.
 */
export async function waitForJob(
  statusUrl: string,
  options: PollJobOptions = {},
): Promise<JobStatus> {
  const result = await pollJob(statusUrl, options);
  if (result.status !== undefined) return result.status;
  // Only reachable when the job was dismissed before any poll completed.
  throw new JobNotFoundError(statusUrl);
}
