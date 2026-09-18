/**
 * `dismissJob()` — `DELETE /jobs/{id}`, treated as a question rather than a
 * command that must succeed.
 *
 * ## Why the return type is not `void`
 *
 * T4, and `classify.ts` names this operation too: *a 405 on `DELETE /jobs/{id}`
 * is the answer the probe asked for*. This server does not support dismiss.
 * Recording that as a capability is the point; raising it as a failure is noise
 * that a UI then has to un-raise.
 *
 * So `unsupported` covers 405 and 501, and everything else that is not a
 * success — 400, 403, 500 — throws through `requireOk()` as usual. "This server
 * will not let you dismiss *this* job" and "this server cannot dismiss jobs at
 * all" are different statements, and the matrix needs both.
 *
 * ## It never gates on `capabilities.dismiss`
 *
 * `capabilities.ts` spells out why and finding 0006 is the evidence: pygeoapi
 * answers `DELETE` with a 200 while declaring no dismiss conformance class, so
 * a client that checked first would have greyed the button out on a server that
 * honours every cancellation — and shipped "pygeoapi does not support dismiss",
 * which is false. **A conformance class is evidence, not authorisation.** The
 * capability greys out a button in `apps/web`; it does not stop this function
 * sending the request.
 *
 * ## The response body is worth parsing, and is not always JSON
 *
 * Both reference servers answer 200 with a job document reporting
 * `status: "dismissed"`. pygeoapi sends it under `Content-Type: text/html;
 * charset=utf-8` while the body is JSON (finding 0037), so the parse here is
 * deliberately **not** gated on `envelope.isJson` — doing so would discard the
 * confirmation on one of the two servers. The parse is best-effort: a body we
 * cannot read does not make a successful dismissal a failure.
 */

import { requireOk } from "../http/classify.js";
import type { ResponseEnvelope } from "../http/envelope.js";
import { send } from "../http/transport.js";
import { observe, redactUrl } from "../observations.js";
import { parseJobStatus } from "./parse-status.js";
import type { JobRequestOptions, JobStatus } from "./types.js";

/** Statuses that mean "this server cannot do this", as opposed to "not for you". */
const UNSUPPORTED_STATUSES: ReadonlySet<number> = new Set([405, 501]);

export type Dismissal =
  | {
      readonly kind: "dismissed";
      /** The job document the server returned, when it returned a readable one. */
      readonly status?: JobStatus;
      readonly envelope: ResponseEnvelope;
    }
  | {
      /** 405 or 501: the capability is absent. Not an error. */
      readonly kind: "unsupported";
      readonly status: number;
      readonly envelope: ResponseEnvelope;
    };

export interface DismissJobOptions extends JobRequestOptions {
  /**
   * Whether the service declared the dismiss conformance class.
   *
   * Recorded on the observation and **never** consulted before sending. Passing
   * it is what makes the declared-versus-observed cell in the matrix possible;
   * it is not a permission check.
   */
  readonly declaredDismiss?: boolean | undefined;
}

/**
 * Ask the service to dismiss a job.
 *
 * On both reference servers a successful dismissal deletes the job outright, so
 * the next `GET` is a 404 rather than a document reporting
 * `status: "dismissed"` — finding 0035. Callers polling the job should expect
 * `JobNotFoundError`, which `pollJob()` already treats as an ordinary ending.
 */
export async function dismissJob(
  statusUrl: string,
  options: DismissJobOptions = {},
): Promise<Dismissal> {
  const sink = options.onObservation;

  const envelope = await send(statusUrl, {
    method: "DELETE",
    headers: { Accept: "application/json" },
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.maxBufferBytes === undefined ? {} : { maxBufferBytes: options.maxBufferBytes }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });

  const record = (kind: Dismissal["kind"] | "error"): void => {
    observe(sink, {
      kind: "job-dismissed",
      url: redactUrl(statusUrl),
      status: envelope.status,
      outcome: kind,
      declaredDismiss: options.declaredDismiss,
    });
  };

  if (UNSUPPORTED_STATUSES.has(envelope.status)) {
    record("unsupported");
    return { kind: "unsupported", status: envelope.status, envelope };
  }

  try {
    await requireOk(envelope);
  } catch (error) {
    record("error");
    throw error;
  }

  const status = await readDismissedDocument(envelope);
  record("dismissed");
  return { kind: "dismissed", ...(status === undefined ? {} : { status }), envelope };
}

/**
 * The job document on a dismiss response, if there is a readable one.
 *
 * Best-effort throughout. Not gated on `envelope.isJson`, because pygeoapi
 * labels this JSON body `text/html` (finding 0037) and a confirmation we can
 * read is worth having on both servers.
 */
async function readDismissedDocument(envelope: ResponseEnvelope): Promise<JobStatus | undefined> {
  try {
    const body: unknown = await envelope.json();
    return parseJobStatus(body, { documentUrl: envelope.url, envelope });
  } catch {
    // A dismissal the server accepted is a dismissal, whatever it sent back.
    return undefined;
  }
}

/** Exported for the classifier's sake: 405 and 501 mean "no such capability". */
export function isUnsupportedDismissStatus(status: number): boolean {
  return UNSUPPORTED_STATUSES.has(status);
}
