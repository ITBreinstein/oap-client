/**
 * The jobs layer's public surface.
 *
 * Free functions, not methods on {@link JobHandle} — T7. A handle with methods
 * is not plain data: it cannot be held in React state, serialised, or passed
 * through a reducer without dragging a live client behind it, and §7.1 puts the
 * workflow in exactly that kind of state. It also keeps `JobHandle` a
 * *description of what the server said*, which is what makes `discoveredVia`
 * meaningful as evidence rather than as plumbing.
 */

export { getJob, readJobStatus } from "./get-job.js";
export type { JobStatusRead } from "./get-job.js";
export {
  DEFAULT_MAX_POLLS,
  DEFAULT_POLL_TIMEOUT_MS,
  INITIAL_POLL_INTERVAL_MS,
  MAX_POLL_INTERVAL_MS,
  MIN_POLL_INTERVAL_MS,
  MIN_RETRY_AFTER_MS,
  pollJob,
  waitForJob,
} from "./poll-job.js";
export type { PollJobOptions, PollOutcome, PollReport } from "./poll-job.js";
export { RESULTS_ACCEPT, getResults, resolveResultsUrl } from "./get-results.js";
export type { GetResultsOptions, JobResults, ResultsRoute } from "./get-results.js";
export { dismissJob, isUnsupportedDismissStatus } from "./dismiss-job.js";
export type { Dismissal, DismissJobOptions } from "./dismiss-job.js";
export { DEFAULT_MAX_JOB_PAGES, listJobs } from "./list-jobs.js";
export type { ListJobsOptions } from "./list-jobs.js";
export { isRecord, parseJobStatus } from "./parse-status.js";
export type { ParseJobStatusOptions } from "./parse-status.js";
export { isAbsoluteUrl, jobUrlFor, jobsFallback, resultsUrlFor } from "./job-url.js";
// The vocabulary is re-exported from its own module rather than from
// `./types.js`, so that a reader of this file can see where it actually lives.
// The public surface is identical either way — see `vocabulary/job-status.ts`.
export { isJobState, isTerminalState } from "../vocabulary/job-status.js";
export type { JobState } from "../vocabulary/job-status.js";
export type {
  JobList,
  JobListTruncation,
  JobRequestOptions,
  JobStatus,
  JobTransportOptions,
} from "./types.js";
