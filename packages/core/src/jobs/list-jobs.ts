/**
 * `listJobs()` — the job list, including the `rel="next"` walk.
 *
 * The walk is `list-processes.ts`'s, deliberately: same stopping conditions,
 * same cycle guard, same page cap, same between-pages abort check. Two walks
 * that must behave identically are better as one habit copied knowingly than as
 * two implementations that drift.
 *
 * ## Why this matters more than a job list usually would
 *
 * T8. In a browser against pygeoapi, an asynchronous execute throws
 * {@link AmbiguousExecutionResponseError}: `Location` is not exposed
 * cross-origin (findings 0002 and 0009, re-confirmed on the job endpoints
 * 2026-09-16) and pygeoapi's async 201 body is the literal `null` (finding
 * 0004), so there is nothing for the body-link fallback to work with. The
 * browser has started a job it cannot name.
 *
 * This function is the honest recovery. **It does not guess.** Polling
 * `GET /jobs` and assuming the newest job is ours is exactly the guess
 * `AmbiguousExecutionResponseError` exists to prevent, and it is wrong the
 * moment two people share a demo server. What it does instead is give
 * `apps/web` enough to offer the *user* a choice: "we could not read the job
 * URL from this server; here are its recent jobs". A person can recognise their
 * own job. A heuristic cannot.
 *
 * ## The filters: sent, and checked
 *
 * The `job-list` class makes a server honour `processID` and `status`
 * (Requirements 68–71). pygeoapi accepts both and **ignores both**, returning
 * the full list either way (finding 0038); ZOO honours both. So they are sent
 * when asked for, which is cheaper on a server that applies them, *and* the
 * returned list is filtered here, which is correct on every server. Whether
 * the server applied them is recorded on the `job-list` observation: any entry
 * it returned that the filters exclude is evidence it did not. That turns 0038
 * into a measured cell, and on a busy shared server the page walk reaches the
 * user's job sooner.
 */

import { fetchJson } from "../discovery/negotiate.js";
import { MalformedJobDocumentError } from "../errors.js";
import { AbortError } from "../http/errors.js";
import { collectLinks, readBodyLinks } from "../links/resolve.js";
import { findLink } from "../links/find.js";
import type { Link } from "../links/types.js";
import { observe, redactUrl, type ObservationSink } from "../observations.js";
import type { JobState } from "../vocabulary/job-status.js";
import { isRecord, parseJobStatus } from "./parse-status.js";
import type { JobList, JobListTruncation, JobStatus } from "./types.js";
import type { FetchJsonOptions } from "../discovery/negotiate.js";

/** Twenty is generous for a job list and still a ceiling. */
export const DEFAULT_MAX_JOB_PAGES = 20;

export interface ListJobsOptions extends FetchJsonOptions {
  readonly onObservation?: ObservationSink | undefined;
  /** Defaults to {@link DEFAULT_MAX_JOB_PAGES}. Values below 1 are raised to 1. */
  readonly maxPages?: number | undefined;
  /**
   * Page-size hint applied to the **first** request only; the walk then follows
   * whatever `next` the server builds.
   *
   * Both reference servers honour it, and they page differently: pygeoapi
   * builds `next` with `offset=`, ZOO with `skip=` (finding 0019). Following
   * the advertised link rather than constructing the next page is what makes
   * that difference cost nothing.
   */
  readonly limit?: number | undefined;
  /**
   * Only jobs of these processes (Requirement 68). Sent as one `processID`
   * parameter per id on the first request, and applied to the returned list
   * as well. A job that names no process is kept: it may be the one wanted.
   */
  readonly processID?: readonly string[] | undefined;
  /**
   * Only jobs in these states (Requirement 70). Sent and applied as
   * `processID` is. A job whose status this client does not recognise is kept.
   */
  readonly status?: readonly JobState[] | undefined;
}

/**
 * Apply the `limit` hint and the filters to the first request, without
 * disturbing any other parameter the URL carries. OpenAPI 3.0's default for an
 * array in the query is one parameter per value.
 */
function firstPageUrl(url: string, options: ListJobsOptions): string {
  const { limit, processID = [], status = [] } = options;
  if (limit === undefined && processID.length === 0 && status.length === 0) return url;
  const parsed = new URL(url);
  if (limit !== undefined) parsed.searchParams.set("limit", String(limit));
  for (const id of processID) parsed.searchParams.append("processID", id);
  for (const state of status) parsed.searchParams.append("status", state);
  return parsed.toString();
}

/** Whether the filters exclude a job. A job missing the field in question is not excluded. */
function excludedBy(job: JobStatus, options: ListJobsOptions): boolean {
  const { processID = [], status = [] } = options;
  if (processID.length > 0 && job.processId !== undefined && !processID.includes(job.processId)) {
    return true;
  }
  return status.length > 0 && job.statusRecognised && !status.includes(job.status);
}

/** A non-negative integer `numberTotal`, or nothing. pygeoapi omits it; ZOO sends it. */
function readNumberTotal(body: Record<string, unknown>): number | undefined {
  const value: unknown = body["numberTotal"];
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/** An abort must reject, never degrade. Checked before each request. */
function throwIfAborted(signal: AbortSignal | undefined, url: string): void {
  if (signal?.aborted === true) throw new AbortError(url);
}

/**
 * Fetch the job list, following `next`.
 *
 * `jobsUrl` is where the list lives — resolved by the caller from the `jobList`
 * link that `inspect()` found, never rebuilt here.
 *
 * Throws only for the fatal cases: a page that is not a JSON object, or a
 * `jobs` member that is not an array. An individual entry that will not parse
 * is **skipped and counted**, not fatal: one unreadable job out of forty must
 * not cost the user the other thirty-nine, and a server under test is exactly
 * the server that sends one.
 */
export async function listJobs(jobsUrl: string, options: ListJobsOptions = {}): Promise<JobList> {
  const sink = options.onObservation;
  const maxPages = Math.max(1, options.maxPages ?? DEFAULT_MAX_JOB_PAGES);

  const byId = new Map<string, JobStatus>();
  const visited = new Set<string>();
  const anonymous: JobStatus[] = [];

  let url = firstPageUrl(jobsUrl, options);
  let pageCount = 0;
  let duplicateCount = 0;
  let unparseableCount = 0;
  let truncationReason: JobListTruncation | undefined;
  let numberTotal: number | undefined;
  let lastLinks: readonly Link[];
  let lastStatus: number;
  let lastUrl: string;
  let usedFormatFallback = false;
  let advertisedPagination = false;

  for (;;) {
    throwIfAborted(options.signal, url);

    const page = await fetchJson(url, options);
    pageCount += 1;
    lastStatus = page.envelope.status;
    lastUrl = page.envelope.url;
    usedFormatFallback = usedFormatFallback || page.usedFormatFallback;

    visited.add(url);
    visited.add(page.envelope.url);

    if (!isRecord(page.body)) {
      throw new MalformedJobDocumentError(
        page.envelope.url,
        `expected a JSON object, got ${Array.isArray(page.body) ? "an array" : typeof page.body}`,
        `page ${String(pageCount)}`,
      );
    }

    const entries: unknown = page.body["jobs"];
    if (!Array.isArray(entries)) {
      throw new MalformedJobDocumentError(
        page.envelope.url,
        entries === undefined ? "no `jobs` member" : `\`jobs\` is ${typeof entries}, not an array`,
        `page ${String(pageCount)}`,
      );
    }

    entries.forEach((entry: unknown, index: number) => {
      let status: JobStatus;
      try {
        status = parseJobStatus(entry, {
          documentUrl: page.envelope.url,
          where: `page ${String(pageCount)}, entry at index ${String(index)}`,
          listEntry: true,
          ...(sink === undefined ? {} : { sink }),
        });
      } catch {
        // One bad entry is a finding, not an outage. Counted, not thrown.
        unparseableCount += 1;
        return;
      }
      // A job with no discoverable id cannot be deduplicated, so it is kept
      // verbatim rather than collapsing every such entry into one.
      if (status.jobId === "") {
        anonymous.push(status);
        return;
      }
      if (byId.has(status.jobId)) {
        duplicateCount += 1;
        return;
      }
      byId.set(status.jobId, status);
    });

    lastLinks = collectLinks(page.envelope, readBodyLinks(page.body), sink);
    if (numberTotal === undefined) numberTotal = readNumberTotal(page.body);

    const next = findLink(lastLinks, "next");
    if (next === undefined) break;
    advertisedPagination = true;

    if (visited.has(next.href)) {
      truncationReason = "cycle";
      break;
    }
    if (pageCount >= maxPages) {
      truncationReason = "page-cap";
      break;
    }

    url = next.href;
  }

  const returned = [...byId.values(), ...anonymous];
  const jobs = returned.filter((job) => !excludedBy(job, options));
  const filtersSent = [
    ...((options.processID?.length ?? 0) > 0 ? (["processID"] as const) : []),
    ...((options.status?.length ?? 0) > 0 ? (["status"] as const) : []),
  ];
  const filteredOutCount = returned.length - jobs.length;

  observe(sink, {
    kind: "job-list",
    url: redactUrl(lastUrl),
    status: lastStatus,
    usedFormatFallback,
    pageCount,
    jobCount: jobs.length,
    duplicateCount,
    unparseableCount,
    truncated: truncationReason !== undefined,
    truncationReason,
    numberTotal,
    advertisedPagination,
    filtersSent,
    filteredOutCount,
    filtersHonoured: filtersSent.length === 0 ? undefined : filteredOutCount === 0,
  });

  return {
    jobs,
    links: lastLinks,
    pageCount,
    truncated: truncationReason !== undefined,
    ...(truncationReason === undefined ? {} : { truncationReason }),
    ...(numberTotal === undefined ? {} : { numberTotal }),
  };
}
