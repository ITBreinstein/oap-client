/**
 * Jobs: the status document, the job list, and the options every job operation
 * takes.
 *
 * Preservative, never interpretive — the same rule as `processes/types.ts`.
 * What a job status *means* for a UI is `apps/web`'s decision; this layer's job
 * is to lose nothing it will need to make it, and to claim nothing it has not
 * checked.
 *
 * Step zero, 2026-09-16, against pygeoapi 0.21.0 and ZOO fork 46289f6, decided
 * three of the shapes below and is worth reading before changing them:
 *
 * - Neither server sends an `exception` member on a failed job. Both put the
 *   failure in `message`, as prose. {@link JobStatus.exception} is kept because
 *   the standard defines it and a third server may well send it, but it is
 *   absent against both reference servers today — see finding 0034.
 * - pygeoapi reports `accepted` for the whole of a job's execution and never
 *   `running` (finding 0032), so nothing here may treat `running` as the
 *   evidence that work has started. `terminal` is the only distinction the
 *   poll loop is allowed to depend on.
 * - ZOO sends both `jobID` and `id`; pygeoapi sends only `jobID`. Both are read,
 *   in that order.
 */

import type { FetchLike } from "../http/fetch.js";
import type { ProblemDetails } from "../http/problem.js";
import type { Link } from "../links/types.js";
import type { ObservationSink } from "../observations.js";
import type { JobState } from "../vocabulary/job-status.js";

/**
 * The status vocabulary itself lives one layer down, in
 * `vocabulary/job-status.ts`, because `execution/` needs it too and a layer
 * may not reach sideways into another to get it. Re-exported here so this
 * module stays the one place the jobs layer imports its types from.
 */
export type { JobState } from "../vocabulary/job-status.js";
export { isJobState, isTerminalState } from "../vocabulary/job-status.js";

export interface JobStatus {
  /** `jobID`, then `id`, then the last path segment of the URL it was read from. */
  readonly jobId: string;
  /**
   * The status, lowercased and matched against the OGC vocabulary.
   *
   * When the server sent something outside the vocabulary this degrades to
   * `"running"` — the non-terminal reading, so the poll loop keeps going rather
   * than declaring a job finished it knows nothing about — and the verbatim
   * string survives on {@link rawStatus}. See T6 of the task report.
   */
  readonly status: JobState;
  /** Whatever the server actually sent, verbatim, recognised or not. */
  readonly rawStatus: string;
  /** True when {@link rawStatus} was not in the OGC vocabulary. A finding when true. */
  readonly statusRecognised: boolean;
  readonly processId?: string;
  /**
   * 0–100, from `progress` or `percentCompleted`, when the server reported one.
   *
   * Both reference servers write `progress`; `percentCompleted` is read because
   * the v2 draft uses it and reading a member costs nothing. A value outside
   * 0–100 is clamped and warned about rather than dropped.
   */
  readonly progress?: number;
  /** Free prose. On both reference servers this is where a failure is explained. */
  readonly message?: string;
  readonly created?: string;
  readonly started?: string;
  readonly finished?: string;
  readonly updated?: string;
  /**
   * The server's own explanation of a failure, when it sent a structured one.
   *
   * **Absent on both reference servers.** Neither pygeoapi nor ZOO sends an
   * `exception` member; both put the failure in {@link message}. Populated when
   * a server sends an `exception` member that reads as a problem document, or
   * when the job body itself is problem-shaped. Read `message` first.
   */
  readonly exception?: ProblemDetails;
  /** Resolved absolute against the URL the document was served from. */
  readonly links: readonly Link[];
  /** The URL this status was read from. Everything relative resolves against it. */
  readonly url: string;
  /** True when {@link status} is one the job cannot leave. Derived once, here. */
  readonly terminal: boolean;
  /** Structural degradations, as codes. Never carries a value from the document. */
  readonly warnings: readonly string[];
  /** Names only, of top-level members this layer does not model. */
  readonly unrecognisedKeys: readonly string[];
}

/** Why a job-list walk stopped for our reasons rather than the server's. */
export type JobListTruncation = "page-cap" | "cycle";

/** The job list, mirroring {@link ProcessList} so the two walks stay comparable. */
export interface JobList {
  readonly jobs: readonly JobStatus[];
  /** Links from the **last** page walked. */
  readonly links: readonly Link[];
  readonly pageCount: number;
  readonly truncated: boolean;
  readonly truncationReason?: JobListTruncation;
  /** The server's own `numberTotal`, when it declared a usable one. */
  readonly numberTotal?: number;
}

/**
 * Transport concerns, shared with the rest of the core.
 *
 * Declared here rather than reused from `discovery/negotiate.ts` for the same
 * reason `ExecuteTransportOptions` is: a job operation is handed a URL and must
 * not depend on the layer that finds one.
 */
export interface JobTransportOptions {
  readonly fetch?: FetchLike | undefined;
  readonly maxBufferBytes?: number | undefined;
  readonly signal?: AbortSignal | undefined;
}

export interface JobRequestOptions extends JobTransportOptions {
  readonly onObservation?: ObservationSink | undefined;
}
