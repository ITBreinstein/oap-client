/**
 * Reading a job document into a {@link JobStatus}, tolerantly.
 *
 * The same asymmetry that governs `processes/parse-summary.ts` governs this:
 * a thrown error is a blank job panel, a degraded field is a panel with one
 * imperfect row. So the fatal set is deliberately tiny —
 *
 *   1. the body is not a JSON object;
 *   2. there is no usable `status` member at all;
 *
 * — and everything else degrades into {@link JobStatus.warnings}.
 *
 * An *unrecognised* status string is deliberately **not** fatal. See T6: the
 * only thing the poll loop truly needs from a status is "can this job still
 * change", and the safe answer for a string we do not know is "yes, and stop
 * after the poll cap". Making it fatal would turn a server that invents a
 * status into a client that cannot report anything at all about the job —
 * which is precisely the finding we would want to keep polling long enough to
 * write down.
 */

import { toProblemDetails, type ProblemDetails } from "../http/problem.js";
import type { ResponseEnvelope } from "../http/envelope.js";
import { collectLinks, readBodyLinks, resolveBodyLinks } from "../links/resolve.js";
import { MalformedJobDocumentError } from "../errors.js";
import type { ObservationSink } from "../observations.js";
import { isJobState, isTerminalState, type JobState, type JobStatus } from "./types.js";

/**
 * Top-level members this layer models. Anything else is recorded by name —
 * vendor extension or v2 draft, and either way not something to drop silently.
 *
 * pygeoapi's `parameters` is the live example: it appears on every job document
 * and is always `null`, and it is not in the standard's `statusInfo`. It shows
 * up in `unrecognisedKeys`, which is the point of the list.
 */
const KNOWN_MEMBERS: ReadonlySet<string> = new Set([
  "jobID",
  "id",
  "status",
  "message",
  "created",
  "started",
  "finished",
  "updated",
  "progress",
  "percentCompleted",
  "processID",
  "type",
  "links",
  "exception",
]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/** `jobID`, then `id`, then the last path segment of the URL it was read from. */
function readJobId(body: Record<string, unknown>, documentUrl: string): string | undefined {
  for (const key of ["jobID", "id"] as const) {
    const value = stringOrUndefined(body[key]);
    if (value !== undefined) return value;
  }
  try {
    const segments = new URL(documentUrl).pathname.split("/").filter((part) => part !== "");
    const tail = segments[segments.length - 1];
    return tail === undefined ? undefined : decodeURIComponent(tail);
  } catch {
    return undefined;
  }
}

/**
 * `progress` or `percentCompleted`, clamped to 0–100.
 *
 * Out-of-range is clamped rather than dropped: a server reporting 120% has told
 * us something real about how far along it thinks it is, and a progress bar
 * that renders nothing is a worse answer than one that renders full.
 */
function readProgress(body: Record<string, unknown>, warnings: string[]): number | undefined {
  for (const key of ["progress", "percentCompleted"] as const) {
    const value: unknown = body[key];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    if (value < 0 || value > 100) {
      warnings.push(`${key}-out-of-range`);
      return Math.min(100, Math.max(0, value));
    }
    return value;
  }
  return undefined;
}

/**
 * A structured failure explanation, if the server sent one.
 *
 * Two places are checked, because the standard says one thing and the servers
 * do another. Neither pygeoapi nor ZOO sends an `exception` member at all
 * (finding 0034), so in practice this is almost always undefined and
 * `message` is where the failure actually is.
 *
 * `wireStatus: 400` is passed deliberately: a job document's `exception`
 * member *is* the failure report, so it should read as a problem document
 * without having to satisfy the URI-shaped-`type` test that `problem.ts`
 * applies to bodies it is unsure about.
 */
function readException(body: Record<string, unknown>): ProblemDetails | undefined {
  const nested: unknown = body["exception"];
  if (isRecord(nested)) {
    const problem = toProblemDetails(nested, { declared: false, wireStatus: 400 });
    if (problem !== undefined) return problem;
  }
  return undefined;
}

export interface ParseJobStatusOptions {
  /** The URL the document was served from; everything relative resolves against it. */
  readonly documentUrl: string;
  /** Present when the document arrived as an HTTP response, for `Link`-header links. */
  readonly envelope?: ResponseEnvelope | undefined;
  readonly sink?: ObservationSink | undefined;
  /** Names the offending entry when parsing a job-list page. */
  readonly where?: string | undefined;
}

/**
 * One job document in, one {@link JobStatus} out.
 *
 * Throws {@link MalformedJobDocumentError} only for the two fatal cases above.
 */
export function parseJobStatus(body: unknown, options: ParseJobStatusOptions): JobStatus {
  const { documentUrl, where } = options;

  if (!isRecord(body)) {
    throw new MalformedJobDocumentError(
      documentUrl,
      `expected a JSON object, got ${Array.isArray(body) ? "an array" : typeof body}`,
      where,
    );
  }

  const warnings: string[] = [];
  const rawStatus = stringOrUndefined(body["status"]);

  // Fatal. Without a status there is no job state to report, no way to decide
  // whether to keep polling, and nothing a job panel could render.
  if (rawStatus === undefined) {
    const jobId = readJobId(body, documentUrl);
    throw new MalformedJobDocumentError(
      documentUrl,
      body["status"] === undefined
        ? "no `status` member"
        : `\`status\` is ${typeof body["status"]}, not a usable string`,
      where ?? (jobId === undefined ? undefined : `job ${jobId}`),
    );
  }

  const recognised = isJobState(rawStatus);
  if (!recognised) warnings.push("unrecognised-status");

  // An unknown status reads as `running`: non-terminal, so the loop keeps
  // going under its own cap rather than declaring a job finished on a word it
  // does not know.
  const status: JobState = recognised ? (rawStatus.toLowerCase() as JobState) : "running";

  const jobId = readJobId(body, documentUrl);
  if (jobId === undefined) warnings.push("no-job-id");

  const processId = stringOrUndefined(body["processID"]);
  const progress = readProgress(body, warnings);
  const message = stringOrUndefined(body["message"]);
  const exception = readException(body);

  const rawLinks = readBodyLinks(body);
  const links =
    options.envelope === undefined
      ? // No envelope: the document came from somewhere other than a response of
        // its own — a job-list page, say — so only the body's links exist and
        // they resolve against the page's URL.
        resolveBodyLinks(documentUrl, rawLinks, options.sink)
      : collectLinks(options.envelope, rawLinks, options.sink);

  const unrecognisedKeys = Object.keys(body).filter((key) => !KNOWN_MEMBERS.has(key));

  return {
    // A job with no discoverable id is still a job worth showing; the empty
    // string is the honest placeholder and `warnings` says why it is there.
    jobId: jobId ?? "",
    status,
    rawStatus,
    statusRecognised: recognised,
    ...(processId === undefined ? {} : { processId }),
    ...(progress === undefined ? {} : { progress }),
    ...(message === undefined ? {} : { message }),
    ...readTimestamps(body),
    ...(exception === undefined ? {} : { exception }),
    links,
    url: documentUrl,
    terminal: isTerminalState(status),
    warnings: Object.freeze(warnings),
    unrecognisedKeys: Object.freeze(unrecognisedKeys),
  };
}

/** The four timestamps, each kept verbatim — this layer does not parse dates. */
function readTimestamps(
  body: Record<string, unknown>,
): Pick<JobStatus, "created" | "started" | "finished" | "updated"> {
  const created = stringOrUndefined(body["created"]);
  const started = stringOrUndefined(body["started"]);
  const finished = stringOrUndefined(body["finished"]);
  const updated = stringOrUndefined(body["updated"]);
  return {
    ...(created === undefined ? {} : { created }),
    ...(started === undefined ? {} : { started }),
    ...(finished === undefined ? {} : { finished }),
    ...(updated === undefined ? {} : { updated }),
  };
}
