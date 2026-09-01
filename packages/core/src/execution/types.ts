/**
 * Execution: the types the run button, the job panel and the result adapters
 * are all built on.
 *
 * The house pattern for the third time. `execute()` returns the
 * {@link ResponseEnvelope}, not a parsed body, because the core cannot know how
 * to interpret an arbitrary media type and §7.3 gives that decision to
 * `apps/web`'s result adapters. The envelope already carries everything they
 * need — `Content-Type`, `Content-Disposition`, `Content-Crs`, and a body that
 * can be read more than once.
 *
 * Exported in the first commit on purpose: the web app compiles against
 * {@link Execution} before the implementation behind it is finished.
 */

import type { FetchLike } from "../http/fetch.js";
import type { ResponseEnvelope } from "../http/envelope.js";
import type { Link } from "../links/types.js";
import type { ObservationSink } from "../observations.js";
import type { ProcessDescription } from "../processes/types.js";

/** What the caller asked the server to do. `"sync"` sends no `Prefer` header. */
export type ExecutionMode = "sync" | "async";

/**
 * A value for one process input, as the caller supplies it.
 *
 * - a bare JSON value        → `"plugfest"`, `42`, `{ "type": "Point", … }`
 * - a qualified value        → `{ value: …, mediaType: "application/geo+json" }`
 * - a reference              → `{ href: "https://…", type: "image/tiff" }`
 * - an array of any of those → when the input's `maxOccurs > 1`
 *
 * The core does not decide which of these is right. The web app builds the
 * value from the form; the core serialises what it is given. `unknown` rather
 * than a union of those four shapes is the honest type: a union would be a
 * claim this layer does not check, and checking it would mean rejecting values
 * a server might well accept.
 */
export type ExecuteInputValue = unknown;

/** One entry of the `outputs` block, as OGC 18-062r2 §7.11 defines it. */
export interface ExecuteOutputSelection {
  readonly format?: { readonly mediaType?: string; readonly encoding?: string };
  readonly transmissionMode?: "value" | "reference";
}

/**
 * What we know about a job the server has accepted.
 *
 * **No methods in this task.** Polling, status and dismissal arrive in Task 5.
 * The shape is defined now so that adding them is additive rather than a
 * breaking change to a package `apps/web` already depends on.
 */
export interface JobHandle {
  /** Absolute. Resolved against the response's own URL if the server sent it relative. */
  readonly statusUrl: string;
  /** Present when the server sent a job document, or a parseable `Location` tail. */
  readonly jobId?: string;
  /** Links carried in the response body, resolved absolute. Empty when there were none. */
  readonly links: readonly Link[];
  /**
   * How `statusUrl` was found. This field is the raw material for the CORS
   * finding: a service where Node reads the header and a browser needs the
   * body-link fallback is a service that does not expose `Location`. See T7.
   */
  readonly discoveredVia: "location-header" | "body-link";
}

/**
 * What happened, as a discriminated union.
 *
 * Checking `execution.kind === "immediate"` narrows inside the block, so
 * `execution.response` is available and `execution.job` is a compile error.
 * The wrong arm cannot be read by accident, and a third arm added later makes
 * every incomplete `switch` fail to compile rather than silently fall through.
 *
 * `requestedMode` is on **both** arms deliberately. It is what the caller
 * *asked for*, while `kind` is what *happened*. When those disagree — asked
 * sync, got a job — that is a finding and a matrix cell, and it can only be
 * recorded if both facts survive.
 */
export type Execution =
  | {
      readonly kind: "immediate";
      readonly response: ResponseEnvelope;
      readonly requestedMode: ExecutionMode;
    }
  | {
      readonly kind: "job";
      readonly job: JobHandle;
      readonly requestedMode: ExecutionMode;
    };

/**
 * Transport concerns, shared with the rest of the core.
 *
 * Declared here rather than reused from `discovery/negotiate.ts`, because
 * `src/execution/` may not import `src/discovery/` — see the dependency-cruiser
 * rule in the acceptance criteria. Three fields is a cheaper price than a
 * boundary violation.
 */
export interface ExecuteTransportOptions {
  readonly fetch?: FetchLike | undefined;
  readonly maxBufferBytes?: number | undefined;
  readonly signal?: AbortSignal | undefined;
}

/**
 * A synchronous calculation is still a calculation, so this is generous and
 * deliberately much larger than the read path's timeout. A form that gives up
 * after five seconds on a process that takes twenty is a demo failure that
 * looks like a server failure. See T8.
 */
export const DEFAULT_EXECUTE_TIMEOUT_MS: number = 120_000;

export interface ExecuteOptions extends ExecuteTransportOptions {
  readonly inputs?: Readonly<Record<string, ExecuteInputValue>>;
  readonly outputs?: Readonly<Record<string, ExecuteOutputSelection>>;
  /** `"document"` wraps outputs in a JSON envelope; `"raw"` returns the output alone. */
  readonly response?: "document" | "raw";
  /** Defaults to `"sync"`, which is the OGC Part 1 v1.0 default and sends no `Prefer`. */
  readonly mode?: ExecutionMode;
  /**
   * Supply the description and the core will warn on arity mismatches.
   * **Never blocks** — see T3. Its `execute` link is also preferred over a
   * constructed path.
   */
  readonly description?: ProcessDescription;
  /** Milliseconds. Defaults to {@link DEFAULT_EXECUTE_TIMEOUT_MS}. */
  readonly timeoutMs?: number | undefined;
  readonly onObservation?: ObservationSink | undefined;
}
