/**
 * `getJob()` — one status read.
 *
 * ## Why this calls `classify()` and not `requireOk()`
 *
 * T1, and `http/classify.ts` names this operation in its own comments. A failed
 * job is a perfectly valid 200: the job document says `status: "failed"` and
 * carries the server's explanation. Routing that through `requireOk()` would
 * either discard it or turn it into a `ProcessesError` whose message is a worse
 * version of the same information, and the job panel's whole purpose is to show
 * the server's own words.
 *
 * So: **a failed job is a successful operation.** It returns a
 * {@link JobStatus} with `status: "failed"`. There is deliberately no
 * `JobFailedError`.
 *
 * What does throw:
 *
 * - **404** → {@link JobNotFoundError}. Note that this is the *normal* state of
 *   a dismissed job on both reference servers (finding 0035), so `pollJob()`
 *   handles it rather than letting it surface as a crash.
 * - a transport failure or an abort, from `send()` unchanged;
 * - a body that is not a JSON object, or that has no usable `status`, from
 *   `parseJobStatus()`.
 *
 * ## The interaction with the problem-document heuristic
 *
 * A job document is `{"type": "process", ...}`, and `problem.ts` documents why
 * `type` and `title` alone cannot decide whether a body is a problem document.
 * Step zero checked the live failed-job bodies against that heuristic:
 * pygeoapi's carries `type: "process"` and ZOO's carries no `type` at all, and
 * neither trips it — so `classify()` correctly calls both `ok`.
 *
 * That is luck rather than design, and it must not be relied on. A server whose
 * failed-job body *did* trip the heuristic would arrive here as
 * `kind: "exception"` at status 200, and this function still returns a
 * `JobStatus` for it: the classification is used to decide whether the
 * *response* was usable, never to decide what the *job* did. A unit test pins
 * exactly that case.
 */

import { classify } from "../http/classify.js";
import type { ResponseEnvelope } from "../http/envelope.js";
import { ProcessesError } from "../http/errors.js";
import { send } from "../http/transport.js";
import { JobNotFoundError, MalformedJobDocumentError } from "../errors.js";
import { observe, redactUrl } from "../observations.js";
import { parseJobStatus } from "./parse-status.js";
import type { JobRequestOptions, JobStatus } from "./types.js";

/**
 * What a job status read asks for.
 *
 * `application/json` and nothing else, unlike the results endpoint — a status
 * document has exactly one useful representation. pygeoapi content-negotiates
 * this endpoint to HTML without it (finding 0007 applies here too).
 */
const STATUS_ACCEPT = "application/json";

/** GET the job document, whatever the server thinks of the request. */
async function readStatusResponse(
  statusUrl: string,
  options: JobRequestOptions,
): Promise<ResponseEnvelope> {
  return send(statusUrl, {
    method: "GET",
    headers: { Accept: STATUS_ACCEPT },
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.maxBufferBytes === undefined ? {} : { maxBufferBytes: options.maxBufferBytes }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
}

/** A status read, with the envelope the poll loop needs for `Retry-After`. */
export interface JobStatusRead {
  readonly status: JobStatus;
  readonly envelope: ResponseEnvelope;
}

/**
 * Read one job's status, keeping the envelope.
 *
 * `pollJob()` needs the response's `Retry-After`, which {@link JobStatus} has
 * no room for and should not grow a field for — it is a fact about one HTTP
 * response, not about the job. Exported for that caller; most callers want
 * {@link getJob}.
 *
 * `statusUrl` is absolute — resolved by the caller from a {@link JobHandle},
 * from the `jobList` link, or from a bare id. This function never guesses a URL.
 */
export async function readJobStatus(
  statusUrl: string,
  options: JobRequestOptions = {},
): Promise<JobStatusRead> {
  const sink = options.onObservation;
  const envelope = await readStatusResponse(statusUrl, options);

  // Classified, not require-ok'd. The verdict decides whether the *response*
  // was usable; it never decides what the job did.
  const classification = await classify(envelope);

  if (envelope.status === 404) {
    throw new JobNotFoundError(envelope.url, undefined, { cause: asCause(classification) });
  }

  // Any other failing status is a genuine refusal and is worth the usual error
  // — a 500 on a status read is not a job outcome, it is a broken service.
  if (envelope.status >= 400) {
    throw new ProcessesError(
      `${String(envelope.status)} reading job status from ${envelope.url}`,
      classification.kind === "ok"
        ? { kind: "http-error", envelope, bodyPreview: "" }
        : classification,
    );
  }

  let body: unknown;
  try {
    body = await envelope.json();
  } catch (cause) {
    throw new MalformedJobDocumentError(envelope.url, "body did not parse as JSON", undefined, {
      cause,
    });
  }

  const status = parseJobStatus(body, {
    documentUrl: envelope.url,
    envelope,
    ...(sink === undefined ? {} : { sink }),
  });

  observe(sink, {
    kind: "job-status",
    url: redactUrl(envelope.url),
    httpStatus: envelope.status,
    status: status.status,
    rawStatus: status.rawStatus,
    statusRecognised: status.statusRecognised,
    terminal: status.terminal,
    retryAfterPresent: envelope.retryAfterMs !== undefined,
    progressPresent: status.progress !== undefined,
    // Whether the server explained a failure in a structured `exception`
    // member, as opposed to prose in `message`. False on both reference
    // servers — finding 0034.
    exceptionPresent: status.exception !== undefined,
    // A failed job whose body *also* reads as a problem document. Recorded
    // because it decides whether `problem.ts`'s heuristic needs revisiting.
    classifiedAsException: classification.kind === "exception",
    warnings: status.warnings,
    unrecognisedKeys: status.unrecognisedKeys,
  });

  return { status, envelope };
}

/**
 * Read one job's status.
 *
 * The ordinary entry point. See {@link readJobStatus} for why the poll loop
 * uses a different one.
 */
export async function getJob(
  statusUrl: string,
  options: JobRequestOptions = {},
): Promise<JobStatus> {
  return (await readJobStatus(statusUrl, options)).status;
}

/** The problem document, when there was one, so an error can carry it as `cause`. */
function asCause(classification: Awaited<ReturnType<typeof classify>>): unknown {
  return classification.kind === "exception" ? classification.problem : undefined;
}
