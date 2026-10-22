/**
 * The requests this page made to one service, newest last, read off the
 * session's observations: no instrumentation of its own.
 *
 * Each URL is shown exactly as the observation stores it, which the core has
 * already redacted; it is never rebuilt from a request. The method is the one
 * the core sends for that kind of observation: an `execution` is the POST to
 * the execute endpoint, a `job-dismissed` the DELETE of a job, and every other
 * kind listed here a GET. Observations that are not one request with one
 * answer — a derived capability, a skipped link, a poll summary — are left
 * out.
 */

import type { SessionObservation, WebObservation } from "../observations.js";

export interface LoggedRequest {
  readonly method: "GET" | "POST" | "DELETE";
  /** As stored on the observation: redacted by the core. */
  readonly url: string;
  /** The HTTP status, or undefined where none came back. */
  readonly status: number | undefined;
}

/** One observation as a request, or undefined when it is not one. */
export function asRequest(observation: WebObservation): LoggedRequest | undefined {
  switch (observation.kind) {
    case "landing-page-fetched":
    case "conformance-fetched":
    case "process-list-fetched":
    case "process-fetched":
    case "job-results":
    case "job-list":
      return { method: "GET", url: observation.url, status: observation.status };
    case "job-status":
      return { method: "GET", url: observation.url, status: observation.httpStatus };
    case "execution":
      return { method: "POST", url: observation.url, status: observation.status };
    case "job-dismissed":
      return { method: "DELETE", url: observation.url, status: observation.status };
    // Not one request with one answer. Listed rather than left to a
    // `default`, so a new kind of observation has to be decided on here.
    case "conformance-link":
    case "conformance-unavailable":
    case "capabilities-derived":
    case "link-skipped":
    case "processes-link":
    case "job-list-link":
    case "retry-after":
    case "job-polled":
    case "execute-route":
    case "endpoint-access":
    case "cancel-job":
    case "form":
    case "result":
      return undefined;
  }
}

/** The last `limit` requests made to `endpoint` (a redacted base URL), oldest first. */
export function requestLog(
  entries: readonly SessionObservation[],
  endpoint: string,
  limit: number,
): LoggedRequest[] {
  return entries
    .filter((entry) => entry.endpoint === endpoint)
    .flatMap((entry) => {
      const request = asRequest(entry.observation);
      return request === undefined ? [] : [request];
    })
    .slice(-limit);
}

/** The last execute request for one process at `endpoint`: its HTTP status and how long it took. */
export function lastExecution(
  entries: readonly SessionObservation[],
  endpoint: string,
  processId: string,
): { readonly status: number | undefined; readonly elapsedMs: number } | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry === undefined || entry.endpoint !== endpoint) continue;
    const { observation } = entry;
    if (observation.kind === "execution" && observation.processId === processId) {
      return { status: observation.status, elapsedMs: observation.elapsedMs };
    }
  }
  return undefined;
}
